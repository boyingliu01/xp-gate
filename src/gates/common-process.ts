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

/**
 * Cross-platform tool detection with 3-tier fallback:
 * 1. PATH lookup (command -v equivalent)
 * 2. npx fallback (for npm-installed tools)
 * 3. Custom path (~/.local/bin/ on Unix)
 */
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

/** Tier 2: npx fallback (check if tool is available via npx). */
function probeToolNpx(tool: string, cwd?: string): ToolAvailability {
  try {
    const npxCheck = spawnSync('npx', ['--yes', tool, '--version'], {
      encoding: 'utf-8',
      timeout: 15000,
      shell: process.platform === 'win32',
      cwd,
    });
    if (npxCheck.status === 0) {
      return { available: true, path: `npx ${tool}`, via: 'npx' };
    }
  } catch { /* probe failed → not reachable via npx */ }
  return { available: false, path: '', via: 'none' };
}

export function isToolAvailable(tool: string, cwd?: string): ToolAvailability {
  // Tier 1: PATH lookup
  const pathProbe = probeToolPath(tool);
  if (pathProbe.available) return pathProbe;

  // Tier 2: npx fallback
  const npxProbe = probeToolNpx(tool, cwd);
  if (npxProbe.available) return npxProbe;

  // Tier 3: Custom path (~/.local/bin/)
  if (process.platform !== 'win32') {
    const customPath = path.join(os.homedir(), '.local', 'bin', tool);
    if (fs.existsSync(customPath)) {
      return { available: true, path: customPath, via: 'custom' };
    }
  }

  return { available: false, path: '', via: 'none' };
}

// ── Process Execution ──

/**
 * Cross-platform spawnSync wrapper with timeout and error handling.
 * Uses spawnSync (not execSync) to avoid shell injection.
 */
export function runTool(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number; shell?: boolean }
): ToolResult {
  try {
    const result: SpawnSyncReturns<string> = spawnSync(cmd, args, {
      encoding: 'utf-8',
      cwd: opts?.cwd || process.cwd(),
      env: { ...process.env, ...opts?.env },
      timeout: opts?.timeoutMs || 120_000,
      maxBuffer: 10 * 1024 * 1024,
      shell: opts?.shell || process.platform === 'win32',
    });

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.status ?? -1,
      timedOut: result.signal === 'SIGTERM' || (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT',
    };
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
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const check = spawnSync(whichCmd, [exe], { encoding: 'utf-8', timeout: 5000 });
    if (check.status !== 0 || !check.stdout.trim()) return null;
    const exePath = check.stdout.trim().split('\n')[0];
    // Get version
    const verResult = spawnSync(exe, ['-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf-8',
      timeout: 10000,
      shell: process.platform === 'win32',
    });
    const version = verResult.status === 0 ? verResult.stdout.trim() : 'unknown';
    return { available: true, exe: exePath, version };
  } catch { /* probe failed → this candidate is not usable */ }
  return null;
}

export function detectPowerShell(): PowerShellInfo {
  const candidates = ['pwsh', 'powershell.exe', 'powershell'];

  for (const exe of candidates) {
    const found = probePowerShellCandidate(exe);
    if (found) return found;
  }

  return { available: false, exe: '', version: '' };
}
