/**
 * Shared infrastructure for TypeScript gate modules.
 * Provides cross-platform tool detection, process execution, audit logging,
 * project language detection, and PowerShell project support.
 */
import { spawnSync, SpawnSyncReturns } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Types ──

export interface GateInput {
  changedFiles: string[];
  projectLang: string;
  cwd?: string;
}

export interface GateOutput {
  status: 'PASS' | 'FAIL' | 'SKIP' | 'WARN';
  messages: string[];
  exitCode: number;
}

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
export function isToolAvailable(tool: string, cwd?: string): ToolAvailability {
  // Tier 1: PATH lookup
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const pathCheck = spawnSync(whichCmd, [tool], { encoding: 'utf-8', timeout: 5000 });
  if (pathCheck.status === 0 && pathCheck.stdout.trim()) {
    return { available: true, path: pathCheck.stdout.trim().split('\n')[0], via: 'path' };
  }

  // Tier 2: npx fallback (check if tool is available via npx)
  const npxCheck = spawnSync('npx', ['--yes', tool, '--version'], {
    encoding: 'utf-8',
    timeout: 15000,
    shell: process.platform === 'win32',
    cwd,
  });
  if (npxCheck.status === 0) {
    return { available: true, path: `npx ${tool}`, via: 'npx' };
  }

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
}

// ── Audit Logging ──

const AUDIT_DIR = '.xp-gate';
const AUDIT_FILE = 'audit.jsonl';

/**
 * Record gate execution to .xp-gate/audit.jsonl.
 * Schema must match bash version's record_gate_audit() output.
 */
export function recordAudit(
  gateId: string,
  gateName: string,
  status: string,
  details: string | number,
  startMs: number
): void {
  const durationMs = Date.now() - startMs;
  const entry = {
    timestamp: new Date().toISOString(),
    gate: gateId,
    name: gateName,
    status,
    details: String(details),
    duration_ms: durationMs,
  };

  try {
    if (!fs.existsSync(AUDIT_DIR)) {
      fs.mkdirSync(AUDIT_DIR, { recursive: true });
    }
    fs.appendFileSync(path.join(AUDIT_DIR, AUDIT_FILE), JSON.stringify(entry) + '\n');
  } catch {
    // Audit logging failure should not block the gate
  }
}

// ── Git Helpers ──

/**
 * Get list of changed (staged) files via git diff --cached.
 * Equivalent to adapter-common.sh's git diff --cached --name-only.
 */
export function getChangedFiles(cwd?: string): string[] {
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
}

/**
 * Detect project language from marker files.
 * Equivalent to adapter-common.sh's detect_project_lang().
 * Includes PowerShell detection (.psd1/.psm1/.ps1).
 */
export function detectProjectLang(cwd?: string): string {
  const dir = cwd || process.cwd();

  if (fs.existsSync(path.join(dir, 'tsconfig.json'))) return 'typescript';
  if (
    fs.existsSync(path.join(dir, 'pyproject.toml')) ||
    fs.existsSync(path.join(dir, 'requirements.txt')) ||
    fs.existsSync(path.join(dir, 'setup.py'))
  )
    return 'python';
  if (fs.existsSync(path.join(dir, 'go.mod'))) return 'go';

  // Java / Kotlin
  if (fs.existsSync(path.join(dir, 'build.gradle')) || fs.existsSync(path.join(dir, 'build.gradle.kts'))) {
    // Check for Kotlin files
    try {
      const files = fs.readdirSync(dir, { recursive: true }) as string[];
      if (files.some(f => typeof f === 'string' && f.endsWith('.kt'))) return 'kotlin';
    } catch { /* ignore */ }
    return 'java';
  }
  if (fs.existsSync(path.join(dir, 'pom.xml'))) return 'java';

  // Dart / Flutter
  if (fs.existsSync(path.join(dir, 'pubspec.yaml'))) {
    try {
      const content = fs.readFileSync(path.join(dir, 'pubspec.yaml'), 'utf-8');
      if (content.includes('flutter:') || fs.existsSync(path.join(dir, '.metadata'))) return 'flutter';
    } catch { /* ignore */ }
    return 'dart';
  }

  // PowerShell — check for .psd1/.psm1 or *.ps1 files
  try {
    const files = fs.readdirSync(dir);
    if (files.some(f => f.endsWith('.psd1') || f.endsWith('.psm1'))) return 'powershell';
    const ps1Files = files.filter(f => f.endsWith('.ps1'));
    if (ps1Files.length > 0) return 'powershell';
  } catch { /* ignore */ }

  // Shell
  try {
    const files = fs.readdirSync(dir);
    if (files.some(f => f.endsWith('.sh') || f.endsWith('.bash'))) return 'shell';
  } catch { /* ignore */ }

  // IaC
  try {
    const files = fs.readdirSync(dir);
    if (files.some(f => f.endsWith('.tf') || f === 'Dockerfile')) return 'iac';
  } catch { /* ignore */ }

  return 'unknown';
}

// ── PowerShell Support ──

/**
 * Detect PowerShell executable (prefer pwsh 7+, fallback to powershell.exe 5.1).
 * Mirrors powershell.sh's _detect_pwsh() pattern.
 */
export function detectPowerShell(): PowerShellInfo {
  const candidates = ['pwsh', 'powershell.exe', 'powershell'];

  for (const exe of candidates) {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const check = spawnSync(whichCmd, [exe], { encoding: 'utf-8', timeout: 5000 });
    if (check.status === 0 && check.stdout.trim()) {
      const exePath = check.stdout.trim().split('\n')[0];
      // Get version
      const verResult = spawnSync(exe, ['-Command', '$PSVersionTable.PSVersion.ToString()'], {
        encoding: 'utf-8',
        timeout: 10000,
        shell: process.platform === 'win32',
      });
      const version = verResult.status === 0 ? verResult.stdout.trim() : 'unknown';
      return { available: true, exe: exePath, version };
    }
  }

  return { available: false, exe: '', version: '' };
}

/**
 * Check if the project language is PowerShell.
 */
export function isPowerShellProject(projectLang: string): boolean {
  return projectLang === 'powershell';
}

/**
 * Run a PowerShell tool/script via the detected PowerShell executable.
 */
export function runPowerShellTool(
  psInfo: PowerShellInfo,
  command: string,
  opts?: { cwd?: string; timeoutMs?: number }
): ToolResult {
  if (!psInfo.available) {
    return { stdout: '', stderr: 'PowerShell not available', exitCode: -1, timedOut: false };
  }
  return runTool(psInfo.exe, ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: opts?.cwd,
    timeoutMs: opts?.timeoutMs,
  });
}

// ── Temp Directory ──

/**
 * Cross-platform temp directory (Windows: %TEMP%, Linux/macOS: /tmp).
 */
export function getTempDir(): string {
  return os.tmpdir();
}

// ── File Filtering Helpers ──

/** Source file extensions that lizard can analyze. */
const LIZARD_EXTENSIONS = /\.(ts|tsx|js|jsx|py|go|java|swift|cpp|c|hpp|h|m|mm|kt)$/;

/** File extensions that semgrep supports. */
const SEMGREP_EXTENSIONS = /\.(ts|tsx|js|jsx|py|go|java|c|cpp|cs|rb|php|scala|swift)$/;

/** IaC file patterns. */
const IAC_PATTERN = /\.(tf|yaml|yml)$|Dockerfile/;

/** PowerShell DSC file patterns. */
const PS_DSC_PATTERN = /\.configuration\.ps1$|\.mof$/;

export function filterSourceFiles(files: string[]): string[] {
  return files.filter(f => LIZARD_EXTENSIONS.test(f));
}

export function filterSemgrepFiles(files: string[]): string[] {
  return files.filter(f => SEMGREP_EXTENSIONS.test(f));
}

export function filterIaCFiles(files: string[]): string[] {
  return files.filter(f => IAC_PATTERN.test(f) || PS_DSC_PATTERN.test(f));
}
