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

export function runGate8(input: GateInput): GateOutput {
  const startMs = Date.now();
  const cwd = input.cwd || process.cwd();
  const messages: string[] = [];

  messages.push('');
  messages.push('→ Gate 8: Secret scanning (gitleaks)...');

  // Tool detection
  const tool = isToolAvailable('gitleaks', cwd);
  if (!tool.available) {
    messages.push('     ℹ️  gitleaks not installed — secret scanning unavailable');
    messages.push('     Install: brew install gitleaks (macOS) | winget install gitleaks (Windows)');
    messages.push('     ⏭️  SKIPPED - Secret scanning (gitleaks not installed)');
    recordAudit('gate-8', 'secret-scanning', 'SKIP', 0, startMs);
    return { status: 'SKIP', messages, exitCode: 0 };
  }

  const gitleaksCmd = tool.via === 'npx' ? 'npx' : tool.path;
  const gitleaksArgs = buildGitleaksArgs(tool.via === 'npx', findGitleaksConfig(cwd));

  const result = runTool(gitleaksCmd, gitleaksArgs, { cwd });

  if (result.exitCode === 0) {
    messages.push('     ✅ PASSED - No secrets detected.');
    recordAudit('gate-8', 'secret-scanning', 'PASS', 0, startMs);
    return { status: 'PASS', messages, exitCode: 0 };
  }

  if (result.exitCode === 1) {
    messages.push(...secretsFoundMessages(result.stdout));
    recordAudit('gate-8', 'secret-scanning', 'FAIL', 1, startMs);
    return { status: 'FAIL', messages, exitCode: 1 };
  }

  messages.push(`     ⚠️  gitleaks exited with code ${result.exitCode} - skipping gate`);
  messages.push('     ✅ Secret Scanning (SKIP, gitleaks error)');
  recordAudit('gate-8', 'secret-scanning', 'SKIP', result.exitCode, startMs);
  return { status: 'SKIP', messages, exitCode: 0 };
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
