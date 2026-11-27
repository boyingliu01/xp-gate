/**
 * Gate 10: Semgrep SAST Security Scan (file name predates the #677 renumber)
 * Detects security vulnerabilities in staged files.
 * For PowerShell projects: uses PSScriptAnalyzer security rules as alternative.
 * TypeScript rewrite of githooks/adapters/gate-9.sh for cross-platform Node.js CLI.
 *
 * Ordering (#782, P0-A): the change set is filtered to semgrep-supported files
 * BEFORE the tool is probed. The reverse order made a change set with nothing to
 * scan pay for `isToolAvailable('semgrep')` first — and with the old npx fallback
 * that probe could reach the registry and download semgrep — purely to then decide
 * there was no input. Measured 2026-11-09, no-input fixture: 789 ms -> 624 ms
 * (-21.0%, 12-round load-valid ABBA).
 */
import {
  GateInput, GateOutput, isToolAvailable, runTool, recordAudit,
  filterSemgrepFiles, detectPowerShell, isPowerShellProject, runPowerShellTool,
  getChangedFiles, detectProjectLang,
} from './common';

// The semgrep ruleset, in ONE place (#640). It appears in the scan invocation and in
// two messages that tell the user which command to re-run by hand; three copies of a
// string that decides what gets scanned is a drift waiting to happen.
export const SEMGREP_RULESET = 'p/security-audit';

/**
 * Fixed flags every Gate 9 semgrep run carries (#640).
 *
 * `--metrics=off` is the important one. Semgrep's usage upload is pure overhead for
 * a gate: it reports statistics to the registry and contributes nothing to the
 * verdict. Measured on one file on this machine, twice each way: 11.7s / 17.2s with
 * metrics, 4.7s / 4.9s without -- a 58-72% cut on a gate whose actual scan work is
 * a fraction of a second (#640 measured 0.45s of work inside 30.8s of wall time).
 * The privacy answer is the same shape: a quality gate should not phone home about
 * the files it just read.
 *
 * `--disable-version-check` removes the second network round trip. Neither flag
 * touches the JSON on stdout, which is what carries the verdict (#518).
 */
export const SEMGREP_EXTRA_ARGS = ['--disable-version-check', '--metrics=off'] as const;

/**
 * The SKIP for a change set with nothing semgrep can read.
 *
 * The tool is never probed on this path: the input question is FREE and the tool
 * question is not, so asking the cheap one first is what keeps a docs-only commit from
 * paying for a `semgrep --version` (#782, P0-A).
 */
function skipNoSupportedFiles(startMs: number, messages: string[]): GateOutput {
  messages.push('     ⏭️  SKIPPED - SAST (no supported language files changed)');
  recordAudit('gate-9', 'sast-security', 'SKIP', 0, startMs);
  return { status: 'SKIP', messages, exitCode: 0 };
}

/**
 * How to run semgrep for this project.
 *
 * `npx` is a command line, not a path: the tool reports it as `npx semgrep`, which
 * cannot be executed as a file. Fixed overhead per run is what #640 is about -- see
 * SEMGREP_EXTRA_ARGS.
 */
function semgrepInvocation(
  tool: { via?: string; path: string },
  files: string[],
): { command: string; args: string[] } {
  const viaNpx = tool.via === 'npx';
  return {
    command: viaNpx ? 'npx' : tool.path,
    args: [
      ...(viaNpx ? ['-y', 'semgrep'] : []),
      'scan', `--config=${SEMGREP_RULESET}`, '--json', ...SEMGREP_EXTRA_ARGS, ...files,
    ],
  };
}

/**
 * WARN when semgrep is not installed: the gate degrades rather than failing, and the
 * message says how to install it AND how to pre-cache the rules, because a first run
 * without the cache pays that cost inside the push.
 */
function warnSemgrepMissing(startMs: number, messages: string[]): GateOutput {
  messages.push('     ⚠️  WARN - semgrep not installed — SAST scanning unavailable');
  messages.push('     Install: brew install semgrep (macOS) | pip install semgrep (Linux/Windows)');
  messages.push('     Pre-cache rules: semgrep --config=' + SEMGREP_RULESET);
  messages.push('     Gate 10: SAST Security (WARN, semgrep not installed)');
  recordAudit('gate-9', 'sast-security', 'WARN', 0, startMs);
  return { status: 'WARN', messages, exitCode: 0 };
}

export function runGate9(input: GateInput): GateOutput {
  const startMs = Date.now();
  const messages: string[] = [];

  messages.push('');
  messages.push('→ Gate 10: Semgrep SAST Security Scan...');

  // PowerShell project: use PSScriptAnalyzer security rules
  if (isPowerShellProject(input.projectLang)) {
    return runPowerShellSAST(input, startMs, messages);
  }

  // Filter to semgrep-supported language files FIRST (#782, P0-A). The input
  // question is free; the tool question is not, so it must be asked second.
  // See the module header for the measurement behind this ordering.
  const semgrepFiles = filterSemgrepFiles(input.changedFiles);
  if (semgrepFiles.length === 0) return skipNoSupportedFiles(startMs, messages);

  // Standard path: semgrep
  const tool = isToolAvailable('semgrep', input.cwd);
  if (!tool.available) return warnSemgrepMissing(startMs, messages);

  const invocation = semgrepInvocation(tool, semgrepFiles);
  const result = runTool(invocation.command, invocation.args, { cwd: input.cwd });

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

/** One PSScriptAnalyzer finding, as the analyzer emits it. */
interface PowerShellFinding {
  RuleName?: string;
  ScriptName?: string;
  Line?: number;
  Message?: string;
}

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

/**
 * The three display lines for one finding.
 *
 * Each field has a NAMED fallback (`unknown`, `?`) rather than an empty string: a
 * finding whose path did not survive parsing still has to be locatable by rule id, and
 * a blank where the path should be reads as "no finding here".
 *
 * The message is truncated because a semgrep message can be a paragraph, and one
 * finding must not push the others off the screen.
 */
/** A field with a named placeholder rather than an empty string. */
function fieldOr(value: unknown, fallback: string): string {
  return value ? String(value) : fallback;
}

function findingLines(r: SemgrepFinding): string[] {
  const severity = fieldOr(r.extra?.severity, 'UNKNOWN').toUpperCase();
  const ruleId = fieldOr(r.check_id, 'unknown');
  const location = `${fieldOr(r.path, 'unknown')}:${fieldOr(r.start?.line, '?')}`;
  const msg = fieldOr(r.extra?.message, '').slice(0, MAX_FINDING_MESSAGE_LENGTH);
  return [`  [${severity}] ${ruleId}`, `  ${location} → ${msg}`, ''];
}

/** The detail block for up to `MAX_DETAIL_FINDINGS` findings. */
function findingDetailLines(results: SemgrepFinding[]): string[] {
  return results.slice(0, MAX_DETAIL_FINDINGS).flatMap(findingLines);
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
  messages.push(`  Run 'semgrep scan --config=${SEMGREP_RULESET}' to review all findings.`);
  recordAudit('gate-9', 'sast-security', 'FAIL', blocking, startMs);
  return { status: 'FAIL', messages, exitCode: 1 };
}

/**
 * Report a verdict the tool could not reach, and the SKIP it produces.
 *
 * Fail closed (#518): unparseable output and a scan that errored on everything are
 * both "cannot judge", which must never be spelled PASS. The audit line records the
 * tool's exit code because that is the evidence the skip rests on.
 */
function skipSemgrep(
  reason: string,
  detail: string,
  stderr: string,
  exitCode: number,
  startMs: number,
  messages: string[],
): GateOutput {
  messages.push(`     ⚠️  ${detail}`);
  pushStderrDiagnostics(messages, stderr);
  messages.push(`     ⏭️  SKIPPED - SAST (${reason})`);
  recordAudit('gate-9', 'sast-security', 'SKIP', exitCode, startMs);
  return { status: 'SKIP', messages, exitCode: 0 };
}

/**
 * Parse semgrep's JSON and decide the verdict.
 *
 * Three outcomes and they are ordered deliberately: the two SKIPs are decided BEFORE
 * any counting, because a scan that errored on everything has no findings to count
 * and would otherwise read as a clean run (#475, #518 R2).
 */
/** A semgrep JSON document, with the two arrays this gate reads. */
interface SemgrepDocument {
  results?: SemgrepFinding[];
  errors?: Array<{ message?: string }>;
}

/**
 * Parse semgrep's JSON, or null when it is not parseable.
 *
 * Null rather than a thrown error because the caller's response is a SKIP, not a
 * crash: unparseable output cannot be judged (#518), and "cannot judge" is a verdict.
 */
function parseSemgrepJson(jsonOutput: string): SemgrepDocument | null {
  try {
    return JSON.parse(jsonOutput) as SemgrepDocument;
  } catch {
    return null;
  }
}

/**
 * Whether this output carries a verdict at all.
 *
 * No findings is only trustworthy when the scan itself succeeded: `exit 0 + results:
 * [] + errors: [{...}]` means semgrep scanned nothing, and that combination used to
 * fall through to PASS (#475, #518 R2).
 */
function hasVerdict(results: SemgrepFinding[], scanErrors: unknown[], exitCode: number): boolean {
  // SCAN ERRORS INVALIDATE THE VERDICT EVEN WITH FINDINGS PRESENT. A partial run reports
  // the files it managed to scan, so `results.length > 0` only proves that SOME of the
  // repository was examined -- and the files it failed on are exactly the ones nobody has
  // looked at. Passing on that is a fail-open that hides unscanned code behind a real
  // finding (measured by review FC-02).
  if (scanErrors.length > 0) return false;
  if (results.length > 0) return true;
  return exitCode === 0;
}

/** The context a SKIP needs: the tool's exit code, its stderr, and where to record it. */
interface SkipContext {
  exitCode: number;
  stderr: string;
  startMs: number;
  messages: string[];
}

/**
 * The SKIP for output that cannot be judged, or null when it can.
 *
 * Both checks run BEFORE any counting: a scan that errored on everything has no findings
 * to count, and would otherwise read as a clean run (#475, #518 R2). Fail-closed means
 * "cannot judge" is never spelled PASS.
 */
function unjudgeable(
  data: SemgrepDocument | null,
  ctx: SkipContext,
): GateOutput | null {
  if (!data) {
    return skipSemgrep('semgrep output unparseable',
      'semgrep output unparseable or verdict fields missing — cannot determine verdict',
      ctx.stderr, ctx.exitCode, ctx.startMs, ctx.messages);
  }
  const results = data.results || [];
  const scanErrors = data.errors || [];
  if (hasVerdict(results, scanErrors, ctx.exitCode)) return null;
  return skipSemgrep('semgrep runtime error',
    `semgrep exit=${ctx.exitCode}, scan errors=${scanErrors.length}, findings=${results.length} — nothing to judge`,
    ctx.stderr, ctx.exitCode, ctx.startMs, ctx.messages);
}

function parseSemgrepResults(
  jsonOutput: string,
  exitCode: number,
  stderr: string,
  startMs: number,
  messages: string[]
): GateOutput {
  const parsed = parseSemgrepJson(jsonOutput);
  const preSkip = unjudgeable(parsed, { exitCode, stderr, startMs, messages });
  if (preSkip) return preSkip;
  // `unjudgeable` returning null IS the proof that `parsed` was a document; the cast
  // states what the guard established.
  const data = parsed as SemgrepDocument;

  const results: SemgrepFinding[] = data.results || [];

  const { blocking, warnings } = countBySeverity(results);
  const findingLines = findingDetailLines(results);

  if (blocking > 0) {
    return renderSemgrepBlock(blocking, warnings, findingLines, startMs, messages);
  }

  return renderSemgrepPass(warnings, findingLines, startMs, messages);
}

/**
 * The PASS verdict, with non-blocking findings shown rather than dropped.
 *
 * A finding that does not block is still a fact the reader paid for: listing it is
 * what separates "clean" from "clean enough for this gate".
 */
function renderSemgrepPass(
  warnings: number,
  findingLines: string[],
  startMs: number,
  messages: string[],
): GateOutput {
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

/**
 * The analyzer invocation, with every path single-quoted for PowerShell.
 *
 * A path is DATA and must stay data: a filename containing `'` closed the quote and let
 * the rest of the name run as command text (review feasibility FC-01). PowerShell escapes
 * a literal quote inside a single-quoted string by DOUBLING it -- the same rule as SQL --
 * so `a'b.ps1` becomes `'a''b.ps1'`.
 */
function buildPSScriptAnalyzerCommand(psFiles: string[]): string {
  const fileList = psFiles.map(f => `'${f.replace(/'/g, "''")}'`).join(',');
  return `Invoke-ScriptAnalyzer -Path ${fileList} -IncludeRule ${PSSCRIPTANALYZER_SECURITY_RULES} -ErrorAction SilentlyContinue | ConvertTo-Json`;
}

function renderPowerShellFindings(
  findings: PowerShellFinding[],
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
/** The PowerShell sources in a change set. */
function powerShellFiles(files: string[]): string[] {
  return files.filter((f) => f.endsWith('.ps1') || f.endsWith('.psm1'));
}

/** WARN when the machine has no PowerShell: the gate degrades, it does not fail. */
function warnNoPowerShell(startMs: number, messages: string[]): GateOutput {
  messages.push('     ⚠️  WARN - PowerShell not available — SAST scanning unavailable');
  messages.push('     Gate 10: SAST Security (WARN, PowerShell not installed)');
  recordAudit('gate-9', 'sast-security', 'WARN', 0, startMs);
  return { status: 'WARN', messages, exitCode: 0 };
}

/** SKIP when a PowerShell project changed no PowerShell source. */
function skipNoPowerShellFiles(startMs: number, messages: string[]): GateOutput {
  messages.push('     ⏭️  SKIPPED - SAST (no PowerShell files changed)');
  recordAudit('gate-9', 'sast-security', 'SKIP', 0, startMs);
  return { status: 'SKIP', messages, exitCode: 0 };
}

function runPowerShellSAST(
  input: GateInput,
  startMs: number,
  messages: string[]
): GateOutput {
  const ps = detectPowerShell();
  if (!ps.available) return warnNoPowerShell(startMs, messages);

  const psFiles = powerShellFiles(input.changedFiles);
  if (psFiles.length === 0) return skipNoPowerShellFiles(startMs, messages);

  messages.push('     Running PSScriptAnalyzer security rules...');
  const result = runPowerShellTool(ps, buildPSScriptAnalyzerCommand(psFiles), { cwd: input.cwd });
  if (result.exitCode !== 0) return warnAnalyzerFailed(startMs, messages);
  return reportPowerShellFindings(parseAnalyzerOutput(result.stdout), startMs, messages);
}

/** WARN when the analyzer itself failed: a broken tool must not read as a clean repo. */
function warnAnalyzerFailed(startMs: number, messages: string[]): GateOutput {
  messages.push('     ⚠️  PSScriptAnalyzer security check failed, skipping');
  recordAudit('gate-9', 'sast-security', 'WARN', 0, startMs);
  return { status: 'WARN', messages, exitCode: 0 };
}

/**
 * The analyzer's findings, always as an array.
 *
 * PSScriptAnalyzer emits a bare OBJECT for a single finding and an array for several, so
 * a single result would otherwise be iterated as its own keys.
 */
export function parseAnalyzerOutput(stdout: string): PowerShellFinding[] | null {
  const text = stdout.trim();
  // NO output and UNREADABLE output are the same thing to a parser and opposite things
  // to a gate: one can happen on a clean run, the other means the tool did not answer.
  // Returning `[]` for both reported PASS on a corrupt payload (measured by two
  // reviewers). `null` means "could not be read" and the caller WARNs.
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as PowerShellFinding | PowerShellFinding[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

/** The verdict once the analyzer has produced output. */
function reportPowerShellFindings(
  findings: PowerShellFinding[] | null,
  startMs: number,
  messages: string[],
): GateOutput {
  if (findings === null) {
    messages.push('     ⚠️  PSScriptAnalyzer produced unreadable output, skipping');
    recordAudit('gate-9', 'sast-security', 'WARN', 0, startMs);
    return { status: 'WARN', messages, exitCode: 0 };
  }
  if (findings.length > 0) return renderPowerShellFindings(findings, startMs, messages);
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
