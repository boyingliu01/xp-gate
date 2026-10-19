/**
 * Shared infrastructure for TypeScript gate modules.
 * Provides cross-platform tool detection, process execution, audit logging,
 * project language detection, and PowerShell project support.
 */
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

// ── Process & tool primitives (split to common-process.ts for module size) ──

import { runTool, type PowerShellInfo, type ToolResult } from './common-process';

export {
  type ToolAvailability,
  type ToolResult,
  type PowerShellInfo,
  isToolAvailable,
  runTool,
  getChangedFiles,
  detectPowerShell,
} from './common-process';

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

// ── Language Detection ──

/** Any file in `dir` (non-recursive) matching one of the extensions. */
function hasFileWithExtension(dir: string, extensions: string[]): boolean {
  try {
    const files = fs.readdirSync(dir);
    return files.some((f) => extensions.some((ext) => f.endsWith(ext)));
  } catch { /* unreadable dir counts as absent — same as before */ }
  return false;
}

/** Java/Kotlin from Gradle markers: any .kt anywhere tips it to Kotlin. */
function detectJvmLanguage(dir: string): string {
  try {
    const files = fs.readdirSync(dir, { recursive: true }) as string[];
    if (files.some(f => typeof f === 'string' && f.endsWith('.kt'))) return 'kotlin';
  } catch { /* ignore */ }
  return 'java';
}

/** Marker-file language probes, tried in order; first hit wins. */
const LANG_MARKERS: Array<{ lang: string; files: string[] }> = [
  { lang: 'typescript', files: ['tsconfig.json'] },
  { lang: 'python', files: ['pyproject.toml', 'requirements.txt', 'setup.py'] },
  { lang: 'go', files: ['go.mod'] },
];

/** Dart vs Flutter, or null when there is no pubspec.yaml. */
function detectDartFlutter(dir: string): string | null {
  const pubspec = path.join(dir, 'pubspec.yaml');
  if (!fs.existsSync(pubspec)) return null;
  try {
    const content = fs.readFileSync(pubspec, 'utf-8');
    if (content.includes('flutter:') || fs.existsSync(path.join(dir, '.metadata'))) return 'flutter';
  } catch { /* A pubspec we cannot read is still a Dart project. */ }
  return 'dart';
}

/** JVM build files: Gradle wins over Maven, matching the original order. */
function detectJvm(dir: string): string | null {
  const hasGradle = fs.existsSync(path.join(dir, 'build.gradle'))
    || fs.existsSync(path.join(dir, 'build.gradle.kts'));
  if (hasGradle) return detectJvmLanguage(dir);
  if (fs.existsSync(path.join(dir, 'pom.xml'))) return 'java';
  return null;
}

/** Infrastructure-as-code by file extension, or null. */
function detectIac(dir: string): string | null {
  try {
    const files = fs.readdirSync(dir);
    if (files.some((f) => f.endsWith('.tf') || f === 'Dockerfile')) return 'iac';
  } catch { /* An unreadable directory proves nothing. */ }
  return null;
}

export function detectProjectLang(cwd?: string): string {
  const dir = cwd || process.cwd();

  for (const marker of LANG_MARKERS) {
    if (marker.files.some((f) => fs.existsSync(path.join(dir, f)))) return marker.lang;
  }

  const candidates = [
    detectJvm(dir),
    detectDartFlutter(dir),
    hasFileWithExtension(dir, ['.psd1', '.psm1', '.ps1']) ? 'powershell' : null,
    hasFileWithExtension(dir, ['.sh', '.bash']) ? 'shell' : null,
    detectIac(dir),
  ];
  return candidates.find((lang) => lang !== null) ?? 'unknown';
}

// ── PowerShell Support ──

/**
 * Detect PowerShell executable (prefer pwsh 7+, fallback to powershell.exe 5.1).
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
