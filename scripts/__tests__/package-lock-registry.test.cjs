/**
 * @test REQ-010-04 dependency lockfile registry pinning
 * @intent Verify the committed root lockfile resolves every tarball over https from the canonical registry, and that the offline repair tool rewrites resolved sources only
 * @covers AC-010-04
 *
 * Scope: root package-lock.json only. src/npm-package ships zero dependencies,
 * and plugins/opencode/package-lock.json is a gitignored build artifact.
 * Annotation note: the REQ-010-* family is a scripts/ guard convention that
 * specification.yaml does not define (it carries REQ-DSH-*); documented in
 * docs/plans/2026-09-30-package-lock-registry-normalization.md.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  normalizeLockRegistry,
  normalizeFile,
  findRegistryOffenders,
  CANONICAL_REGISTRY_HOST,
} = require('../normalize-lock-registry.cjs');

const LOCK_PATH = path.resolve(__dirname, '../../package-lock.json');
const TOOL_PATH = path.resolve(__dirname, '../normalize-lock-registry.cjs');

function offenderLines(text) {
  return findRegistryOffenders(text).map((o) => `${o.name} -> ${o.host}`);
}

describe('root package-lock registry pinning', () => {
  let lockText;
  let lockfileVersion;
  let resolvedCount;

  beforeAll(() => {
    try {
      lockText = fs.readFileSync(LOCK_PATH, 'utf8');
    } catch (error) {
      throw new Error(`cannot read ${LOCK_PATH}: ${error.message}`);
    }
    let lock;
    try {
      lock = JSON.parse(lockText);
    } catch (error) {
      throw new Error(`cannot parse ${LOCK_PATH}: ${error.message}`);
    }
    lockfileVersion = lock.lockfileVersion;
    resolvedCount = Object.values(lock.packages || {}).filter(
      (meta) => meta && meta.resolved,
    ).length;
  });

  // Decoupled on purpose: a future lockfileVersion must not turn every registry
  // guard red for a reason unrelated to the invariant it protects.
  it('is a lock shape the guard and the tool understand', () => {
    expect([1, 2, 3]).toContain(lockfileVersion);
  });

  it('inspects a non-trivial set of resolved tarballs', () => {
    // Canary against a silent no-op (renamed field, truncated or replaced lock).
    expect(resolvedCount).toBeGreaterThan(100);
  });

  it('resolves every registry tarball from the canonical host', () => {
    const offenders = offenderLines(lockText);
    if (offenders.length > 0) {
      throw new Error(
        `${offenders.length} resolved entries outside ${CANONICAL_REGISTRY_HOST}:\n` +
          `  ${offenders.slice(0, 5).join('\n  ')}\n` +
          'Fix: npm run normalize-lock (rewrites resolved sources only, offline-safe)',
      );
    }
    expect(offenders).toEqual([]);
  });

  it('pins every http(s) resolved value with a raw-text oracle', () => {
    // The check above shares its classifier with the tool, so a systematic
    // misjudgement there would be invisible to both. This oracle reads the bytes
    // and can never be influenced by the repair path.
    const rawResolved = [...lockText.matchAll(/"resolved"\s*:\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(rawResolved.length).toBe(resolvedCount);
    const straying = rawResolved.filter(
      (url) => /^https?:\/\//.test(url) && !url.startsWith('https://registry.npmjs.org/'),
    );
    expect(straying).toEqual([]);
  });
});

describe('normalizeLockRegistry', () => {
  function lockWith(resolvedUrl) {
    return `${JSON.stringify(
      {
        name: 'fixture',
        lockfileVersion: 3,
        packages: {
          '': { name: 'fixture', version: '1.0.0' },
          'node_modules/pkg': { version: '1.0.0', resolved: resolvedUrl, integrity: 'sha512-abc=' },
        },
      },
      null,
      2,
    )}\n`;
  }

  const mirrorUrl = 'https://registry.npmmirror.com/pkg/-/pkg-1.0.0.tgz';
  const canonicalUrl = 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz';

  it('rewrites the host and nothing else', () => {
    const input = lockWith(mirrorUrl);
    const result = normalizeLockRegistry(input);

    expect(result.changed).toBe(1);
    expect(result.remaining).toEqual([]);
    expect(result.text).toContain(canonicalUrl);

    const inputLines = input.split('\n');
    const outputLines = result.text.split('\n');
    expect(outputLines.length).toBe(inputLines.length);
    expect(inputLines.filter((line, i) => line !== outputLines[i])).toEqual([
      '      "resolved": "https://registry.npmmirror.com/pkg/-/pkg-1.0.0.tgz",',
    ]);
    expect(outputLines).toContain('      "integrity": "sha512-abc="');
  });

  it('handles CRLF lockfiles without silently no-oping', () => {
    const input = lockWith(mirrorUrl).replace(/\n/g, '\r\n');
    const result = normalizeLockRegistry(input);

    expect(result.changed).toBe(1);
    expect(result.text.includes('\r\n')).toBe(true);
    expect(offenderLines(result.text)).toEqual([]);
    expect(result.text.replace(/\r\n/g, '\n')).toBe(normalizeLockRegistry(lockWith(mirrorUrl)).text);
  });

  it('rewrites regardless of value formatting', () => {
    const compact = '{"packages":{"a":{"resolved":"https://registry.npmmirror.com/a/-/a-1.tgz"}}}\n';
    expect(normalizeLockRegistry(compact).changed).toBe(1);
    expect(offenderLines(normalizeLockRegistry(compact).text)).toEqual([]);
  });

  it('drops ports and credentials when rewriting to the canonical host', () => {
    for (const url of [
      'https://registry.npmmirror.com:443/pkg/-/pkg-1.0.0.tgz',
      'https://token@registry.npmmirror.com/pkg/-/pkg-1.0.0.tgz',
    ]) {
      const result = normalizeLockRegistry(lockWith(url));
      expect(result.changed).toBe(1);
      expect(result.text).toContain(canonicalUrl);
      expect(result.text).not.toContain(url);
      expect(result.remaining).toEqual([]);
    }
  });

  it('counts every occurrence of a shared tarball URL', () => {
    const input = `${JSON.stringify({
      lockfileVersion: 3,
      packages: {
        pkg: { version: '1.0.0', resolved: mirrorUrl, integrity: 'sha512-abc=' },
        'node_modules/pkg': { version: '1.0.0', resolved: mirrorUrl, integrity: 'sha512-abc=' },
      },
    })}\n`;
    const result = normalizeLockRegistry(input);

    expect(result.changed).toBe(2);
    expect(result.text).not.toContain('npmmirror');
    expect(offenderLines(result.text)).toEqual([]);
  });

  it('rewrites the legacy dependencies tree too', () => {
    const legacy = `${JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        a: {
          resolved: 'https://registry.npmmirror.com/a/-/a-1.tgz',
          dependencies: { b: { resolved: 'https://registry.npmmirror.com/b/-/b-2.tgz' } },
        },
      },
    })}\n`;
    const result = normalizeLockRegistry(legacy);

    expect(result.changed).toBe(2);
    expect(offenderLines(result.text)).toEqual([]);
  });

  it('survives a malformed legacy tree entry instead of crashing', () => {
    const malformed = '{"lockfileVersion":1,"dependencies":{"a":null,"b":{"dependencies":null}}}\n';

    expect(offenderLines(malformed)).toEqual([]);
    expect(normalizeLockRegistry(malformed).changed).toBe(0);
  });

  it('leaves hosts it cannot vouch for in place and reports them', () => {
    const result = normalizeLockRegistry(
      lockWith('https://mirror.example.com/pkg/-/pkg-1.0.0.tgz'),
    );

    expect(result.changed).toBe(0);
    expect(result.remaining).toEqual(['node_modules/pkg -> mirror.example.com']);
    expect(result.text).toContain('https://mirror.example.com/pkg/-/pkg-1.0.0.tgz');
  });

  it('ignores non-registry sources', () => {
    for (const url of [
      'git+ssh://git@github.com/acme/pkg.git#v1.0.0',
      'file:../local/pkg',
    ]) {
      const input = lockWith(url);
      const result = normalizeLockRegistry(input);

      expect(result.changed).toBe(0);
      expect(result.remaining).toEqual([]);
      expect(result.text).toBe(input);
    }
  });

  // A canonical hostname reached over http is not the canonical endpoint;
  // accepting it would make the guard weaker than the invariant AGENTS.md and
  // the CHANGELOG claim.
  it('upgrades a canonical host reached over http', () => {
    const url = 'http://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz';

    expect(offenderLines(lockWith(url))).toEqual(['node_modules/pkg -> registry.npmjs.org']);

    const result = normalizeLockRegistry(lockWith(url));
    expect(result.changed).toBe(1);
    expect(result.text).toContain(canonicalUrl);
    expect(result.remaining).toEqual([]);
  });

  // Credentials or a non-default port on the canonical hostname mean something
  // is being routed there; stripping them silently would hide the interception.
  it('reports canonical-host entries it must not re-route by itself', () => {
    for (const url of [
      'https://token@registry.npmjs.org/pkg/-/pkg-1.0.0.tgz',
      'https://registry.npmjs.org:8080/pkg/-/pkg-1.0.0.tgz',
    ]) {
      const result = normalizeLockRegistry(lockWith(url));

      expect(result.changed).toBe(0);
      expect(result.remaining).toEqual(['node_modules/pkg -> registry.npmjs.org']);
    }
  });

  it('treats an explicit default port as the canonical endpoint', () => {
    expect(
      offenderLines(lockWith('https://registry.npmjs.org:443/pkg/-/pkg-1.0.0.tgz')),
    ).toEqual([]);
  });

  it('reports a resolved value it cannot parse instead of skipping it', () => {
    const offenders = offenderLines(lockWith('registry.npmmirror.com/pkg/-/pkg-1.0.0.tgz'));

    expect(offenders).toEqual(['node_modules/pkg -> unparseable']);
    expect(normalizeLockRegistry(lockWith('registry.npmmirror.com/pkg/-/pkg-1.0.0.tgz')).changed).toBe(0);
  });

  it('rewrites only the resolved key, never a value that merely looks like one', () => {
    const input = `${JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/pkg': {
          version: '1.0.0',
          resolved: mirrorUrl,
          funding: mirrorUrl,
          unresolved: mirrorUrl,
        },
      },
    })}\n`;
    const result = normalizeLockRegistry(input);

    expect(result.changed).toBe(1);
    const occurrences = result.text.split(mirrorUrl).length - 1;
    expect(occurrences).toBe(2);
  });

  it('refuses to rewrite when the tail cannot be recovered verbatim', () => {
    // No '/' after the authority: slicing the authority out of the raw text
    // would swallow ?query and certify the shortened URL as clean.
    const input = lockWith('https://registry.npmmirror.com?query=1');
    const result = normalizeLockRegistry(input);

    expect(result.changed).toBe(0);
    expect(result.text).toBe(input);
    expect(result.remaining).toEqual(['node_modules/pkg -> registry.npmmirror.com']);
  });

  it('reports a canonical host carrying a query instead of certifying it clean', () => {
    const input = lockWith('https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz?access_token=secret');
    const result = normalizeLockRegistry(input);

    expect(result.changed).toBe(0);
    expect(result.text).toBe(input);
    expect(result.remaining).toEqual(['node_modules/pkg -> registry.npmjs.org']);
  });

  it('names a non-string resolved value rather than calling it unparseable', () => {
    const input = `${JSON.stringify({
      lockfileVersion: 3,
      packages: { '': {}, 'node_modules/pkg': { resolved: 42 } },
    })}\n`;

    expect(offenderLines(input)).toEqual(['node_modules/pkg -> not-a-string']);
  });

  it('rewrites what it can and still reports what it cannot in one pass', () => {
    const input = `${JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/a': { version: '1.0.0', resolved: mirrorUrl, integrity: 'sha512-abc=' },
        'node_modules/b': {
          version: '1.0.0',
          resolved: 'https://mirror.example.com/b/-/b-1.0.0.tgz',
          integrity: 'sha512-def=',
        },
      },
    })}\n`;
    const result = normalizeLockRegistry(input);

    expect(result.changed).toBe(1);
    expect(result.text).toContain(canonicalUrl);
    expect(result.remaining).toEqual(['node_modules/b -> mirror.example.com']);
  });

  it('is idempotent', () => {
    const once = normalizeLockRegistry(lockWith(mirrorUrl)).text;
    const twice = normalizeLockRegistry(once);

    expect(twice.changed).toBe(0);
    expect(twice.text).toBe(once);
  });

  it('refuses to rewrite a lockfile it cannot parse', () => {
    expect(() => normalizeLockRegistry('{"lockfileVersion": 3, "packages":')).toThrow();
  });
});

describe('normalizeFile', () => {
  let dir;
  const mirrorUrl = 'https://registry.npmmirror.com/pkg/-/pkg-1.0.0.tgz';

  function writeLock(name, resolved) {
    const lockPath = path.join(dir, name);
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify(
        { lockfileVersion: 3, packages: { 'node_modules/pkg': { resolved, integrity: 'sha512-abc=' } } },
        null,
        2,
      )}\n`,
    );
    return lockPath;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-lock-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lands the rewrite on disk and leaves no temp file behind', () => {
    const lockPath = writeLock('package-lock.json', mirrorUrl);
    const result = normalizeFile(lockPath);

    expect(result.changed).toBe(1);
    expect(fs.readFileSync(lockPath, 'utf8')).toContain('registry.npmjs.org');
    expect(fs.readdirSync(dir)).toEqual(['package-lock.json']);
    expect(normalizeFile(lockPath).changed).toBe(0);
  });

  it('does not touch a lock that has nothing to rewrite', () => {
    const lockPath = writeLock('package-lock.json', 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz');
    const before = fs.statSync(lockPath);

    expect(normalizeFile(lockPath).changed).toBe(0);
    expect(fs.readdirSync(dir)).toEqual(['package-lock.json']);
    expect(fs.statSync(lockPath).mtimeMs).toBe(before.mtimeMs);
  });

  it('keeps an unfixable offender visible to the caller instead of washing it', () => {
    const lockPath = writeLock('package-lock.json', 'https://mirror.example.com/pkg/-/pkg-1.0.0.tgz');
    const result = normalizeFile(lockPath);

    expect(result.changed).toBe(0);
    expect(result.remaining).toEqual(['node_modules/pkg -> mirror.example.com']);
    expect(fs.readFileSync(lockPath, 'utf8')).toContain('mirror.example.com');
  });
});

describe('normalize-lock CLI', () => {
  let dir;
  const mirrorUrl = 'https://registry.npmmirror.com/pkg/-/pkg-1.0.0.tgz';

  function run(...args) {
    return execFileSync(process.execPath, [TOOL_PATH, ...args], { encoding: 'utf8' });
  }

  // Node reports a non-zero child differently per platform, so read the status.
  function status(...args) {
    try {
      run(...args);
    } catch (error) {
      return error.status;
    }
    return 0;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-lock-cli-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exits non-zero when an offender it cannot vouch for survives', () => {
    const lockPath = path.join(dir, 'package-lock.json');
    fs.writeFileSync(lockPath, `{"packages":{"a":{"resolved":"${mirrorUrl}"}}}\n`);
    fs.writeFileSync(
      path.join(dir, 'other.json'),
      '{"packages":{"a":{"resolved":"https://mirror.example.com/a/-/a-1.tgz"}}}\n',
    );

    expect(run(lockPath)).toContain('1 resolved source(s) rewritten');
    expect(fs.readFileSync(lockPath, 'utf8')).toContain(
      'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz',
    );
    expect(status(path.join(dir, 'other.json'))).toBe(1);
  });

  it('exits non-zero for a target that is not a lockfile', () => {
    expect(status(path.join(dir, 'absent.json'))).toBe(1);
    expect(status(dir)).toBe(1);
  });

  it('reports a corrupt target without aborting the remaining arguments', () => {
    const broken = path.join(dir, 'broken.json');
    const good = path.join(dir, 'good.json');
    fs.writeFileSync(broken, '{"lockfileVersion": 3, "packages":');
    fs.writeFileSync(good, `{"packages":{"a":{"resolved":"${mirrorUrl}"}}}\n`);

    let combined = '';
    try {
      combined = run(broken, good);
    } catch (error) {
      combined = `${error.stdout}${error.stderr}`;
      expect(error.status).toBe(1);
    }
    expect(combined).toContain('not processed');
    expect(combined).toContain('1 resolved source(s) rewritten');
  });

  it('resolves its default target next to itself, not in the repo', () => {
    // `npm run normalize-lock` invokes the tool with no arguments. Running that
    // against the real lock would let a guard test repair the artifact it is
    // supposed to observe, so exercise the default through a throwaway copy.
    const repoLockBefore = fs.readFileSync(LOCK_PATH);
    const toolCopy = path.join(dir, 'scripts', 'normalize-lock-registry.cjs');
    fs.mkdirSync(path.dirname(toolCopy), { recursive: true });
    fs.copyFileSync(TOOL_PATH, toolCopy);
    fs.writeFileSync(
      path.join(dir, 'package-lock.json'),
      `{"packages":{"a":{"resolved":"${mirrorUrl}"}}}\n`,
    );

    expect(execFileSync(process.execPath, [toolCopy], { encoding: 'utf8', cwd: dir }))
      .toContain('1 resolved source(s) rewritten');
    expect(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8')).toContain(
      'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz',
    );
    expect(fs.readFileSync(LOCK_PATH)).toEqual(repoLockBefore);
  });
});

