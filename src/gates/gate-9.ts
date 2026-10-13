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

  // #518 (same defect class as the bash gate-10.sh fix): the exit code does NOT
  // carry the verdict. semgrep exits 0 even with ERROR-severity findings, and
  // its exit-code semantics drift across versions/platforms. The verdict comes
  // from the JSON; the exit code only tells whether the tool itself ran.
  return parseSemgrepResults(result.stdout, result.exitCode, result.stderr, startMs, messages);
}

// #518: warnings-only vocabulary. Everything OUTSIDE this list — including
// semgrep's ERROR tier, the legacy CRITICAL/HIGH tiers, and any unknown or
// missing severity — counts as BLOCKING: a security gate must fail closed on
// tiers it does not recognize.
const NONBLOCKING_SEVERITIES = ['WARNING', 'INFO', 'MEDIUM', 'LOW'];
const MAX_DETAIL_FINDINGS = 5;
const MAX_FINDING_MESSAGE_LENGTH = 80;

interface SemgrepFinding {
  check_id?: string;
  path?: string;
  start?: { line?: number };
  extra?: { severity?: string; message?: string };
}

function pushStderrDiagnostics(messages: string[], stderr: string): void {
  if (!stderr) {
    return;
  }
  messages.push('     ── what semgrep reported ──');
  messages.push(...stderr.split('\n').slice(-10).map(l => `     ${l}`));
}

function countBySeverity(results: SemgrepFinding[]): { blocking: number; warnings: number } {
  let blocking = 0;
  let warnings = 0;
  results.forEach(r => {
    const s = (r.extra?.severity || '').toUpperCase();
    if (NONBLOCKING_SEVERITIES.includes(s)) {
      warnings++;
    } else {
      blocking++;
    }
  });
  return { blocking, warnings };
}

function findingDetailLines(results: SemgrepFinding[]): string[] {
  const lines: string[] = [];
  results.slice(0, MAX_DETAIL_FINDINGS).forEach(r => {
    const severity = (r.extra?.severity || 'UNKNOWN').toUpperCase();
    const ruleId = r.check_id || 'unknown';
    const filePath = r.path || 'unknown';
    const line = r.start?.line || '?';
    const msg = (r.extra?.message || '').slice(0, MAX_FINDING_MESSAGE_LENGTH);
    lines.push(`  [${severity}] ${ruleId}`);
    lines.push(`  ${filePath}:${line} → ${msg}`);
    lines.push('');
  });
  return lines;
}

function renderSemgrepBlock(
  blocking: number,
  warnings: number,
  findingLines: string[],
  startMs: number,
  messages: string[]
): GateOutput {
  messages.push('');
  messages.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  messages.push('   GATE 9: Semgrep Security Gate');
  messages.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  messages.push(`  CRITICAL/HIGH/ERROR:     ${blocking}  ❌ BLOCKED`);
  messages.push(`  MEDIUM/LOW/WARNING/INFO: ${warnings}  ⚠️  warning`);
  messages.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  messages.push('  ❌ BLOCKED — blocking-severity vulnerability found');
  messages.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  messages.push(...findingLines);
  messages.push("  Run 'semgrep scan --config=p/security-audit' to review all findings.");
  recordAudit('gate-9', 'sast-security', 'FAIL', blocking, startMs);
  return { status: 'FAIL', messages, exitCode: 1 };
}

function parseSemgrepResults(
  jsonOutput: string,
  exitCode: number,
  stderr: string,
  startMs: number,
  messages: string[]
): GateOutput {
  let data: { results?: SemgrepFinding[]; errors?: Array<{ message?: string }> };
  try {
    data = JSON.parse(jsonOutput);
  } catch {
    // Fail closed (#518): unparseable output cannot be judged — SKIP, never PASS.
    messages.push('     ⚠️  semgrep output unparseable or verdict fields missing — cannot determine verdict');
    pushStderrDiagnostics(messages, stderr);
    messages.push('     ⏭️  SKIPPED - SAST (semgrep output unparseable)');
    recordAudit('gate-9', 'sast-security', 'SKIP', exitCode, startMs);
    return { status: 'SKIP', messages, exitCode: 0 };
  }

  const results: SemgrepFinding[] = data.results || [];
  const scanErrors = data.errors || [];

  // Nothing scanned to a verdict: tool failure (nonzero exit) or scan errors on
  // every input. Must neither block nor claim a pass (#475 contract, #518 R2:
  // exit 0 + results:[] + errors:[{...}] used to fall through to PASS).
  if (results.length === 0 && (scanErrors.length > 0 || exitCode !== 0)) {
    messages.push(`     ⚠️  semgrep exit=${exitCode}, scan errors=${scanErrors.length}, findings=${results.length} — nothing to judge`);
    pushStderrDiagnostics(messages, stderr);
    messages.push('     ⏭️  SKIPPED - SAST (semgrep runtime error)');
    recordAudit('gate-9', 'sast-security', 'SKIP', exitCode, startMs);
    return { status: 'SKIP', messages, exitCode: 0 };
  }

  const { blocking, warnings } = countBySeverity(results);
  const findingLines = findingDetailLines(results);

  if (blocking > 0) {
    return renderSemgrepBlock(blocking, warnings, findingLines, startMs, messages);
  }

  messages.push('');
  messages.push('     ✅ PASSED - No blocking vulnerabilities');
  if (warnings > 0) {
    messages.push(`     ⚠️  ${warnings} non-blocking findings (warnings only)`);
    messages.push(...findingLines);
  }
  recordAudit('gate-9', 'sast-security', 'PASS', 0, startMs);
  return { status: 'PASS', messages, exitCode: 0 };
}

const PSSCRIPTANALYZER_SECURITY_RULES = [
  'PSAvoidUsingInvokeExpression',
  'PSAvoidUsingConvertToSecureStringWithPlainText',
  'PSAvoidUsingPlainTextForPassword',
  'PSAvoidUsingUserNameAndPasswordParams',
  'PSAvoidUsingWMICmdlet',
  'PSAvoidUsingWriteHost',
].join(',');

function buildPSScriptAnalyzerCommand(psFiles: string[]): string {
  const fileList = psFiles.map(f => `'${f}'`).join(',');
  return `Invoke-ScriptAnalyzer -Path ${fileList} -IncludeRule ${PSSCRIPTANALYZER_SECURITY_RULES} -ErrorAction SilentlyContinue | ConvertTo-Json`;
}

function renderPowerShellFindings(
  findings: Array<{ RuleName?: string; ScriptName?: string; Line?: number; Message?: string }>,
  startMs: number,
  messages: string[]
): GateOutput {
  messages.push('');
  messages.push('❌ BLOCKED - PSScriptAnalyzer security findings:');
  findings.slice(0, MAX_DETAIL_FINDINGS).forEach(f => {
    messages.push(`  [${f.RuleName || 'UNKNOWN'}] ${f.ScriptName || '?'}:${f.Line || '?'} → ${(f.Message || '').slice(0, MAX_FINDING_MESSAGE_LENGTH)}`);
  });
  recordAudit('gate-9', 'sast-security', 'FAIL', findings.length, startMs);
  return { status: 'FAIL', messages, exitCode: 1 };
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

  const result = runPowerShellTool(ps, buildPSScriptAnalyzerCommand(psFiles), { cwd: input.cwd });

  if (result.exitCode !== 0) {
    messages.push('     ⚠️  PSScriptAnalyzer security check failed, skipping');
    recordAudit('gate-9', 'sast-security', 'WARN', 0, startMs);
    return { status: 'WARN', messages, exitCode: 0 };
  }

  try {
    const findings = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : [];
    const arr = Array.isArray(findings) ? findings : [findings];
    if (arr.length > 0) {
      return renderPowerShellFindings(arr, startMs, messages);
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
