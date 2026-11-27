/**
 * Process-execution and tool-detection primitives shared by the gates.
 * Split out of common.ts (Boy Scout: many-exports); re-exported there so
 * every existing `from '../common'` import keeps working unchanged.
 */
import { spawnSync, SpawnSyncReturns } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface ToolAvailability {
  available: boolean;
  path: string;
  via: 'path' | 'npx' | 'custom' | 'none';
}

export interface ToolResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface PowerShellInfo {
  available: boolean;
  exe: string;
  version: string;
}

// ── Tool Detection ──

/** Tier 1: PATH lookup. */
function probeToolPath(tool: string): ToolAvailability {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const pathCheck = spawnSync(whichCmd, [tool], { encoding: 'utf-8', timeout: 5000 });
    if (pathCheck.status === 0 && pathCheck.stdout.trim()) {
      return { available: true, path: pathCheck.stdout.trim().split('\n')[0], via: 'path' };
    }
  } catch { /* probe failed → not on PATH */ }
  return { available: false, path: '', via: 'none' };
}

/**
 * Is the npx fallback probe enabled?
 *
 * `probeToolNpx` answers "is this tool installed?" by running
 * `npx --yes <tool> --version`. `--yes` means "do not ask, just download and
 * install it" — so to answer a question about the LOCAL environment, XP-Gate
 * could reach the npm registry, download a whole package, and execute it. On
 * this machine that costs 4-6 s per tool, hangs for the full 15 s timeout when
 * offline, and installs packages on someone else's machine without asking.
 *
 * That is the wrong default for a quality gate, so it is OFF unless explicitly
 * requested. Measured on this machine (2026-11-09): the probe is the single
 * largest avoidable per-tool cost, and every tool this repo's gates use
 * (semgrep, lizard, gitleaks, mypy, ruff) is normally on PATH anyway.
 *
 * Setting `XP_GATE_NPX_PROBE=1` restores the old behaviour for projects that
 * deliberately rely on npx-provided tooling (typically CI).
 */
function npxProbeEnabled(): boolean {
  const raw = process.env.XP_GATE_NPX_PROBE;
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Tier 2: npx fallback. No-op unless `XP_GATE_NPX_PROBE=1` (see npxProbeEnabled). */
function probeToolNpx(tool: string, cwd?: string): ToolAvailability {
  if (!npxProbeEnabled()) return { available: false, path: '', via: 'none' };
  return npxVersionSucceeds(tool, cwd)
    ? { available: true, path: `npx ${tool}`, via: 'npx' }
    : { available: false, path: '', via: 'none' };
}

/**
 * Run `npx --yes <tool> --version` and report whether it exited 0.
 *
 * Split out of probeToolNpx so the spawn options and the exit-status rule are not
 * three nesting levels inside a function whose real question is one boolean. A
 * throw is not an error here: npx being unreachable IS the answer to "is this
 * tool available via npx", so it reads as `false` rather than propagating.
 */
function npxVersionSucceeds(tool: string, cwd?: string): boolean {
  try {
    const npxCheck = spawnSync('npx', ['--yes', tool, '--version'], {
      encoding: 'utf-8',
      timeout: 15000,
      shell: process.platform === 'win32',
      cwd,
    });
    return npxCheck.status === 0;
  } catch {
    return false;
  }
}

/**
 * Cross-platform tool detection with 3-tier fallback:
 * 1. PATH lookup (command -v equivalent)
 * 2. npx fallback (for npm-installed tools) — OPT-IN, see npxProbeEnabled()
 * 3. Custom path (~/.local/bin/ on Unix)
 *
 * Tier 2 is skipped unless `XP_GATE_NPX_PROBE=1`, because it installs packages
 * to answer a question about the local environment.
 */
export function isToolAvailable(tool: string, cwd?: string): ToolAvailability {
  // Tier 1: PATH lookup
  const pathProbe = probeToolPath(tool);
  if (pathProbe.available) return pathProbe;

  // Tier 2: npx fallback
  const npxProbe = probeToolNpx(tool, cwd);
  if (npxProbe.available) return npxProbe;

  // Tier 3: a hand-installed binary.
  return probeCustomPath(tool) ?? { available: false, path: '', via: 'none' };
}

/**
 * Look for the tool under `~/.local/bin`, the usual home for a hand-installed binary.
 *
 * POSIX only: on Windows that directory means nothing, and the PATH and npx probes
 * already cover the platform's own conventions. Returning null rather than an
 * unavailable result lets the caller keep its single "not found" return.
 */
function probeCustomPath(tool: string): ToolAvailability | null {
  if (process.platform === 'win32') return null;
  const customPath = path.join(os.homedir(), '.local', 'bin', tool);
  return fs.existsSync(customPath) ? { available: true, path: customPath, via: 'custom' } : null;
}

// ── Process Execution ──

/**
 * Cross-platform spawnSync wrapper with timeout and error handling.
 * Uses spawnSync (not execSync) to avoid shell injection.
 */
/** The default budget a child process gets before it is killed. */
const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

/** The largest output a child may produce before it is truncated. */
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** A spawn's options, with the defaults a gate needs on every call. */
function spawnOptions(opts: RunToolOptions = {}) {
  return {
    encoding: 'utf-8' as const,
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, ...opts.env },
    // A tool that never answers must FAIL the gate rather than hang it, so a timeout is
    // not optional -- and the buffer is bounded for the same reason.
    timeout: opts.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    shell: needsShell(opts.shell),
  };
}

/**
 * Whether to run the command through a shell.
 *
 * Windows resolves `.cmd` shims only through a shell; elsewhere a shell would let the OS
 * re-split a path containing spaces.
 */
function needsShell(explicit: boolean | undefined): boolean {
  return explicit ?? process.platform === 'win32';
}

/**
 * The gate's view of a finished spawn.
 *
 * A `status` of `null` means the child never exited normally, so it is reported as -1
 * rather than 0 -- a killed process must not look like a clean run. `ETIMEDOUT` is
 * TIMED OUT even when a signal was not recorded, because Node reports the timeout
 * through `error` on some platforms and through `signal` on others.
 */
function toToolResult(result: SpawnSyncReturns<string>): ToolResult {
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status ?? -1,
    timedOut: result.signal === 'SIGTERM'
      || (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT',
  };
}

/** What a caller may override about a spawned tool. */
export interface RunToolOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  shell?: boolean;
}

export function runTool(
  cmd: string,
  args: string[],
  opts?: RunToolOptions
): ToolResult {
  try {
    return toToolResult(spawnSync(cmd, args, spawnOptions(opts)));
  } catch (err) {
    // spawnSync throws on ENOENT-class failures; report them as a failed run
    // with the message on stderr instead of crashing every caller.
    return { stdout: '', stderr: err instanceof Error ? err.message : String(err), exitCode: -1, timedOut: false };
  }
}

// ── Git Helpers ──

/**
 * Get list of changed (staged) files via git diff --cached.
 * Equivalent to adapter-common.sh's git diff --cached --name-only.
 */
export function getChangedFiles(cwd?: string): string[] {
  try {
    const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
      encoding: 'utf-8',
      cwd: cwd || process.cwd(),
      timeout: 10000,
    });
    if (result.status !== 0) return [];
    return result.stdout
      .split('\n')
      .map(f => f.trim())
      .filter(Boolean);
  } catch {
    // No git / unreadable repo → no changed files, same as a failed status.
    return [];
  }
}

// ── PowerShell Support ──

/**
 * Detect PowerShell executable (prefer pwsh 7+, fallback to powershell.exe 5.1).
 * Mirrors powershell.sh's _detect_pwsh() pattern.
 */
/** Probe one candidate executable; null when it is not on PATH. */
function probePowerShellCandidate(exe: string): PowerShellInfo | null {
  try {
    const exePath = resolveOnPath(exe);
    return exePath ? { available: true, exe: exePath, version: powershellVersionOf(exe) } : null;
  } catch {
    // The probe itself failed, so this candidate is not usable -- never a crash.
    return null;
  }
}

/** The command that resolves an executable on PATH, per platform. */
function whichCommand(): string {
  return process.platform === 'win32' ? 'where' : 'which';
}

/**
 * The absolute path this name resolves to, or null.
 *
 * The FIRST line only: `where` prints every match, and probing the second one would
 * report a version for a binary the gate will not run.
 */
function resolveOnPath(exe: string): string | null {
  try {
    const check = spawnSync(whichCommand(), [exe], { encoding: 'utf-8', timeout: 5000 });
    if (check.status !== 0 || !check.stdout.trim()) return null;
    return check.stdout.trim().split('\n')[0];
  } catch {
    // A PATH lookup that throws means the name does not resolve here.
    return null;
  }
}

/**
 * The PowerShell version, or `unknown`.
 *
 * `unknown` rather than a failure: the binary RESOLVED, so the gate can use it -- not
 * knowing its version is a reporting gap, not a reason to pretend it is absent.
 */
function powershellVersionOf(exe: string): string {
  try {
    const probe = spawnSync(exe, ['-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf-8',
      timeout: 10_000,
      shell: process.platform === 'win32',
    });
    return probe.status === 0 ? probe.stdout.trim() : 'unknown';
  } catch {
    // The binary resolved but would not run: still a usable candidate, version unknown.
    return 'unknown';
  }
}

export function detectPowerShell(): PowerShellInfo {
  const candidates = ['pwsh', 'powershell.exe', 'powershell'];

  for (const exe of candidates) {
    const found = probePowerShellCandidate(exe);
    if (found) return found;
  }

  return { available: false, exe: '', version: '' };
}
