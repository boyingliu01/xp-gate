/**
 * Gate 8: Secret Scanning (gitleaks)
 * Detects secrets (API keys, passwords, tokens) in staged files.
 * TypeScript rewrite of githooks/adapters/gate-8.sh for cross-platform Node.js CLI.
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
  const gitleaksArgs = tool.via === 'npx' ? ['-y', 'gitleaks'] : [];

  // Config detection
  const configPath = findGitleaksConfig(cwd);
  if (configPath) {
    gitleaksArgs.push(`--config=${configPath}`);
  }

  // Cross-platform temp path (fixes /tmp issue on Windows)
  const reportPath = path.join(getTempDir(), 'gitleaks-report.json');

  // Run gitleaks on staged changes
  gitleaksArgs.push('git', '--pre-commit', '--redact', '--no-banner',
    '--report-format=json', `--report-path=${reportPath}`);

  const result = runTool(gitleaksCmd, gitleaksArgs, { cwd });

  if (result.exitCode === 0) {
    messages.push('     ✅ PASSED - No secrets detected.');
    recordAudit('gate-8', 'secret-scanning', 'PASS', 0, startMs);
    return { status: 'PASS', messages, exitCode: 0 };
  }

  if (result.exitCode === 1) {
    // Secrets found
    messages.push(result.stdout);
    messages.push('');
    messages.push('❌ BLOCKED - Secrets detected in staged files.');
    messages.push('');
    messages.push('Remediation options:');
    messages.push('  1. Remove the secret and use environment variables instead');
    messages.push('  2. Add a false positive to .gitleaks.toml allowlist');
    messages.push('  3. Use git secret or vault for sensitive data');
    messages.push('');
    messages.push('See: https://github.com/gitleaks/gitleaks');
    recordAudit('gate-8', 'secret-scanning', 'FAIL', 1, startMs);
    return { status: 'FAIL', messages, exitCode: 1 };
  }

  // Runtime error
  messages.push(`     ⚠️  gitleaks exited with code ${result.exitCode} - skipping gate`);
  messages.push('     ✅ Secret Scanning (SKIP, gitleaks error)');
  recordAudit('gate-8', 'secret-scanning', 'SKIP', result.exitCode, startMs);
  return { status: 'SKIP', messages, exitCode: 0 };
}

function findGitleaksConfig(cwd: string): string | null {
  const configPath = path.join(cwd, '.gitleaks.toml');
  return fs.existsSync(configPath) ? configPath : null;
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
