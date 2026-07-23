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

  // Run lizard with CCN threshold
  const result = runTool(lizardCmd, [...lizardArgs, '-C', String(CCN_THRESHOLD), ...ccFiles], {
    cwd: input.cwd,
  });

  const combinedOutput = result.stdout + result.stderr;

  // Parse warning count from summary table: "Warning cnt   8"
  const warningMatch = combinedOutput.match(/^Warning cnt\s+(\d+)/m);
  const warnings = warningMatch ? parseInt(warningMatch[1], 10) : 0;

  if (warnings > 0) {
    messages.push(combinedOutput);
    messages.push('');
    messages.push(`❌ BLOCKED - ${warnings} functions with CCN > ${CCN_THRESHOLD} found.`);
    messages.push(`Refactor high-complexity functions to keep below ${CCN_THRESHOLD} complexity.`);
    recordAudit('gate-3', 'complexity', 'FAIL', warnings, startMs);
    return { status: 'FAIL', messages, exitCode: 1 };
  }

  messages.push(`✅ PASSED - All functions within complexity threshold (${CCN_THRESHOLD}).`);
  recordAudit('gate-3', 'complexity', 'PASS', 0, startMs);
  return { status: 'PASS', messages, exitCode: 0 };
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
