'use strict';
/**
 * How the complexity report is presented, and the gate-timing summary that goes
 * into it.
 *
 * Split out of `ccn-report.cjs` when that file crossed its size ceiling. What stays
 * behind is the measurement; what moves here is what the numbers LOOK like.
 */

const path = require('path');
const fs = require('fs');

/**
 * Per-gate timing statistics from the audit log, keyed by gate name.
 *
 * Split out of main() so the three arrow functions it needs stop sitting inside
 * main's span: the brace-verification pass charges an enclosing function's
 * corrected complexity to the arrows nested within it, which reported each of
 * them at CCN 6 instead of 1 (measured through the gate's own --csv-verified
 * path). The behaviour is unchanged.
 */
function collectGateTimings(report, deps) {
  const { readAuditRows, gateTimingStats } = deps;
  const audit = readAuditRows(path.join(report.root, '.xp-gate', 'audit.jsonl'));
  const byGate = {};
  const gatesSeen = new Set([]);
  for (const row of audit) {
    if (row.gate_name) gatesSeen.add(row.gate_name);
  }
  for (const g of gatesSeen) {
    byGate[g] = gateTimingStats(audit.filter((row) => row.gate_name === g));
  }
  return { audit, byGate };
}

/** Production functions above the report's display threshold. */
function productionOverThreshold(functions) {
  return functions.filter((f) => f.bucket === 'production' && f.ccn > 10);
}

/**
 * Build and print the human/JSON report.
 *
 * Extracted from main() for readability, and load-bearing for a second reason:
 * the brace-verification pass assigns an enclosing function's corrected span to
 * the arrows nested inside it. When these filters lived inline in main(), the
 * three arrows were each charged main()'s complexity and reported CCN 6 instead
 * of 1 (measured through the gate's own --csv-verified path).
 */
function printReport(report, get, deps) {
  const { byGate } = collectGateTimings(report, deps);
  const prodOver = productionOverThreshold(report.functions);
  const summary = {
    files_scanned: report.filesScanned,
    production_functions_gt10: prodOver.length,
    test_functions_gt10: report.functions.filter((f) => f.bucket === 'test' && f.ccn > 10).length,
    mirror_functions_gt10: report.functions.filter((f) => f.bucket === 'mirror' && f.ccn > 10).length,
    worst_production: prodOver.sort((a, b) => b.ccn - a.ccn).slice(0, parseInt(get('--top') || '20', 10)),
    gate_timing: byGate,
  };
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`files scanned:            ${summary.files_scanned}`);
  console.log(`production funcs CCN>10:  ${summary.production_functions_gt10}   (canonical tree only)`);
  console.log(`test funcs CCN>10:        ${summary.test_functions_gt10}`);
  console.log(`mirror funcs CCN>10:      ${summary.mirror_functions_gt10}   (src/npm-package copies — fixed via canonical + prepack)`);
  console.log('\nworst production functions:');
  for (const f of summary.worst_production) {
    console.log(`  CCN=${String(f.ccn).padStart(4)}  ${f.file}:${f.line}  ${f.name}`);
  }
  console.log('\ngate timing (ms, anomalies filtered):');
  const ordered = Object.entries(byGate).sort((a, b) => (b[1].p50 || 0) - (a[1].p50 || 0));
  for (const [g, st] of ordered) {
    console.log(`  ${g.padEnd(26)} n=${String(st.count).padStart(4)}  p50=${st.p50 ?? '-'}  p95=${st.p95 ?? '-'}`);
  }
}
module.exports = { printReport, productionOverThreshold };
