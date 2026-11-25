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
/**
 * How many functions in one bucket exceed `threshold`.
 *
 * One helper for the four counters because the predicate was written out four times --
 * and each copy is an arrow whose `&&` and comparison land as branches, so the report
 * function carried four spurious CCN points for arithmetic it does not do.
 *
 * @param {Array<{bucket: string, ccn: number}>} functions
 * @param {string} bucket
 * @param {number} threshold
 * @returns {number}
 */
function countOverByBucket(functions, bucket, threshold) {
  return functions.filter((f) => f.bucket === bucket && f.ccn > threshold).length;
}
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
  const summary = buildSummary(report, get, deps);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  printSummary(summary);
}

/**
 * The machine-readable summary.
 *
 * `host_closure_functions_gt10` is PRESENT so the number cannot vanish: those are
 * reported by lizard as one huge function because the HOST's loader requires a single
 * closure, not because the code is complex. Counting them as production would block every
 * commit on a shape nobody can change; hiding them would make the report lie by omission.
 */
function buildSummary(report, get, deps) {
  const { byGate } = collectGateTimings(report, deps);
  const prodOver = productionOverThreshold(report.functions);
  const top = parseInt(get('--top') || '20', 10);
  return {
    files_scanned: report.filesScanned,
    production_functions_gt10: prodOver.length,
    test_functions_gt10: countOverByBucket(report.functions, 'test', 10),
    mirror_functions_gt10: countOverByBucket(report.functions, 'mirror', 10),
    host_closure_functions_gt10: countOverByBucket(report.functions, 'host-closure', 10),
    worst_production: prodOver.sort((a, b) => b.ccn - a.ccn).slice(0, top),
    gate_timing: byGate,
  };
}

/** The human-readable report. */
function printSummary(summary) {
  console.log(`files scanned:            ${summary.files_scanned}`);
  console.log(`production funcs CCN>10:  ${summary.production_functions_gt10}   (canonical tree only)`);
  console.log(`test funcs CCN>10:        ${summary.test_functions_gt10}`);
  console.log(`mirror funcs CCN>10:      ${summary.mirror_functions_gt10}   (src/npm-package copies — fixed via canonical + prepack)`);
  console.log(`host-closure funcs CCN>10: ${summary.host_closure_functions_gt10}   (single-closure client entries the host loader requires — measurement artefact, not complexity)`);
  console.log('\nworst production functions:');
  for (const f of summary.worst_production) {
    console.log(`  CCN=${String(f.ccn).padStart(4)}  ${f.file}:${f.line}  ${f.name}`);
  }
  console.log('\ngate timing (ms, anomalies filtered):');
  // Slowest p50 first: the gate worth investigating is the one that usually takes long,
  // not the one that once had a bad tail.
  for (const [g, st] of sortedGates(summary.gate_timing)) {
    console.log(`  ${g.padEnd(26)} n=${String(st.count).padStart(4)}  p50=${st.p50 ?? '-'}  p95=${st.p95 ?? '-'}`);
  }
}

/** Gate timings, slowest median first. */
function sortedGates(byGate) {
  return Object.entries(byGate).sort((a, b) => (b[1].p50 || 0) - (a[1].p50 || 0));
}

module.exports = { printReport, productionOverThreshold };
