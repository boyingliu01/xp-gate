/**
 * @test REQ-625
 * @intent The OpenCode plugin has 560 lines and 27 functions -- including a
 *         CCN=48 anonymous callback and two functions at CCN=12 -- with ZERO
 *         tests. Nothing protects its behaviour, so nothing can be safely
 *         refactored either. This suite pins the behaviour of the pieces that
 *         are pure or nearly pure, so the same behaviour can be re-verified
 *         after the complexity is brought down.
 *
 *         The tests deliberately target BEHAVIOUR (what the plugin decides, what
 *         it writes) rather than the private helpers' shapes, so a refactor that
 *         splits a function is free to do so.
 *
 *         Everything that touches the user's ~/.xp-gate or the network is
 *         stubbed at the boundary: the suite must not read or write a real
 *         home-directory cache, and must not depend on npm being reachable.
 * @covers AC-625-01, AC-625-02, AC-625-03
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Headroom: the plugin imports @opencode-ai/plugin and zod at module load.
// Both are stubbed so the suite tests the plugin, not its host.
vi.mock('@opencode-ai/plugin', () => ({
  tool: (def: unknown) => def,
}));

// child_process is mocked wholesale: getLocalXpGateVersion shells out to
// `npm root -g` and the upgrade path spawns `npm install -g`. The suite must
// never run either, so the module is replaced rather than spied on -- spying
// after import would still leave the real spawn reachable.
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  exec: vi.fn(),
  spawn: vi.fn(),
}));

import * as childProcess from 'node:child_process';

const written = new Map<string, string>();
const fakeHome = '/fake/xp-home';

/**
 * Normalise a path so seeded keys match what the plugin probes.
 *
 * `join()` emits `\fake\xp-home\.local\opencode.db` on Windows and
 * `/fake/xp-home/.local/opencode.db` on POSIX. Seeding with a literal
 * forward-slash path therefore only works on one of them -- an earlier version of
 * this suite passed on Linux-shaped paths and silently missed every seed on
 * Windows. Keying on the normalised form makes the suite platform-independent.
 */
function key(p: string): string {
  return String(p).replace(/\\/g, '/');
}

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: (p: string, enc?: unknown) => {
      if (written.has(key(p))) return written.get(key(p));
      if (key(p).includes(fakeHome)) {
        const err = new Error(`ENOENT: no such file or directory, open '${p}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return (actual.readFileSync as (p: string, e?: unknown) => unknown)(p, enc);
    },
    writeFileSync: (p: string, data: string, enc?: unknown) => {
      written.set(key(p), String(data));
      void enc;
    },
    existsSync: (p: string) => {
      // Anything under the fake home is "present" only if the test seeded it;
      // everything else falls through to the real filesystem.
      if (key(p).includes(fakeHome)) return written.has(key(p));
      return (actual.existsSync as (p: string) => boolean)(p);
    },
    mkdirSync: () => undefined,
    rmSync: (p: string) => { written.delete(key(p)); },
  };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => fakeHome };
});

/**
 * Load the plugin fresh.
 *
 * `index.ts` keeps module-level state (`checked`) and resolves homedir() at load
 * time, so each test group re-imports rather than sharing one instance.
 */
async function loadPlugin() {
  vi.resetModules();
  return import('../index');
}

/** Write a cache file the plugin will read. */
function seedCache(fileName: string, data: unknown): void {
  written.set(`${fakeHome}/.xp-gate/${fileName}`, JSON.stringify(data));
}

beforeEach(() => {
  written.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AC-625-01: version comparison orders semver numerically, not lexically', () => {
  it('treats 0.9.0 as older than 0.10.0 (the classic string-compare bug)', async () => {
    const { __test } = await loadPlugin();
    // "0.9" < "0.10" is false as strings, true as numbers. A plugin that gets
    // this wrong never offers the upgrade, silently.
    expect(__test.semverLt('0.9.0', '0.10.0')).toBe(true);
    expect(__test.semverLt('0.10.0', '0.9.0')).toBe(false);
  });

  it('treats equal versions as not older', async () => {
    const { __test } = await loadPlugin();
    expect(__test.semverLt('1.2.3', '1.2.3')).toBe(false);
  });

  it('ignores a leading v prefix', async () => {
    const { __test } = await loadPlugin();
    expect(__test.semverLt('v1.2.3', '1.2.4')).toBe(true);
    expect(__test.semverLt('1.2.3', 'v1.2.3')).toBe(false);
  });

  it('pads a missing component with zero rather than comparing NaN', async () => {
    const { __test } = await loadPlugin();
    expect(__test.semverLt('1.2', '1.2.1')).toBe(true);
    expect(__test.semverLt('1.2.1', '1.2')).toBe(false);
  });
});

describe('AC-625-02: a cache older than its TTL is not trusted', () => {
  it('accepts a fresh cache', async () => {
    const { __test } = await loadPlugin();
    seedCache('unit-test-cache.json', { ts: Date.now(), remoteVersion: '9.9.9' });
    const got = __test.readCache(`${fakeHome}/.xp-gate/unit-test-cache.json`);
    expect(got).not.toBeNull();
    expect(got?.remoteVersion).toBe('9.9.9');
  });

  it('rejects an expired cache', async () => {
    const { __test } = await loadPlugin();
    // 25 hours ago: past the 24h TTL.
    seedCache('old.json', { ts: Date.now() - 25 * 3_600_000, remoteVersion: '9.9.9' });
    expect(__test.readCache(`${fakeHome}/.xp-gate/old.json`)).toBeNull();
  });

  it('rejects a cache entry with no recorded version', async () => {
    const { __test } = await loadPlugin();
    seedCache('empty.json', { ts: Date.now() });
    expect(__test.readCache(`${fakeHome}/.xp-gate/empty.json`)).toBeNull();
  });

  it('returns null rather than throwing when the file is absent or unparseable', async () => {
    const { __test } = await loadPlugin();
    expect(__test.readCache(`${fakeHome}/.xp-gate/absent.json`)).toBeNull();
    written.set(`${fakeHome}/.xp-gate/torn.json`, '{not json');
    expect(__test.readCache(`${fakeHome}/.xp-gate/torn.json`)).toBeNull();
  });
});

describe('AC-625-03: session titles are derived from the prompt, deterministically', () => {
  it('extracts the task phrase when the prompt opens with a task verb', async () => {
    const { __test } = await loadPlugin();
    // The plugin looks for an imperative task phrase rather than taking the
    // first line, so the title reads as a task ("Fix the login bug") instead of
    // whatever prose the user happened to open with.
    expect(__test.extractTitleFromText('Please fix the login bug in the auth module')).toBe(
      'fix the login bug in the auth module'
    );
    expect(__test.extractTitleFromText('Implement retry logic for flaky network calls')).toBe(
      'Implement retry logic for flaky network calls'
    );
  });

  it('falls back to the first substantial sentence when there is no task verb', async () => {
    const { __test } = await loadPlugin();
    const title = __test.extractTitleFromText('The cache is stale. Nothing else to report.');
    expect(title).toBe('The cache is stale');
  });

  it('returns an empty string for input with no usable text', async () => {
    const { __test } = await loadPlugin();
    expect(__test.extractTitleFromText('')).toBe('');
    expect(__test.extractTitleFromText('   \n\t  ')).toBe('');
  });

  it('caps the title length rather than emitting an unbounded string', async () => {
    const { __test } = await loadPlugin();
    const long = `fix ${'x'.repeat(10_000)}`;
    expect(() => __test.extractTitleFromText(long)).not.toThrow();
    // 120 is the documented cap; a title longer than that is not a title.
    expect(__test.extractTitleFromText(long).length).toBeLessThanOrEqual(120);
  });

  it('is deterministic: the same prompt yields the same title', async () => {
    const { __test } = await loadPlugin();
    const prompt = 'Refactor the version comparison to be numeric';
    expect(__test.extractTitleFromText(prompt)).toBe(__test.extractTitleFromText(prompt));
  });
});

/**
 * `reloadSessionModel` is a chain of six preconditions followed by one action.
 * Every precondition has its own failure message, and those messages are the
 * only diagnostics a user gets -- so the refactor that splits the chain must
 * preserve each one verbatim. These tests exist to make that non-negotiable.
 */
/**
 * `checkXpGateUpdate` decides whether to upgrade the globally installed
 * xp-gate. It has one outcome per precondition (cache hit, no local install, no
 * registry answer, already current, opted out, install failed, installed), and a
 * wrong decision here either spams every user with an install or silently stops
 * upgrading. Network and spawn are stubbed so each branch is forced directly.
 */
describe('AC-625-05: the update check takes exactly one decision per situation', () => {
  /** Replace the global-version probe so the test controls the "local" side. */
  function stubLocalVersion(version: string | null): void {
    // getLocalXpGateVersion runs `npm root -g` and then reads
    // <root>/@boyingliu01/xp-gate/package.json. The execSync stub answers the
    // first half; the readFileSync stub above answers the second, because the
    // global root it returns is real but the package file is not.
    vi.mocked(childProcess.execSync).mockImplementation(() => {
      if (version === null) throw new Error('npm not found');
      return '/fake/global-node-modules' as unknown as Buffer;
    });
    if (version === null) {
      written.delete('/fake/global-node-modules/@boyingliu01/xp-gate/package.json');
    } else {
      written.set(
        '/fake/global-node-modules/@boyingliu01/xp-gate/package.json',
        JSON.stringify({ version })
      );
    }
  }

  /** Force the registry answer. */
  function stubRegistry(version: string | null): void {
    vi.stubGlobal('fetch', async () => {
      if (version === null) return { ok: false, json: async () => ({}) } as Response;
      return { ok: true, json: async () => ({ latest: version }) } as Response;
    });
  }

  it('does nothing when no local xp-gate is installed', async () => {
    const { __test } = await loadPlugin();
    stubLocalVersion(null);
    stubRegistry('9.9.9');
    const result = await __test.checkXpGateUpdate();
    expect(result.action).toBe('noop');
    expect(result.localVersion).toBeNull();
  });

  it('does nothing when the registry cannot be reached', async () => {
    const { __test } = await loadPlugin();
    stubLocalVersion('1.0.0');
    stubRegistry(null);
    const result = await __test.checkXpGateUpdate();
    expect(result.action).toBe('noop');
    expect(result.remoteVersion).toBeNull();
  });

  it('does nothing when the local install is already current', async () => {
    const { __test } = await loadPlugin();
    stubLocalVersion('2.0.0');
    stubRegistry('2.0.0');
    const result = await __test.checkXpGateUpdate();
    expect(result.action).toBe('noop');
    expect(result.remoteVersion).toBe('2.0.0');
  });

  it('honours the autoUpgrade:false opt-out instead of installing', async () => {
    const { __test } = await loadPlugin();
    stubLocalVersion('1.0.0');
    stubRegistry('2.0.0');
    written.set(`${fakeHome}/.xp-gate/config.json`, JSON.stringify({ autoUpgrade: false }));
    const result = await __test.checkXpGateUpdate();
    expect(result.action).toBe('noop');
    // The opt-out must not be mistaken for "no update available".
    expect(result.remoteVersion).toBe('2.0.0');
  });

  it('takes the cached "current" answer without consulting the registry', async () => {
    const { __test } = await loadPlugin();
    stubLocalVersion('2.0.0');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    written.set(`${fakeHome}/.xp-gate/xp-gate-version-check.json`, JSON.stringify({
      ts: Date.now(), localVersion: '2.0.0', remoteVersion: '2.0.0', status: 'current',
    }));
    const result = await __test.checkXpGateUpdate();
    expect(result.action).toBe('noop');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * `checkPluginUpdate` only ever writes a cache entry: it decides whether the
 * user should be SHOWN an upgrade notice, it never installs anything. The
 * distinction that matters is whether the cache is written with
 * `status: "current"` (already up to date, stay quiet) or without it (an upgrade
 * is available, show the notice).
 */
describe('AC-625-07: the plugin update check records "up to date" vs "update available"', () => {
  const pluginDir = '/fake/plugin-pkg';

  function seedPluginPackage(version: string | null): void {
    if (version === null) return;
    written.set(`${pluginDir}/package.json`, JSON.stringify({ version }));
  }

  function cacheEntry(): { status?: string; remoteVersion?: string } | null {
    const raw = written.get(`${fakeHome}/.xp-gate/opencode-plugin-version-check.json`);
    return raw ? JSON.parse(raw) : null;
  }

  function stubRegistry(version: string | null): void {
    vi.stubGlobal('fetch', async () => {
      if (version === null) return { ok: false, json: async () => ({}) } as Response;
      return { ok: true, json: async () => ({ latest: version }) } as Response;
    });
  }

  it('does nothing, and caches nothing, when the plugin package is unreadable', async () => {
    const { __test } = await loadPlugin();
    stubRegistry('9.9.9');
    seedPluginPackage(null);
    await __test.checkPluginUpdate(pluginDir);
    expect(cacheEntry()).toBeNull();
  });

  it('does nothing when the registry cannot be reached', async () => {
    const { __test } = await loadPlugin();
    stubRegistry(null);
    seedPluginPackage('1.0.0');
    await __test.checkPluginUpdate(pluginDir);
    expect(cacheEntry()).toBeNull();
  });

  it('marks the plugin current when the local version is already latest', async () => {
    const { __test } = await loadPlugin();
    stubRegistry('2.0.0');
    seedPluginPackage('2.0.0');
    await __test.checkPluginUpdate(pluginDir);
    const entry = cacheEntry();
    expect(entry?.status).toBe('current');
    expect(entry?.remoteVersion).toBe('2.0.0');
  });

  it('leaves the entry WITHOUT "current" when an upgrade is available', async () => {
    const { __test } = await loadPlugin();
    stubRegistry('2.0.0');
    seedPluginPackage('1.0.0');
    await __test.checkPluginUpdate(pluginDir);
    const entry = cacheEntry();
    // No status means "a notice is owed" -- the notice path keys off its absence.
    expect(entry?.status).toBeUndefined();
    expect(entry?.remoteVersion).toBe('2.0.0');
  });

  it('short-circuits on a cached "current" answer', async () => {
    const { __test } = await loadPlugin();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    written.set(`${fakeHome}/.xp-gate/opencode-plugin-version-check.json`, JSON.stringify({
      ts: Date.now(), localVersion: '2.0.0', remoteVersion: '2.0.0', status: 'current',
    }));
    seedPluginPackage('1.0.0');
    await __test.checkPluginUpdate(pluginDir);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('AC-625-06: session model reload reports each precondition failure by name', () => {
  /** Seed the two files the reload path requires. */
  function seedReloadInputs(opts: { omo?: unknown; db?: boolean } = {}): void {
    if (opts.db !== false) written.set(`${fakeHome}/.local/share/opencode/opencode.db`, 'db');
    if (opts.omo !== undefined) {
      written.set(
        `${fakeHome}/.config/opencode/oh-my-openagent.json`,
        typeof opts.omo === 'string' ? opts.omo : JSON.stringify(opts.omo)
      );
    }
  }

  it('names the missing database path', async () => {
    const { __test } = await loadPlugin();
    const out = __test.reloadSessionModel('s1');
    expect(out).toContain('Session reload failed');
    expect(out).toContain('OpenCode database not found');
  });

  it('names the missing oh-my-openagent.json path', async () => {
    const { __test } = await loadPlugin();
    seedReloadInputs({ db: true });
    const out = __test.reloadSessionModel('s1');
    expect(out).toContain('oh-my-openagent.json not found');
  });

  it('reports a parse failure instead of throwing', async () => {
    const { __test } = await loadPlugin();
    seedReloadInputs({ omo: '{not json' });
    const out = __test.reloadSessionModel('s1');
    expect(out).toContain('could not parse oh-my-openagent.json');
  });

  it('reports a missing sisyphus.model', async () => {
    const { __test } = await loadPlugin();
    seedReloadInputs({ omo: { agents: { sisyphus: {} } } });
    const out = __test.reloadSessionModel('s1');
    expect(out).toContain('could not find sisyphus.model');
  });

  it('rejects a model that is not provider/model', async () => {
    const { __test } = await loadPlugin();
    seedReloadInputs({ omo: { agents: { sisyphus: { model: 'gpt-4' } } } });
    const out = __test.reloadSessionModel('s1');
    expect(out).toContain('is not in provider/model format');
  });
});
