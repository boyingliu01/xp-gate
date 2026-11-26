/**
 * Gate 8: Secret Scanning (gitleaks)
 * Detects secrets (API keys, passwords, tokens) in staged files.
 * TypeScript rewrite of githooks/adapters/gate-8.sh for cross-platform Node.js CLI.
 *
 * Scans the INDEX (`git --staged`), not committed history (#675, mirroring the
 * adapter fix in #449). gitleaks `git --pre-commit` walks committed revisions; on a
 * pre-commit run it reports "0 commits scanned" and exits 0. A staged secret
 * therefore passed the CLI while the hook blocked it -- and the CLI is the path CI
 * and the plugins use. `--staged` scans `git diff --cached`, exactly the
 * pre-commit payload. Same tool, same payload, one word different, opposite verdict.
 */
import path from 'path';
import fs from 'fs';
import {
  GateInput, GateOutput, isToolAvailable, runTool, recordAudit, getTempDir,
  getChangedFiles, detectProjectLang,
} from './common';

/**
 * SKIP when gitleaks is absent, naming how to install it.
 *
 * SKIP rather than BLOCK: secret scanning is fail-closed on a SCAN ERROR, but a missing
 * tool is a different claim -- nothing was examined either way, and the status says so.
 */
function skipNoGitleaks(startMs: number, messages: string[]): GateOutput {
  messages.push('     ℹ️  gitleaks not installed — secret scanning unavailable');
  messages.push('     Install: brew install gitleaks (macOS) | winget install gitleaks (Windows)');
  messages.push('     ⏭️  SKIPPED - Secret scanning (gitleaks not installed)');
  recordAudit('gate-8', 'secret-scanning', 'SKIP', 0, startMs);
  return { status: 'SKIP', messages, exitCode: 0 };
}

/** The verdict for a scan that found nothing. */
function passNoSecrets(startMs: number, messages: string[]): GateOutput {
  messages.push('     ✅ PASSED - No secrets detected.');
  recordAudit('gate-8', 'secret-scanning', 'PASS', 0, startMs);
  return { status: 'PASS', messages, exitCode: 0 };
}

/**
 * Run gitleaks for this project.
 *
 * `npx` is a COMMAND LINE, not a path: the tool reports it as `npx gitleaks`, which cannot
 * be executed as a file.
 */
function runGitleaks(tool: { via?: string; path: string }, cwd: string) {
  const viaNpx = tool.via === 'npx';
  return runTool(
    viaNpx ? 'npx' : tool.path,
    buildGitleaksArgs(viaNpx, findGitleaksConfig(cwd)),
    { cwd },
  );
}

export function runGate8(input: GateInput): GateOutput {
  const startMs = Date.now();
  const cwd = input.cwd || process.cwd();
  const messages: string[] = [];

  messages.push('');
  messages.push('→ Gate 8: Secret scanning (gitleaks)...');

  // Tool detection
  const tool = isToolAvailable('gitleaks', cwd);
  if (!tool.available) return skipNoGitleaks(startMs, messages);

  const result = runGitleaks(tool, cwd);

  if (result.exitCode === 0) return passNoSecrets(startMs, messages);

  if (result.exitCode === 1) return secretsFound(startMs, messages, result.stdout);
  return gitleaksErrored(startMs, messages, result.exitCode);
}

/**
 * gitleaks exit 1 means it FOUND something -- the one verdict that must block.
 *
 * Its findings go to stdout as JSON, which is what `secretsFoundMessages` renders.
 */
function secretsFound(startMs: number, messages: string[], stdout: string): GateOutput {
  messages.push(...secretsFoundMessages(stdout));
  recordAudit('gate-8', 'secret-scanning', 'FAIL', 1, startMs);
  return { status: 'FAIL', messages, exitCode: 1 };
}

/**
 * Any other non-zero exit is the TOOL misbehaving, not a finding.
 *
 * SKIP rather than PASS: nothing was examined, and a PASS here would claim the
 * repository is clean on the strength of a broken scan.
 */
/**
 * gitleaks could not complete: FAIL, not SKIP.
 *
 * `AGENTS.md` states the rule as "Tool missing → SKIP, not BLOCK — except secret
 * scanning, which is fail-closed: a security gate that cannot run must not report
 * success." A gitleaks that timed out or crashed is exactly "cannot run", and this
 * returned `SKIP` with exit code 0 while printing a green tick -- the third of those
 * three statements contradicted the first two (review FC-01).
 *
 * A MISSING gitleaks still SKIPs: that is a deliberate choice about a development
 * checkout without the tool, and it is unchanged. Whether the scan STARTED and failed is
 * a different question from whether it could start at all.
 */
function gitleaksErrored(startMs: number, messages: string[], exitCode: number): GateOutput {
  messages.push(`     ❌ FAILED - Secret scanning could not complete (gitleaks exited ${exitCode})`);
  messages.push('     This is NOT a clean scan: nothing was verified. Fix gitleaks, then re-run.');
  recordAudit('gate-8', 'secret-scanning', 'FAIL', exitCode, startMs);
  return { status: 'FAIL', messages, exitCode: 1 };
}

/** The report + remediation shown when gitleaks finds secrets (exit code 1). */
function secretsFoundMessages(stdout: string): string[] {
  return [
    stdout,
    '',
    '❌ BLOCKED - Secrets detected in staged files.',
    '',
    'Remediation options:',
    '  1. Remove the secret and use environment variables instead',
    '  2. Add a false positive to .gitleaks.toml allowlist',
    '  3. Use git secret or vault for sensitive data',
    '',
    'See: https://github.com/gitleaks/gitleaks',
  ];
}

function findGitleaksConfig(cwd: string): string | null {
  const configPath = path.join(cwd, '.gitleaks.toml');
  return fs.existsSync(configPath) ? configPath : null;
}

/**
 * Assemble the gitleaks argument vector.
 *
 * Report goes to a cross-platform temp path (the old hardcoded `/tmp` broke on
 * Windows), and the scan reads the INDEX -- see the file header for why (#675).
 */
function buildGitleaksArgs(viaNpx: boolean, configPath: string | null): string[] {
  const args = viaNpx ? ['-y', 'gitleaks'] : [];
  if (configPath) args.push(`--config=${configPath}`);
  args.push('git', '--staged', '--redact', '--no-banner',
    '--report-format=json', `--report-path=${path.join(getTempDir(), 'gitleaks-report.json')}`);
  return args;
}

// ── CLI Entry Point ──
if (process.argv.includes('--run')) {
  const cwdIdx = process.argv.indexOf('--cwd');
  const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
  const changedFiles = getChangedFiles(cwd);
  const projectLang = detectProjectLang(cwd);
  const result = runGate8({ changedFiles, projectLang, cwd });
  result.messages.forEach(m => console.log(m));
  process.exit(result.exitCode);
}
