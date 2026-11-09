/**
 * Tests for REQ-GATE-PROBE-SHORTCUT — gate input short-circuit (2026-11-09 handoff, P0-A/P0-B).
 *
 * @test REQ-GATE-PROBE-SHORTCUT
 * @intent A gate must decide "is there anything to check?" BEFORE it pays for a tool
 *         probe. On a project with no matching input the probe cost buys no information
 *         about the code. Proving this requires asserting on WHAT WAS SPAWNED — asserting
 *         only on the verdict cannot distinguish "cheap skip" from "expensive skip".
 *         Every short-circuit is paired with a "must NOT be short-circuited" case,
 *         because a filter written against the project instead of the change set
 *         produces "claims to have checked, checked nothing" (#615/#728 family).
 * @covers AC-GATE-PROBE-01 (no semgrep probe when no semgrep-supported file changed)
 * @covers AC-GATE-PROBE-02 (semgrep still probed+called when supported files changed)
 * @covers AC-GATE-PROBE-03 (no Python tool probes when project has no Python signal)
 * @covers AC-GATE-PROBE-04 (Python signal present -> full diagnostics still run)
 * @covers AC-GATE-PROBE-05 (npx fallback probe is off unless XP_GATE_NPX_PROBE=1)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: { ...actual, existsSync: vi.fn(), appendFileSync: vi.fn(), mkdirSync: vi.fn() },
    existsSync: vi.fn(),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

import { spawnSync } from 'child_process';
import { runGate9 } from '../gate-9';
import { checkPythonHealth, hasPythonSignal } from '../python-health';
import { isToolAvailable } from '../common';

const mockSpawnSync = vi.mocked(spawnSync);
const mockExistsSync = vi.mocked(fs.existsSync);

/**
 * The UNMOCKED fs, for the one case that must exercise a real directory walk.
 * Both `fs` and `fs.default` are replaced by this file's vi.mock, so the real
 * functions are pulled from the module graph via importActual.
 */
let realFs: typeof import('fs') | null = null;
async function loadRealFs(): Promise<typeof import('fs')> {
  if (!realFs) realFs = await vi.importActual<typeof import('fs')>('fs');
  return realFs;
}
function fsActual(): typeof import('fs') {
  if (!realFs) throw new Error('real fs not loaded');
  return realFs;
}

/** Every command string spawnSync was called with, in order. */
function spawnedCommands(): string[] {
  return mockSpawnSync.mock.calls.map((c) => String(c[0]));
}

/**
 * Every spawn rendered as "command arg1 arg2 ...", in order.
 * Tool names often live in the ARGS, not the command — python-health probes run
 * as `python -m mypy --version`, so a command-only view cannot see them.
 */
function spawnedInvocations(): string[] {
  return mockSpawnSync.mock.calls.map((c) => {
    const argv = Array.isArray(c[1]) ? (c[1] as string[]) : [];
    return [String(c[0]), ...argv.map(String)].join(' ');
  });
}

/** True when any spawn was the npx fallback probe. */
function spawnedNpx(): boolean {
  return spawnedCommands().some((c) => /(^|[\\/])npx(\.cmd)?$/i.test(c) || c === 'npx');
}

/** A spawn result that means "tool found on PATH". */
function found(toolPath: string) {
  return {
    status: 0, stdout: `${toolPath}\n`, stderr: '', pid: 1,
    output: ['', `${toolPath}\n`, ''], signal: null,
  } as any;
}

/** A spawn result that means "nothing found / failed". */
function notFound() {
  return { status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null } as any;
}

/**
 * A fake spawnSync that models a machine WITH a working Python and NO linters.
 * `probeToolNames` records every spawn as "cmd arg...".
 *
 * Branching is on the COMMAND first: `where python3` must be answered by `where`,
 * not mistaken for a `--version` probe (which is how the first version of this
 * fixture accidentally made `detectPython` fail and prove nothing).
 */
const PY_PROBE_TOOLS = ['mypy', 'pytest', 'ruff', 'flake8', 'black'];

function installRealPythonMock(probeToolNames: string[]) {
  const ok = (stdout: string) => ({ status: 0, stdout, stderr: '', pid: 1, output: ['', stdout, ''], signal: null }) as any;
  const bad = () => ({ status: 1, stdout: '', stderr: '', pid: 1, output: ['', '', ''], signal: null }) as any;
  const isPathLookup = (command: string) => command === 'where' || command === 'which';
  const looksLikeInterpreter = (command: string) => /python/.test(command);

  mockSpawnSync.mockImplementation(((cmd: string, args: string[]) => {
    const command = String(cmd).toLowerCase().replace(/.*[\/]/, '');
    const argv = (args || []).map(String);

    // PATH lookup for an interpreter.
    if (isPathLookup(command)) {
      return argv.some((a) => /^python[0-9.]*$|^py$/.test(a)) ? ok('/usr/bin/python3') : bad();
    }

    // The interpreter itself: --version, -m pip --version, -m <linter> --version.
    if (!looksLikeInterpreter(command)) return bad();

    const mIdx = argv.indexOf('-m');
    const module = mIdx >= 0 ? argv[mIdx + 1] : null;
    if (module && module !== 'pip') {
      return probeToolNames.includes(module) ? ok('1.0.0') : bad();
    }
    if (argv.includes('pip')) return ok('pip 24.0 from /usr/lib/pip');
    return argv.includes('--version') ? ok('Python 3.12.1') : bad();
  }) as any);
}

const ORIGINAL_NPX = process.env.XP_GATE_NPX_PROBE;

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  delete process.env.XP_GATE_NPX_PROBE;
});

afterEach(() => {
  if (ORIGINAL_NPX === undefined) delete process.env.XP_GATE_NPX_PROBE;
  else process.env.XP_GATE_NPX_PROBE = ORIGINAL_NPX;
});

// ─────────────────────────────────────────────────────────────
// AC-GATE-PROBE-01 — gate-9 must not probe when there is nothing to scan
// ─────────────────────────────────────────────────────────────
describe('AC-GATE-PROBE-01: gate-9 does not probe semgrep when no supported file changed', () => {
  it('performs ZERO spawns and reports SKIP for a change set of unsupported files', () => {
    mockSpawnSync.mockReturnValue(notFound());

    const result = runGate9({ changedFiles: ['README.md', 'data.json'], projectLang: 'typescript' });

    expect(result.status).toBe('SKIP');
    // The point of the fix: not "skipped after probing" but "never probed".
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('does not spawn npx for the probe even when semgrep is genuinely absent', () => {
    mockSpawnSync.mockReturnValue(notFound());

    runGate9({ changedFiles: ['docs/notes.md'], projectLang: 'typescript' });

    expect(spawnedNpx()).toBe(false);
  });

  it('still reports a semgrep-not-installed WARN (not SKIP) when supported files changed', () => {
    // Guards the neighbouring behaviour: the short-circuit must not turn a real
    // "tool missing" signal into a silent skip for inputs we are supposed to scan.
    mockSpawnSync.mockReturnValue(notFound());

    const result = runGate9({ changedFiles: ['src/app.ts'], projectLang: 'typescript' });

    expect(result.status).toBe('WARN');
    expect(result.messages.some((m) => m.includes('semgrep not installed'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// AC-GATE-PROBE-02 — the short-circuit must not swallow real input
// ─────────────────────────────────────────────────────────────
describe('AC-GATE-PROBE-02: a supported file must never be short-circuited away', () => {
  const SEMGREP_SUPPORTED = [
    'src/a.ts', 'src/b.tsx', 'src/c.js', 'src/d.jsx', 'src/e.py',
    'src/f.go', 'src/g.java', 'src/h.c', 'src/i.cpp', 'src/j.cs',
    'src/k.rb', 'src/l.php', 'src/m.scala', 'src/n.swift',
  ];

  it.each(SEMGREP_SUPPORTED)('probes semgrep and runs a scan for %s', (file) => {
    mockSpawnSync.mockReturnValueOnce(found('/usr/bin/semgrep'));
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '{"results":[]}', stderr: '', pid: 1, output: ['', '{"results":[]}', ''], signal: null,
    } as any);

    const result = runGate9({ changedFiles: [file], projectLang: 'typescript' });

    expect(result.status).toBe('PASS');
    // Two spawns: the PATH probe, then the real scan.
    expect(mockSpawnSync.mock.calls.length).toBeGreaterThanOrEqual(2);
    const scanCall = mockSpawnSync.mock.calls.find((c) => Array.isArray(c[1]) && (c[1] as string[]).includes('scan'));
    expect(scanCall, 'semgrep scan must actually be invoked').toBeTruthy();
    expect((scanCall![1] as string[])).toContain(file);
  });

  it('probes when the supported file is the ONLY entry in a large change set', () => {
    mockSpawnSync.mockReturnValueOnce(found('/usr/bin/semgrep'));
    mockSpawnSync.mockReturnValueOnce({
      status: 0, stdout: '{"results":[]}', stderr: '', pid: 1, output: ['', '{"results":[]}', ''], signal: null,
    } as any);

    const docs = Array.from({ length: 200 }, (_, i) => `docs/page-${i}.md`);
    const result = runGate9({ changedFiles: [...docs, 'src/one.ts'], projectLang: 'typescript' });

    expect(result.status).toBe('PASS');
  });
});

// ─────────────────────────────────────────────────────────────
// AC-GATE-PROBE-03 / 04 — python-health input short-circuit
// ─────────────────────────────────────────────────────────────
describe('AC-GATE-PROBE-03: no Python tool probes without a Python signal', () => {
  it('hasPythonSignal is false for a directory with no Python artefacts', () => {
    expect(hasPythonSignal('/nonexistent-project-root')).toBe(false);
  });

  it('probes no Python linters when the project has no Python signal', () => {
    // A real interpreter IS present (else checkPythonHealth short-circuits on
    // step 1 for an unrelated reason and this test would prove nothing).
    installRealPythonMock([]);

    checkPythonHealth('/nonexistent-project-root');

    const probes = spawnedInvocations().filter((inv) =>
      PY_PROBE_TOOLS.some((t) => new RegExp('\\b' + t + '\\b').test(inv))
    );
    expect(probes, `unexpected linter probes: ${probes.join(', ')}`).toEqual([]);
  });

  it('does not spend time proportional to the number of tools checked', () => {
    installRealPythonMock([]);

    const result = checkPythonHealth('/nonexistent-project-root');

    // Tools are still *reported* — just not probed. The report shape must not change.
    expect(result.tools.map((t) => t.name)).toEqual(PY_PROBE_TOOLS);
    expect(result.tools.every((t) => t.available === false)).toBe(true);
    // `available: false` alone is indistinguishable from "probed and missing".
    // toolProbesRan is what lets a consumer tell the two apart.
    expect(result.toolProbesRan).toBe(false);
  });

  it('reports toolProbesRan=true when the tools really were probed', () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => String(p).endsWith('pyproject.toml'));
    installRealPythonMock(PY_PROBE_TOOLS);

    const result = checkPythonHealth('/some/project');

    expect(result.toolProbesRan).toBe(true);
    expect(result.tools.every((t) => t.available)).toBe(true);
  });
});

describe('AC-GATE-PROBE-04: a Python signal must never be short-circuited away', () => {
  const SIGNAL_FILES = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', '.python-version', 'Pipfile'];

  it.each(SIGNAL_FILES)('treats %s as a Python signal', (marker) => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => String(p).endsWith(marker));
    expect(hasPythonSignal('/some/project')).toBe(true);
  });

  it('treats a directory containing .py files as a Python signal (real fs walk)', async () => {
    await loadRealFs();
    const os = require('os') as typeof import('os');
    const pathMod = require('path') as typeof import('path');
    // Use a real directory so the walk runs against the real filesystem; the
    // existsSync mock in this file would otherwise blind it.
    const dir = fsActual().mkdtempSync(pathMod.join(os.tmpdir(), 'xpgate-py-'));
    try {
      expect(hasPythonSignal(dir)).toBe(false);
      fsActual().mkdirSync(pathMod.join(dir, 'pkg'), { recursive: true });
      fsActual().writeFileSync(pathMod.join(dir, 'pkg', 'mod.py'), 'x = 1\n');
      expect(hasPythonSignal(dir)).toBe(true);
    } finally {
      fsActual().rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still runs full tool diagnostics when only pyproject.toml exists (no .py file)', () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => String(p).endsWith('pyproject.toml'));
    // A Python project WITH its linters installed.
    installRealPythonMock(PY_PROBE_TOOLS);

    const result = checkPythonHealth('/some/project');

    const probes = spawnedInvocations().filter((inv) =>
      PY_PROBE_TOOLS.some((t) => new RegExp('\\b' + t + '\\b').test(inv))
    );
    expect(probes.length, 'a Python project must still get tool diagnostics').toBeGreaterThan(0);
    expect(result.tools.every((t) => t.available), 'probed tools must report as available').toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// AC-GATE-PROBE-05 — npx fallback probe off by default
// ─────────────────────────────────────────────────────────────
describe('AC-GATE-PROBE-05: the npx fallback probe is opt-in', () => {
  it('never spawns npx when XP_GATE_NPX_PROBE is unset', () => {
    mockSpawnSync.mockReturnValue(notFound());

    isToolAvailable('semgrep', '/some/project');

    expect(spawnedNpx()).toBe(false);
  });

  it('never spawns npx when XP_GATE_NPX_PROBE=0', () => {
    process.env.XP_GATE_NPX_PROBE = '0';
    mockSpawnSync.mockReturnValue(notFound());

    isToolAvailable('some-uninstalled-tool', '/some/project');

    expect(spawnedNpx()).toBe(false);
  });

  it('spawns npx when XP_GATE_NPX_PROBE=1 (opt-in still works)', () => {
    process.env.XP_GATE_NPX_PROBE = '1';
    mockSpawnSync.mockImplementation(((cmd: string) => {
      if (String(cmd).includes('npx')) return found('npx some-tool');
      return notFound();
    }) as any);

    const result = isToolAvailable('some-uninstalled-tool', '/some/project');

    expect(spawnedNpx()).toBe(true);
    expect(result.via).toBe('npx');
  });

  it('PATH hits do not consult npx at all, even when the opt-in is on', () => {
    process.env.XP_GATE_NPX_PROBE = '1';
    mockSpawnSync.mockImplementation(((cmd: string) => {
      if (String(cmd).includes('npx')) return notFound();
      return found('/usr/bin/semgrep');
    }) as any);

    const result = isToolAvailable('semgrep', '/some/project');

    expect(result.via).toBe('path');
    expect(spawnedNpx()).toBe(false);
  });
});
