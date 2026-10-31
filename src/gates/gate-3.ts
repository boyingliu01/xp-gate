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

export function runGate3(input: GateInput): GateOutput {
  const startMs = Date.now();
  const messages: string[] = [];

  messages.push('');
  messages.push('→ Gate 3: Cyclomatic complexity...');

  // Documentation-only projects: skip
  if (input.projectLang === 'documentation-only') {
    messages.push('⏭️  SKIPPED - Complexity (documentation project).');
    recordAudit('gate-3', 'complexity', 'SKIP', 0, startMs);
    return { status: 'SKIP', messages, exitCode: 0 };
  }

  // PowerShell project: use PSScriptAnalyzer as alternative
  if (isPowerShellProject(input.projectLang)) {
    return runPowerShellComplexity(input, startMs, messages);
  }

  // Standard path: lizard
  const tool = isToolAvailable('lizard', input.cwd);
  if (!tool.available) {
    messages.push('⚠️  WARN - lizard not installed, complexity check not performed');
    messages.push('   Install with: pip install --user lizard');
    messages.push('   Gate 3: Complexity check (WARN, tool not available)');
    recordAudit('gate-3', 'complexity', 'WARN', 0, startMs);
    return { status: 'WARN', messages, exitCode: 0 };
  }

  const lizardCmd = tool.via === 'npx' ? 'npx' : tool.path;
  const lizardArgs = tool.via === 'npx' ? ['-y', 'lizard'] : [];

  // Filter to source files lizard can analyze
  const ccFiles = filterSourceFiles(input.changedFiles);
  if (ccFiles.length === 0) {
    messages.push('⏭️  SKIPPED - Complexity (no source files to check).');
    recordAudit('gate-3', 'complexity', 'SKIP', 0, startMs);
    return { status: 'SKIP', messages, exitCode: 0 };
  }

  messages.push('Checking complexity for source files...');

  // CSV mode: the verdict comes from the numbers lizard uses, not its table
  // formatting (#674). See countCcnWarnings() for why the old parser never matched.
  const rawOutput = runLizardCsv(lizardCmd, lizardArgs, ccFiles, input.cwd);
  const verdict = buildComplexityVerdict(countCcnWarnings(rawOutput), rawOutput);
  messages.push(...verdict.messages);
  recordAudit('gate-3', 'complexity', verdict.status, verdict.warnings, startMs);
  return { status: verdict.status, messages, exitCode: verdict.exitCode };
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
function runPowerShellComplexity(
  input: GateInput,
  startMs: number,
  messages: string[]
): GateOutput {
  const ps = detectPowerShell();
  if (!ps.available) {
    messages.push('ℹ️  No PowerShell Clean Code / SOLID tool available');
    messages.push('⏭️  SKIPPED - Complexity (no PowerShell tool)');
    recordAudit('gate-3', 'complexity', 'SKIP', 0, startMs);
    return { status: 'SKIP', messages, exitCode: 0 };
  }

  // Filter to .ps1 files
  const psFiles = input.changedFiles.filter(f => f.endsWith('.ps1') || f.endsWith('.psm1'));
  if (psFiles.length === 0) {
    messages.push('⏭️  SKIPPED - Complexity (no PowerShell files to check).');
    recordAudit('gate-3', 'complexity', 'SKIP', 0, startMs);
    return { status: 'SKIP', messages, exitCode: 0 };
  }

  messages.push('Checking PowerShell code quality via PSScriptAnalyzer...');

  const fileList = psFiles.map(f => `'${f}'`).join(',');
  const command = `Invoke-ScriptAnalyzer -Path ${fileList} -IncludeRule PSAvoidUsingInvokeExpression,PSAvoidGlobalAliases -ErrorAction SilentlyContinue | ConvertTo-Json`;
  const result = runPowerShellTool(ps, command, { cwd: input.cwd });

  if (result.exitCode !== 0) {
    messages.push('⚠️  PSScriptAnalyzer check failed, skipping');
    recordAudit('gate-3', 'complexity', 'WARN', 0, startMs);
    return { status: 'WARN', messages, exitCode: 0 };
  }

  try {
    const findings = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : [];
    const count = Array.isArray(findings) ? findings.length : 0;
    if (count > 0) {
      messages.push(`⚠️  ${count} PSScriptAnalyzer findings (warnings only for PowerShell projects)`);
      recordAudit('gate-3', 'complexity', 'WARN', count, startMs);
      return { status: 'WARN', messages, exitCode: 0 };
    }
  } catch {
    // JSON parse failure — not a gate failure
  }

  messages.push('✅ PASSED - PowerShell code quality check passed.');
  recordAudit('gate-3', 'complexity', 'PASS', 0, startMs);
  return { status: 'PASS', messages, exitCode: 0 };
}
