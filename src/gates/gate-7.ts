/**
 * Gate 7: IaC Security Scanning (Terraform, Kubernetes, Docker, PowerShell DSC)
 * Detects security issues in Infrastructure as Code files.
 * TypeScript rewrite of githooks/adapters/gate-7.sh for cross-platform Node.js CLI.
 */
import path from 'path';
import fs from 'fs';
import {
  GateInput, GateOutput, isToolAvailable, runTool, recordAudit, filterIaCFiles,
  getChangedFiles, detectProjectLang,
} from './common';

export function runGate7(input: GateInput): GateOutput {
  const startMs = Date.now();
  const cwd = input.cwd || process.cwd();
  const messages: string[] = [];

  messages.push('');
  messages.push('→ Gate 7: IaC Security Scanning (Terraform, Kubernetes, Docker)...');

  // Filter to IaC files (includes PowerShell DSC per design)
  const iacFiles = filterIaCFiles(input.changedFiles);

  if (iacFiles.length === 0) {
    messages.push('✅ PASSED - No IaC files detected in changes.');
    recordAudit('gate-7', 'iac-security', 'PASS', 0, startMs);
    return { status: 'PASS', messages, exitCode: 0 };
  }

  // Check for IaC adapter script (bash path for pre-commit context)
  const adapterPath = findIaCAdapter(cwd);
  if (!adapterPath) {
    messages.push('ℹ️  SKIP - IaC adapter not found');
    messages.push('⏭️  SKIPPED - IaC security (no IaC adapter found)');
    recordAudit('gate-7', 'iac-security', 'SKIP', 0, startMs);
    return { status: 'SKIP', messages, exitCode: 0 };
  }

  // Run checkov if available (preferred tool)
  const checkov = isToolAvailable('checkov', cwd);
  if (checkov.available) {
    return runCheckov(checkov.path, checkov.via, iacFiles, cwd, startMs, messages);
  }

  // Fallback: run the bash IaC adapter via bash
  messages.push('⚠️  checkov not installed — falling back to bash IaC adapter');
  messages.push('   Install: pip install checkov');

  const result = runTool('bash', [adapterPath, ...iacFiles], { cwd });
  const combinedOutput = result.stdout + result.stderr;

  if (result.exitCode === 0) {
    messages.push(combinedOutput);
    messages.push('✅ PASSED - IaC security scan.');
    recordAudit('gate-7', 'iac-security', 'PASS', 0, startMs);
    return { status: 'PASS', messages, exitCode: 0 };
  }

  messages.push(combinedOutput);
  messages.push('');
  messages.push('❌ BLOCKED - IaC security issues detected');
  messages.push('Fix the security issues above before committing.');
  messages.push('Tip: Install checkov for comprehensive IaC scanning: pip install checkov');
  recordAudit('gate-7', 'iac-security', 'FAIL', result.exitCode, startMs);
  return { status: 'FAIL', messages, exitCode: 1 };
}

function runCheckov(
  cmdPath: string,
  via: string,
  files: string[],
  cwd: string,
  startMs: number,
  messages: string[]
): GateOutput {
  const checkovCmd = via === 'npx' ? 'npx' : cmdPath;
  const checkovArgs = via === 'npx' ? ['-y', 'checkov'] : [];

  // Detect config file
  const configPath = path.join(cwd, '.checkov.yaml');
  if (fs.existsSync(configPath)) {
    checkovArgs.push('--config-file', configPath);
  }

  // Run checkov on the changed IaC files
  checkovArgs.push('--file', ...files, '--quiet', '--compact');

  const result = runTool(checkovCmd, checkovArgs, { cwd });
  const combinedOutput = result.stdout + result.stderr;

  if (result.exitCode === 0) {
    messages.push(combinedOutput);
    messages.push('✅ PASSED - IaC security scan.');
    recordAudit('gate-7', 'iac-security', 'PASS', 0, startMs);
    return { status: 'PASS', messages, exitCode: 0 };
  }

  messages.push(combinedOutput);
  messages.push('');
  messages.push('❌ BLOCKED - IaC security issues detected');
  messages.push('Fix the security issues above before committing.');
  recordAudit('gate-7', 'iac-security', 'FAIL', result.exitCode, startMs);
  return { status: 'FAIL', messages, exitCode: 1 };
}

function findIaCAdapter(cwd: string): string | null {
  const candidates = [
    path.join(cwd, 'githooks', 'adapters', 'iac.sh'),
    path.join(cwd, 'githooks', 'adapters', 'iac', 'iac.sh'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// ── CLI Entry Point ──
if (process.argv.includes('--run')) {
  const cwdIdx = process.argv.indexOf('--cwd');
  const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
  const changedFiles = getChangedFiles(cwd);
  const projectLang = detectProjectLang(cwd);
  const result = runGate7({ changedFiles, projectLang, cwd });
  result.messages.forEach(m => console.log(m));
  process.exit(result.exitCode);
}
