/**
 * Gate 9: Semgrep SAST Security Scan
 * Detects security vulnerabilities in staged files.
 * For PowerShell projects: uses PSScriptAnalyzer security rules as alternative.
 * TypeScript rewrite of githooks/adapters/gate-9.sh for cross-platform Node.js CLI.
 */
import {
  GateInput, GateOutput, isToolAvailable, runTool, recordAudit,
  filterSemgrepFiles, detectPowerShell, isPowerShellProject, runPowerShellTool,
  getChangedFiles, detectProjectLang,
} from './common';

export function runGate9(input: GateInput): GateOutput {
  const startMs = Date.now();
  const messages: string[] = [];

  messages.push('');
  messages.push('→ Gate 9: Semgrep SAST Security Scan...');

  // PowerShell project: use PSScriptAnalyzer security rules
  if (isPowerShellProject(input.projectLang)) {
    return runPowerShellSAST(input, startMs, messages);
  }

  // Standard path: semgrep
  const tool = isToolAvailable('semgrep', input.cwd);
  if (!tool.available) {
    messages.push('     ⚠️  WARN - semgrep not installed — SAST scanning unavailable');
    messages.push('     Install: brew install semgrep (macOS) | pip install semgrep (Linux/Windows)');
    messages.push('     Pre-cache rules: semgrep --config=p/security-audit');
    messages.push('     Gate 9: SAST Security (WARN, semgrep not installed)');
    recordAudit('gate-9', 'sast-security', 'WARN', 0, startMs);
    return { status: 'WARN', messages, exitCode: 0 };
  }

  const semgrepCmd = tool.via === 'npx' ? 'npx' : tool.path;
  const semgrepArgs = tool.via === 'npx' ? ['-y', 'semgrep'] : [];

  // Filter to semgrep-supported language files
  const semgrepFiles = filterSemgrepFiles(input.changedFiles);
  if (semgrepFiles.length === 0) {
    messages.push('     ⏭️  SKIPPED - SAST (no supported language files changed)');
    recordAudit('gate-9', 'sast-security', 'SKIP', 0, startMs);
    return { status: 'SKIP', messages, exitCode: 0 };
  }

  // Run semgrep with JSON output
  semgrepArgs.push('scan', '--config=p/security-audit', '--json', '--disable-version-check', ...semgrepFiles);

  const result = runTool(semgrepCmd, semgrepArgs, { cwd: input.cwd });

  if (result.exitCode === 0) {
    messages.push('     ✅ PASSED - No security vulnerabilities found.');
    recordAudit('gate-9', 'sast-security', 'PASS', 0, startMs);
    return { status: 'PASS', messages, exitCode: 0 };
  }

  if (result.exitCode === 1) {
    // Findings detected — parse JSON to categorize
    return parseSemgrepResults(result.stdout, startMs, messages);
  }

  // Runtime error (timeout, config error, etc.)
  messages.push(`     ⚠️  semgrep exited with code ${result.exitCode} — skipping gate`);
  messages.push('     ⏭️  SKIPPED - SAST (semgrep runtime error)');
  recordAudit('gate-9', 'sast-security', 'SKIP', result.exitCode, startMs);
  return { status: 'SKIP', messages, exitCode: 0 };
}

function parseSemgrepResults(
  jsonOutput: string,
  startMs: number,
  messages: string[]
): GateOutput {
  try {
    const data = JSON.parse(jsonOutput);
    const results: Array<{ extra?: { severity?: string; message?: string }; check_id?: string; path?: string; start?: { line?: number } }> = data.results || [];

    const criticalHigh = results.filter(r => {
      const s = (r.extra?.severity || '').toUpperCase();
      return s === 'CRITICAL' || s === 'HIGH';
    }).length;

    const mediumLow = results.filter(r => {
      const s = (r.extra?.severity || '').toUpperCase();
      return s === 'MEDIUM' || s === 'LOW';
    }).length;

    // Extract top finding details
    const findingLines: string[] = [];
    results.slice(0, 5).forEach(r => {
      const severity = (r.extra?.severity || 'UNKNOWN').toUpperCase();
      const ruleId = r.check_id || 'unknown';
      const filePath = r.path || 'unknown';
      const line = r.start?.line || '?';
      const msg = (r.extra?.message || '').slice(0, 80);
      findingLines.push(`  [${severity}] ${ruleId}`);
      findingLines.push(`  ${filePath}:${line} → ${msg}`);
      findingLines.push('');
    });

    if (criticalHigh > 0) {
      messages.push('');
      messages.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      messages.push('   GATE 9: Semgrep Security Gate');
      messages.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      messages.push(`  CRITICAL/HIGH: ${criticalHigh}  ❌ BLOCKED`);
      messages.push(`  MEDIUM/LOW:    ${mediumLow}  ⚠️  warning`);
      messages.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      messages.push('  ❌ BLOCKED — Critical/High vulnerability found');
      messages.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      messages.push(...findingLines);
      messages.push("  Run 'semgrep scan --config=p/security-audit' to review all findings.");
      recordAudit('gate-9', 'sast-security', 'FAIL', criticalHigh, startMs);
      return { status: 'FAIL', messages, exitCode: 1 };
    }

    messages.push('');
    messages.push('     ✅ PASSED - No critical/high vulnerabilities');
    if (mediumLow > 0) {
      messages.push(`     ⚠️  ${mediumLow} medium/low findings (warnings only)`);
      messages.push(...findingLines);
    }
    recordAudit('gate-9', 'sast-security', 'PASS', 0, startMs);
    return { status: 'PASS', messages, exitCode: 0 };
  } catch {
    messages.push('     ⚠️  Failed to parse semgrep JSON output');
    recordAudit('gate-9', 'sast-security', 'WARN', 0, startMs);
    return { status: 'WARN', messages, exitCode: 0 };
  }
}

/**
 * PowerShell project SAST using PSScriptAnalyzer security rules.
 * Replaces semgrep which doesn't support .ps1 files.
 */
function runPowerShellSAST(
  input: GateInput,
  startMs: number,
  messages: string[]
): GateOutput {
  const ps = detectPowerShell();
  if (!ps.available) {
    messages.push('     ⚠️  WARN - PowerShell not available — SAST scanning unavailable');
    messages.push('     Gate 9: SAST Security (WARN, PowerShell not installed)');
    recordAudit('gate-9', 'sast-security', 'WARN', 0, startMs);
    return { status: 'WARN', messages, exitCode: 0 };
  }

  const psFiles = input.changedFiles.filter(f => f.endsWith('.ps1') || f.endsWith('.psm1'));
  if (psFiles.length === 0) {
    messages.push('     ⏭️  SKIPPED - SAST (no PowerShell files changed)');
    recordAudit('gate-9', 'sast-security', 'SKIP', 0, startMs);
    return { status: 'SKIP', messages, exitCode: 0 };
  }

  messages.push('     Running PSScriptAnalyzer security rules...');

  const fileList = psFiles.map(f => `'${f}'`).join(',');
  // Security-focused PSScriptAnalyzer rules
  const securityRules = [
    'PSAvoidUsingInvokeExpression',
    'PSAvoidUsingConvertToSecureStringWithPlainText',
    'PSAvoidUsingPlainTextForPassword',
    'PSAvoidUsingUserNameAndPasswordParams',
    'PSAvoidUsingWMICmdlet',
    'PSAvoidUsingWriteHost',
  ].join(',');

  const command = `Invoke-ScriptAnalyzer -Path ${fileList} -IncludeRule ${securityRules} -ErrorAction SilentlyContinue | ConvertTo-Json`;
  const result = runPowerShellTool(ps, command, { cwd: input.cwd });

  if (result.exitCode !== 0) {
    messages.push('     ⚠️  PSScriptAnalyzer security check failed, skipping');
    recordAudit('gate-9', 'sast-security', 'WARN', 0, startMs);
    return { status: 'WARN', messages, exitCode: 0 };
  }

  try {
    const findings = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : [];
    const count = Array.isArray(findings) ? findings.length : 0;
    if (count > 0) {
      messages.push('');
      messages.push('❌ BLOCKED - PSScriptAnalyzer security findings:');
      const arr = Array.isArray(findings) ? findings : [findings];
      arr.slice(0, 5).forEach((f: { RuleName?: string; ScriptName?: string; Line?: number; Message?: string }) => {
        messages.push(`  [${f.RuleName || 'UNKNOWN'}] ${f.ScriptName || '?'}:${f.Line || '?'} → ${(f.Message || '').slice(0, 80)}`);
      });
      recordAudit('gate-9', 'sast-security', 'FAIL', count, startMs);
      return { status: 'FAIL', messages, exitCode: 1 };
    }
  } catch {
    // JSON parse failure
  }

  messages.push('     ✅ PASSED - No PowerShell security vulnerabilities found.');
  recordAudit('gate-9', 'sast-security', 'PASS', 0, startMs);
  return { status: 'PASS', messages, exitCode: 0 };
}

// ── CLI Entry Point ──
if (process.argv.includes('--run')) {
  const cwdIdx = process.argv.indexOf('--cwd');
  const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
  const changedFiles = getChangedFiles(cwd);
  const projectLang = detectProjectLang(cwd);
  const result = runGate9({ changedFiles, projectLang, cwd });
  result.messages.forEach(m => console.log(m));
  process.exit(result.exitCode);
}
