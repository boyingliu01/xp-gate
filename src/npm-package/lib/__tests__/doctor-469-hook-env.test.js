/**
 * @test REQ-469 xp-gate doctor probes tools in the HOOK environment and reads
 *       the registry PATH fail-closed
 * @intent doctor 曾用 `where` / cmd.exe 直执探测 CLI 工具，而 pre-commit/pre-push
 *         钩子运行在 `bash -c` 里——两个环境对同一工具可以给出相反的答案，doctor 的
 *         "✓ All checks passed" 因此不构成对钩子运行环境的承诺（#469）。本套件固化
 *         三层修复：hook-env 探测为权威层、registry PATH 陈旧检测（fail-closed
 *         WARN）、`--refresh-env` 对新装工具的可见性恢复。
 * @covers AC-469-01 hook-env probe authoritative, AC-469-02 parseRegQueryPath,
 *          AC-469-03 stale-entry detection, AC-469-04 fail-closed WARN,
 *          AC-469-05 buildRefreshedPath keeps process PATH first,
 *          AC-469-06 --refresh-env flag contract
 */
const isWindows = process.platform === 'win32';
const describeWin = isWindows ? describe : describe.skip;

// Walkthrough FC-02: a bare `return` inside it() silently reports PASS on a
// runner without bash — a false-green in the very suite that guards against
// false greens. Bash-gated tests must SKIP loudly instead.
// On Windows a bare PATH 'bash' may resolve to the WSL System32 stub, whose
// argv handling drops `-c` positional args — probing through it answers for
// the wrong environment (the exact #469 failure class). Resolve the same
// authoritative bash the hooks get: checkBash().
const { checkBash } = require('../detect-deps.js');
const BASH_PROBE = (() => {
  const b = checkBash();
  return b.ok ? b.path : null;
})();
const itWithBash = BASH_PROBE ? it : it.skip;

describe('doctor hook-env probing (#469)', () => {
  function mod() {
    return require('../doctor');
  }

  itWithBash('AC-469-01: a tool the hook env sees is reported with its hook-env path', async () => {
    const { probeToolInHookEnv } = mod();
    const bashPath = isWindows ? BASH_PROBE : '/bin/sh';
    const p = await probeToolInHookEnv(isWindows ? 'node' : 'sh', bashPath);
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
  });

  itWithBash('AC-469-01: a tool absent from the hook env returns null — no fall-through', async () => {
    const { detectCliToolAsync } = mod();
    const result = await detectCliToolAsync('definitely-not-a-real-tool-xyz-469', isWindows, {
      bashPath: BASH_PROBE,
    });
    // With bash present there is NO fall-through: `where` finding nothing is
    // irrelevant here, the hook env verdict is final.
    expect(result.available).toBe(false);
  });

  it('AC-469-01: tool names outside the allowlist are rejected fail-closed (FC-04)', async () => {
    const { probeToolInHookEnv } = mod();
    // Injection guard: shell metacharacters never reach a command string.
    expect(await probeToolInHookEnv('node; rm -rf /', 'bash')).toBeNull();
    expect(await probeToolInHookEnv('node$(evil)', 'bash')).toBeNull();
    expect(await probeToolInHookEnv('', 'bash')).toBeNull();
  });

  itWithBash('AC-469-01: an installed tool is visible through the hook-env tier', async () => {
    const { detectCliToolAsync } = mod();
    const result = await detectCliToolAsync('node', true, { bashPath: BASH_PROBE });
    expect(result.available).toBe(true);
    // The hook-env path is POSIX form on Windows — cmd.exe cannot run it.
    if (isWindows) expect(result.path.startsWith('/')).toBe(true);
  });

  it('AC-469-02: parseRegQueryPath extracts the value from a reg query line', () => {
    const { parseRegQueryPath } = mod();
    const stdout = [
      '',
      'HKEY_CURRENT_USER\\Environment',
      '    Path    REG_EXPAND_SZ    C:\\tools\\bin;C:\\other',
      '',
    ].join('\r\n');
    expect(parseRegQueryPath(stdout)).toBe('C:\\tools\\bin;C:\\other');
    expect(parseRegQueryPath('    Path    REG_SZ    /usr/local/bin')).toBe('/usr/local/bin');
  });

  it('AC-469-02: parseRegQueryPath returns null when no Path value line exists', () => {
    const { parseRegQueryPath } = mod();
    expect(parseRegQueryPath('')).toBeNull();
    expect(parseRegQueryPath('ERROR: The system was unable to find the specified registry key or value.')).toBeNull();
    // A Path-like line without a value column is not evidence.
    expect(parseRegQueryPath('    Path    REG_SZ')).toBeNull();
  });

  it('AC-469-03: splitPathEntries and findStalePathEntries agree on normalization', () => {
    const { findStalePathEntries, splitPathEntries } = mod();
    expect(splitPathEntries('a;b;;c')).toEqual(['a', 'b', 'c']);
    // Registry-only entries are stale; entries the process sees are not.
    const stale = findStalePathEntries('C:\\tools\\bin', ['C:\\tools\\bin', 'C:\\fresh\\install']);
    expect(stale).toEqual(['C:\\fresh\\install']);
    // Case and trailing-separator differences are the same directory.
    expect(findStalePathEntries('c:\\tools\\bin\\', ['C:\\TOOLS\\BIN'])).toEqual([]);
  });

  it('AC-469-05: buildRefreshedPath keeps the process PATH FIRST and appends registry-only entries', () => {
    const { buildRefreshedPath } = mod();
    const processPath = 'C:\\git\\bin;C:\\windows';
    const registry = {
      machine: 'C:\\windows;C:\\new-machine-tool',
      user: 'C:\\new-user-tool',
    };
    const out = buildRefreshedPath(processPath, registry);
    const entries = out.split(';');
    // The process environment keeps priority — the shell that resolves
    // `bash` must be the one this doctor run diagnosed, not a re-resolution
    // through the registry (registry-first broke probe: WSL stub won).
    expect(entries.slice(0, 2)).toEqual(['C:\\git\\bin', 'C:\\windows']);
    expect(entries).toContain('C:\\new-machine-tool');
    expect(entries).toContain('C:\\new-user-tool');
    // No duplicates: the registry copies of process entries are dropped.
    expect(entries.filter((e) => e === 'C:\\windows')).toHaveLength(1);
  });
});

describeWin('doctor PATH staleness (#469, Windows-only)', () => {
  function mod() {
    return require('../doctor');
  }

  it('AC-469-04: an unreadable registry WARNs instead of claiming freshness', async () => {
    const { diagnosePathStaleness } = mod();
    const checks = [];
    await diagnosePathStaleness(checks, {
      registry: { supported: true, user: [], machine: [], userError: 'reg query failed for HKCU\\Environment', machineError: 'reg query failed for HKLM', error: 'combined' },
    });
    expect(checks).toHaveLength(1);
    expect(checks[0].name).toBe('PATH freshness');
    expect(checks[0].status).toBe('WARN');
    expect(checks[0].detail).toMatch(/staleness unknown|unreadable/);
  });

  it('AC-469-04: a readable hive still counts when only the other half fails (FC-07)', async () => {
    const { diagnosePathStaleness } = mod();
    // Machine hive readable and matching; user hive unreadable. The verdict
    // must be WARN (the user half is unknown) but the detail must carry the
    // machine-half evidence instead of discarding it.
    const processPath = process.env.PATH || '';
    const matchingMachine = processPath.split(';').slice(0, 2).join(';');
    const checks = [];
    await diagnosePathStaleness(checks, {
      registry: { supported: true, user: [], machine: matchingMachine.split(';'), userError: 'reg query failed for HKCU\\Environment', machineError: null, error: 'reg query failed for HKCU\\Environment' },
    });
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe('WARN');
    expect(checks[0].detail).toMatch(/User hive unreadable/);
    expect(checks[0].detail).toMatch(/Machine/);
  });

  it('AC-469-03: a matching PATH PASSes with no staleness claim', async () => {
    const { execSync } = require('child_process');
    // Real registry read; on a healthy terminal this must PASS. If the
    // sandbox blocks reg query the check must WARN (fail-closed), not PASS.
    let regOk = true;
    try { execSync('reg query "HKCU\\Environment" /v Path', { stdio: 'ignore' }); } catch { regOk = false; }
    const { diagnosePathStaleness } = mod();
    const checks = [];
    await diagnosePathStaleness(checks, {});
    expect(checks).toHaveLength(1);
    if (!regOk) {
      expect(checks[0].status).toBe('WARN');
      return;
    }
    // reg works: the verdict must be evidence-based. A stale terminal WARNs;
    // a fresh one PASSes — both are legal, a missing check is not.
    expect(['PASS', 'WARN']).toContain(checks[0].status);
    expect(checks[0].name).toBe('PATH freshness');
  });

  it('AC-469-03: stale registry entries WARN and mention --refresh-env', async () => {
    const { diagnosePathStaleness } = mod();
    // Inject a registry whose user PATH carries a directory this process
    // cannot see — the canonical "installed after this terminal opened".
    const { execSync } = require('child_process');
    const sandbox = 'C:\\__xpgate_469_nonexistent_dir__';
    const checks = [];
    await diagnosePathStaleness(checks, {
      registry: { supported: true, machine: [], user: [sandbox], error: null },
    });
    // A nonexistent dir cannot contain a tool, so the invisible-tool scan
    // adds nothing, but the staleness WARN itself must fire.
    try { execSync('bash --version', { stdio: 'ignore' }); } catch {
      // no bash: invisible-tool scan skipped, WARN still fires
    }
    expect(checks[0].status).toBe('WARN');
    expect(checks[0].detail).toMatch(/stale|--refresh-env/);
  });
});

describe('doctor --refresh-env flag contract (#469)', () => {
  it('AC-469-06: --refresh-env is a known flag and reaches doctorFlagContract output', () => {
    const { doctorFlagContract } = require('../doctor');
    const ok = doctorFlagContract(['--refresh-env']);
    expect(ok.errors).toEqual([]);
    expect(ok.refreshEnv).toBe(true);
    const plain = doctorFlagContract([]);
    expect(plain.refreshEnv).toBe(false);
    const bad = doctorFlagContract(['--refresh-env-typo']);
    expect(bad.errors.length).toBeGreaterThan(0);
  });
});
