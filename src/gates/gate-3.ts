/**
 * Gate 3: Cyclomatic Complexity Check
 * Uses lizard for source files; PSScriptAnalyzer for PowerShell projects.
 * TypeScript rewrite of githooks/adapters/gate-3.sh for cross-platform Node.js CLI.
 */
import {
  GateInput, GateOutput, isToolAvailable, runTool, recordAudit,
  filterSourceFiles, detectPowerShell, isPowerShellProject, runPowerShellTool,
  getChangedFiles, detectProjectLang,
} from './common';

const CCN_THRESHOLD = 5;

/** SKIP for a documentation-only project: there is no code to measure. */
function skipDocumentationProject(startMs: number, messages: string[]): GateOutput {
  messages.push('⏭️  SKIPPED - Complexity (documentation project).');
  recordAudit('gate-3', 'complexity', 'SKIP', 0, startMs);
  return { status: 'SKIP', messages, exitCode: 0 };
}

/** WARN when lizard is absent: the gate degrades rather than failing, and says how to fix it. */
function warnLizardMissing(startMs: number, messages: string[]): GateOutput {
  messages.push('⚠️  WARN - lizard not installed, complexity check not performed');
  messages.push('   Install with: pip install --user lizard');
  messages.push('   Gate 3: Complexity check (WARN, tool not available)');
  recordAudit('gate-3', 'complexity', 'WARN', 0, startMs);
  return { status: 'WARN', messages, exitCode: 0 };
}

/**
 * The verdict a project TYPE settles before any tool is probed.
 *
 * Documentation-only projects have no code to measure, and a PowerShell project uses
 * PSScriptAnalyzer instead of lizard. Both are decided from the language alone, which is
 * why they run before the (expensive) tool probe.
 */
function earlyVerdict(input: GateInput, startMs: number, messages: string[]): GateOutput | null {
  if (input.projectLang === 'documentation-only') return skipDocumentationProject(startMs, messages);
  if (isPowerShellProject(input.projectLang)) return runPowerShellComplexity(input, startMs, messages);
  return null;
}

export function runGate3(input: GateInput): GateOutput {
  const startMs = Date.now();
  const messages: string[] = [];

  messages.push('');
  messages.push('→ Gate 3: Cyclomatic complexity...');

  const early = earlyVerdict(input, startMs, messages);
  if (early) return early;

  // PowerShell project: use PSScriptAnalyzer as alternative
  if (isPowerShellProject(input.projectLang)) {
    return runPowerShellComplexity(input, startMs, messages);
  }

  // Standard path: lizard
  return runLizardPath(input, startMs, messages);
}

/**
 * The default path: measure every source file with lizard.
 *
 * The `ccFiles` check precedes the tool probe deliberately -- "is there anything to
 * check?" is free and "is the tool installed?" is not (#782 ordering).
 */
function runLizardPath(input: GateInput, startMs: number, messages: string[]): GateOutput {
  const tool = isToolAvailable('lizard', input.cwd);
  if (!tool.available) return warnLizardMissing(startMs, messages);

  const ccFiles = filterSourceFiles(input.changedFiles);
  if (ccFiles.length === 0) return skipNoSourceFiles(startMs, messages);

  messages.push('Checking complexity for source files...');
  const verdict = lizardVerdict(tool, ccFiles, input.cwd ?? process.cwd());
  messages.push(...verdict.messages);
  recordAudit('gate-3', 'complexity', verdict.status, verdict.warnings, startMs);
  return { status: verdict.status, messages, exitCode: verdict.exitCode };
}

/** SKIP when a change set carries no source lizard can read. */
function skipNoSourceFiles(startMs: number, messages: string[]): GateOutput {
  messages.push('⏭️  SKIPPED - Complexity (no source files to check).');
  recordAudit('gate-3', 'complexity', 'SKIP', 0, startMs);
  return { status: 'SKIP', messages, exitCode: 0 };
}

/**
 * Run lizard and build the verdict.
 *
 * CSV mode, because the verdict comes from the numbers lizard USES rather than from its
 * table formatting (#674) -- the old table parser never matched, so every run reported
 * zero warnings.
 */
function lizardVerdict(
  tool: { via?: string; path?: string },
  files: string[],
  cwd: string,
): { status: 'PASS' | 'FAIL' | 'WARN'; messages: string[]; warnings: number; exitCode: number } {
  const viaNpx = tool.via === 'npx';
  const rawOutput = runLizardCsv(
    viaNpx ? 'npx' : (tool.path as string),
    viaNpx ? ['-y', 'lizard'] : [],
    files,
    cwd,
  );
  return buildComplexityVerdict(countCcnWarnings(rawOutput), rawOutput);
}

/** Run lizard in CSV mode and return its raw output (stdout + stderr). */
function runLizardCsv(cmd: string, baseArgs: string[], files: string[], cwd: string | undefined): string {
  const result = runTool(cmd, [...baseArgs, '--csv', '-C', String(CCN_THRESHOLD), ...files], { cwd });
  return result.stdout + result.stderr;
}

/**
 * Turn a CCN count into the gate's verdict and messages.
 *
 * Split from runGate3 so the three-way outcome (WARN on unparsable output, FAIL
 * on violations, PASS) is visible in one place and testable without driving
 * lizard. Notably `!analysed` must NOT fall through to PASS: a lizard that
 * produced no parsable row would otherwise report success on zero analysed
 * functions -- the same silent-success failure as #674.
 */
export function buildComplexityVerdict(
  counts: { warnings: number; analysed: boolean },
  rawOutput: string
): { status: 'PASS' | 'FAIL' | 'WARN'; messages: string[]; exitCode: number; warnings: number } {
  if (!counts.analysed) {
    return {
      status: 'WARN',
      messages: ['⚠️  WARN - lizard produced no parsable results; complexity not verified'],
      exitCode: 0,
      warnings: 0,
    };
  }
  if (counts.warnings > 0) {
    return {
      status: 'FAIL',
      messages: [
        rawOutput,
        '',
        `❌ BLOCKED - ${counts.warnings} functions with CCN > ${CCN_THRESHOLD} found.`,
        `Refactor high-complexity functions to keep below ${CCN_THRESHOLD} complexity.`,
      ],
      exitCode: 1,
      warnings: counts.warnings,
    };
  }
  return {
    status: 'PASS',
    messages: [`✅ PASSED - All functions within complexity threshold (${CCN_THRESHOLD}).`],
    exitCode: 0,
    warnings: 0,
  };
}

/**
 * Count functions whose CCN exceeds the threshold from lizard's --csv output.
 *
 * Split out so the parse can be tested against literal lizard output instead of
 * by driving the tool: a parser bug here is invisible in exactly the same way
 * (#674) -- it returns "clean" and the gate reports PASS.
 *
 * `analysed` distinguishes "lizard found nothing over the threshold" from
 * "lizard produced nothing at all". Only the first is a pass.
 */
export function countCcnWarnings(csv: string): { warnings: number; analysed: boolean } {
  let warnings = 0;
  let analysed = false;
  for (const line of csv.split('\n')) {
    const columns = line.split(',');
    if (columns.length < 2) continue;
    // Location column carries ":name" style text, so only trust numeric CCN.
    if (!/^\s*\d+\s*$/.test(columns[1])) continue;
    analysed = true;
    if (parseInt(columns[1], 10) > CCN_THRESHOLD) warnings++;
  }
  return { warnings, analysed };
}

// ── CLI Entry Point ──
if (process.argv.includes('--run')) {
  const cwdIdx = process.argv.indexOf('--cwd');
  const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
  const changedFiles = getChangedFiles(cwd);
  const projectLang = detectProjectLang(cwd);
  const result = runGate3({ changedFiles, projectLang, cwd });
  result.messages.forEach(m => console.log(m));
  process.exit(result.exitCode);
}

/**
 * PowerShell project complexity check using PSScriptAnalyzer.
 * Uses PSAvoid* rules as approximate complexity indicators.
 */
/** The PowerShell extensions this gate reads. */
const POWERSHELL_EXTENSIONS = ['.ps1', '.psm1'];

/** The PSScriptAnalyzer rules this gate asks for. */
const COMPLEXITY_RULES = 'PSAvoidUsingInvokeExpression,PSAvoidGlobalAliases';

/** The PowerShell sources in a change set. */
function powerShellFiles(files: string[]): string[] {
  return files.filter((f) => POWERSHELL_EXTENSIONS.some((ext) => f.endsWith(ext)));
}

/**
 * The analyzer invocation, with every path QUOTED.
 *
 * A path containing a space would otherwise end the `-Path` argument early and analyse a
 * file that does not exist -- reporting a clean run for code nobody looked at.
 */
function analyzerCommand(files: string[]): string {
  const fileList = files.map((f) => `'${f}'`).join(',');
  return `Invoke-ScriptAnalyzer -Path ${fileList} -IncludeRule ${COMPLEXITY_RULES} `
    + '-ErrorAction SilentlyContinue | ConvertTo-Json';
}

/** SKIP when the machine has no PowerShell at all. */
function skipNoPowerShellTool(startMs: number, messages: string[]): GateOutput {
  messages.push('ℹ️  No PowerShell Clean Code / SOLID tool available');
  messages.push('⏭️  SKIPPED - Complexity (no PowerShell tool)');
  recordAudit('gate-3', 'complexity', 'SKIP', 0, startMs);
  return { status: 'SKIP', messages, exitCode: 0 };
}

/** SKIP when a change set carries no PowerShell source. */
function skipNoPowerShellFiles(startMs: number, messages: string[]): GateOutput {
  messages.push('⏭️  SKIPPED - Complexity (no PowerShell files to check).');
  recordAudit('gate-3', 'complexity', 'SKIP', 0, startMs);
  return { status: 'SKIP', messages, exitCode: 0 };
}

/**
 * WARN when the analyzer itself failed.
 *
 * WARN rather than SKIP: the tool RAN and said no, which is different from not being
 * able to run -- and a broken analyzer must not read as a clean repository.
 */
function warnAnalyzerFailed(startMs: number, messages: string[]): GateOutput {
  messages.push('⚠️  PSScriptAnalyzer check failed, skipping');
  recordAudit('gate-3', 'complexity', 'WARN', 0, startMs);
  return { status: 'WARN', messages, exitCode: 0 };
}

function runPowerShellComplexity(
  input: GateInput,
  startMs: number,
  messages: string[]
): GateOutput {
  const ps = detectPowerShell();
  if (!ps.available) return skipNoPowerShellTool(startMs, messages);

  const psFiles = powerShellFiles(input.changedFiles);
  if (psFiles.length === 0) return skipNoPowerShellFiles(startMs, messages);

  messages.push('Checking PowerShell code quality via PSScriptAnalyzer...');
  const result = runPowerShellTool(ps, analyzerCommand(psFiles), { cwd: input.cwd });

  if (result.exitCode !== 0) return warnAnalyzerFailed(startMs, messages);

  return reportAnalyzerFindings(analyzerFindingCount(result.stdout), startMs, messages);
}

/**
 * How many findings the analyzer printed, or null when it printed nothing readable.
 *
 * NULL, not zero: `[]` means the analyzer ran and found nothing, while unreadable output
 * means it did not answer -- and rendering both as 0 produced "✅ PASSED - PowerShell code
 * quality check passed" on a corrupt payload. Same distinction, and the same fix, as
 * `gate-9`'s `parseAnalyzerOutput`; two gates reading the same tool must not disagree
 * about what an empty answer means.
 *
 * A non-array body is also null: a single object is not a findings list.
 */
function analyzerFindingCount(stdout: string): number | null {
  const text = stdout.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

/** The verdict once the analyzer has produced output. */
function reportAnalyzerFindings(
  count: number | null,
  startMs: number,
  messages: string[],
): GateOutput {
  if (count === null) {
    messages.push('     ⚠️  PSScriptAnalyzer produced unreadable output, skipping');
    recordAudit('gate-3', 'complexity', 'WARN', 0, startMs);
    return { status: 'WARN', messages, exitCode: 0 };
  }
  if (count > 0) {
    messages.push(`⚠️  ${count} PSScriptAnalyzer findings (warnings only for PowerShell projects)`);
    recordAudit('gate-3', 'complexity', 'WARN', count, startMs);
    return { status: 'WARN', messages, exitCode: 0 };
  }
  messages.push('✅ PASSED - PowerShell code quality check passed.');
  recordAudit('gate-3', 'complexity', 'PASS', 0, startMs);
  return { status: 'PASS', messages, exitCode: 0 };
}
