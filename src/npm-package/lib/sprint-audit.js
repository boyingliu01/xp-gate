/**
 * xp-gate sprint-audit — Layer 2: Final sprint completeness audit.
 *
 * Checks phase_history coverage, time records, artifact records,
 * and state consistency at Phase 6 CLOSE.
 *
 * Usage:
 *   xp-gate sprint-audit [--dir <path>] [--json]
 *
 * Verdict rules:
 *   6/6 completed + 0 errors       → PASS (exit 0)
 *   >= 4/6 completed + 0 errors    → PASS_WITH_WARNINGS (exit 0)
 *   < 4/6 completed or any errors  → FAIL (exit 1)
 *   No sprint-state.json           → SKIP (exit 0)
 *
 * @module sprint-audit
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PHASE_NAMES } = require('./phase-transition');

/**
 * Run the sprint audit.
 * @param {string[]} args - CLI arguments
 * @returns {Promise<number>} Exit code
 */
async function handleSprintAudit(args = []) {
  if (args.includes('--help')) {
    console.log('Usage: xp-gate sprint-audit [options]');
    console.log('');
    console.log('Options:');
    console.log('  --dir <path>   Project directory (default: cwd)');
    console.log('  --json         Output as JSON instead of human-readable');
    console.log('');
    console.log('Runs final sprint completeness audit at Phase 6 CLOSE.');
    console.log('Checks phase coverage, time records, artifact records,');
    console.log('and state consistency.');
    return 0;
  }

  const dirIdx = args.indexOf('--dir');
  const projectDir = dirIdx >= 0 ? args[dirIdx + 1] : process.cwd();
  const jsonFlag = args.includes('--json');

  const stateFile = path.join(projectDir, '.sprint-state', 'sprint-state.json');

  // No sprint-state.json → SKIP
  if (!fs.existsSync(stateFile)) {
    if (jsonFlag) {
      console.log(JSON.stringify({ verdict: 'SKIP', reason: 'No sprint-state.json found' }));
    } else {
      console.log('⏭️  No sprint-state.json found — skipping audit.');
    }
    return 0;
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (err) {
    const result = {
      verdict: 'FAIL',
      errors: [`Failed to parse sprint-state.json: ${err.message}`],
    };
    if (jsonFlag) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(`❌ ${result.errors[0]}`);
    }
    return 1;
  }

  // ── Run checks ──
  const warnings = [];
  const errors = [];
  const phaseHistory = Array.isArray(state.phase_history) ? state.phase_history : [];

  // Build lookup
  const historyLookup = {};
  for (const entry of phaseHistory) {
    historyLookup[entry.phase] = entry;
  }

  // Check 1: Phase coverage
  const completedPhases = [];
  const missingPhases = [];
  const incompletePhases = [];

  for (let i = 1; i <= 6; i++) {
    const entry = historyLookup[i];
    if (!entry) {
      missingPhases.push(i);
    } else if (entry.status === 'completed' || entry.status === 'skipped') {
      completedPhases.push(i);
    } else {
      incompletePhases.push({ phase: i, name: PHASE_NAMES[i] || `Phase ${i}`, status: entry.status });
    }
  }

  // Check 2: Time records for completed phases
  for (const phaseNum of completedPhases) {
    const entry = historyLookup[phaseNum];
    if (entry.status === 'completed' && (entry.duration_seconds == null || entry.duration_seconds === 0)) {
      warnings.push(`Phase ${phaseNum} (${PHASE_NAMES[phaseNum]}) completed but has no duration recorded`);
    }
  }

  // Check 3: Artifact records (phase-{N}-summary.md)
  const outputsDir = path.join(projectDir, '.sprint-state', 'phase-outputs');
  for (const phaseNum of completedPhases) {
    if (historyLookup[phaseNum].status === 'completed') {
      const summaryFile = path.join(outputsDir, `phase-${phaseNum}-summary.md`);
      if (!fs.existsSync(summaryFile)) {
        warnings.push(`Phase ${phaseNum} summary missing: .sprint-state/phase-outputs/phase-${phaseNum}-summary.md`);
      }
    }
  }

  // Check 4: State consistency — phase field vs phase_history last entry
  if (phaseHistory.length > 0) {
    const lastEntry = phaseHistory[phaseHistory.length - 1];
    if (state.phase !== undefined && state.phase !== lastEntry.phase) {
      errors.push(
        `State inconsistency: sprint-state.phase=${state.phase} but phase_history last entry is phase ${lastEntry.phase}`
      );
    }
  }

  // ── Determine verdict ──
  const completedCount = completedPhases.length;
  let verdict;
  if (errors.length > 0 || completedCount < 4) {
    verdict = 'FAIL';
  } else if (completedCount >= 6 && errors.length === 0) {
    verdict = 'PASS';
  } else {
    verdict = 'PASS_WITH_WARNINGS';
  }

  // ── Build result ──
  const result = {
    sprint_id: state.id || 'unknown',
    branch: state.isolation?.branch || 'unknown',
    coverage: {
      completed: completedCount,
      total: 6,
      pct: Math.round((completedCount / 6) * 100),
    },
    missing_phases: missingPhases.map(p => ({ phase: p, name: PHASE_NAMES[p] || `Phase ${p}` })),
    incomplete_phases: incompletePhases,
    warnings,
    errors,
    verdict,
  };

  // ── Persist report (latest overwrites — expected behavior) ──
  const reportPath = path.join(projectDir, '.sprint-state', 'audit-report.json');
  try {
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8');
  } catch (err) {
    // Report write failure is WARNING, not BLOCK
    warnings.push(`Failed to write audit report: ${err.message}`);
  }

  // ── Output ──
  if (jsonFlag) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHumanReadable(result, state);
  }

  // Exit code: FAIL → 1, others → 0
  return verdict === 'FAIL' ? 1 : 0;
}

/**
 * Print human-readable audit report.
 * @param {object} result - Audit result object
 * @param {object} state - Sprint state object
 */
function printHumanReadable(result, state) {
  const lines = [];
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`  Sprint Audit Report — ${result.sprint_id}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push(`  Branch: ${result.branch}`);
  lines.push(`  Phase Coverage: ${result.coverage.completed}/${result.coverage.total} (${result.coverage.pct}%)`);
  lines.push('');
  lines.push('  Phase History:');

  for (let i = 1; i <= 6; i++) {
    const entry = result.incomplete_phases.find(p => p.phase === i);
    const missing = result.missing_phases.find(p => p.phase === i);
    const name = (PHASE_NAMES[i] || `Phase ${i}`).padEnd(10);

    if (missing) {
      lines.push(`  ❌ Phase ${i}/6  ${name} — not recorded`);
    } else if (entry) {
      lines.push(`  ⚠️  Phase ${i}/6  ${name} ${entry.status}  ← not yet completed`);
    } else {
      lines.push(`  ✅ Phase ${i}/6  ${name} completed`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('  Warnings:');
    for (const w of result.warnings) {
      lines.push(`  ⚠️  ${w}`);
    }
  }

  if (result.errors.length > 0) {
    lines.push('');
    lines.push('  Errors:');
    for (const e of result.errors) {
      lines.push(`  ❌ ${e}`);
    }
  }

  lines.push('');
  const issueCount = result.warnings.length + result.errors.length;
  lines.push(`  Overall: ${result.warnings.length} warning(s), ${result.errors.length} error(s)`);
  lines.push(`  Verdict: ${result.verdict}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log(lines.join('\n'));
}

module.exports = { handleSprintAudit };
