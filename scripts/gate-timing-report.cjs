#!/usr/bin/env node
/**
 * gate-timing-report.cjs — per-gate duration statistics from the audit journal.
 *
 * WHY THIS EXISTS
 *
 * The efficiency half of the quality standard says a gate's p90 must be
 * proportionate to its value. Before this script there was no timing baseline at
 * all, so any claim that a gate was slow was an impression, not a measurement.
 *
 * THE DATA IS ALREADY THERE
 *
 * pre-commit records `duration_ms` on every audit line through
 * `record_gate_audit`. Nothing needs instrumenting; it only needed reading.
 *
 * WHY p90 AND MEDIAN ARE BOTH PRINTED, AND WHY p90 IS THE HEADLINE
 *
 * Measured 2026-11-22 over 12 hours: gate-10's median is 0.3 s and its p90 is
 * 132.6 s. A mean would call that gate "almost free" while one commit in ten waits
 * over two minutes. A distribution that bimodal is a fact about the gate, and a
 * single number hides it, so both columns are shown and the slowest samples are
 * listed too.
 *
 * SAMPLE SIZE IS REPORTED, NOT HIDDEN
 *
 * A p90 over 14 samples is "the worst couple of runs", not a percentile. The
 * report prints N for every row and warns when it is small, because a confident
 * p90 from 14 points is exactly the kind of number that drives a wrong decision.
 *
 * USAGE
 *   node scripts/gate-timing-report.cjs
 *   node scripts/gate-timing-report.cjs --hours 24
 *   node scripts/gate-timing-report.cjs --json
 *   node scripts/gate-timing-report.cjs --journal path/to/audit.jsonl
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RULE_WIDTH = 78;

/** Below this many samples a p90 is the worst few runs, not a percentile. */
const MIN_SAMPLES_FOR_PERCENTILE = 30;

function parseArgs(argv) {
  const opts = { hours: 12, json: false, journal: path.join(ROOT, '.xp-gate', 'audit.jsonl') };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--hours') opts.hours = Number(argv[(i += 1)]);
    else if (a === '--journal') opts.journal = argv[(i += 1)];
  }
  return opts;
}

function readJournal(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        // A truncated final line is normal for a journal appended to during a run.
        return null;
      }
    })
    .filter(Boolean);
}

/** Keep entries newer than the cutoff. An unparseable timestamp is dropped. */
function within(rows, hours) {
  const cutoff = Date.now() - hours * 3600 * 1000;
  return rows.filter((r) => {
    const t = Date.parse(r.timestamp);
    return Number.isFinite(t) && t >= cutoff;
  });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function summarise(rows) {
  const byGate = new Map();
  for (const r of rows) {
    if (typeof r.duration_ms !== 'number') continue;
    const id = r.gate_id || '(unknown)';
    if (!byGate.has(id)) byGate.set(id, []);
    byGate.get(id).push(r.duration_ms);
  }
  const out = [];
  for (const [gate, durations] of byGate) {
    const sorted = [...durations].sort((a, b) => a - b);
    out.push({
      gate,
      samples: sorted.length,
      median: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
      max: sorted[sorted.length - 1],
      sum: sorted.reduce((a, b) => a + b, 0),
    });
  }
  out.sort((a, b) => b.median - a.median);
  return out;
}

function pad(s, n) {
  const str = String(s);
  return str.length >= n ? str : str + ' '.repeat(n - str.length);
}

function printTable(rows, hours) {
  const medianTotal = rows.reduce((a, b) => a + b.median, 0);
  console.log('');
  console.log('='.repeat(RULE_WIDTH));
  console.log(`  GATE TIMING — last ${hours}h`);
  console.log('='.repeat(RULE_WIDTH));
  console.log('');
  console.log(
    `  ${pad('GATE', 12)}${pad('N', 5)}${pad('MEDIAN', 10)}${pad('P90', 10)}${pad('MAX', 10)}MEDIAN SHARE`
  );
  console.log(
    `  ${'-'.repeat(11)} ${'-'.repeat(4)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(12)}`
  );
  for (const r of rows) {
    const share = medianTotal === 0 ? '0.0%' : `${((100 * r.median) / medianTotal).toFixed(1)}%`;
    const flag = r.samples < MIN_SAMPLES_FOR_PERCENTILE ? ' *' : '';
    console.log(
      `  ${pad(r.gate, 12)}${pad(r.samples, 5)}${pad(`${(r.median / 1000).toFixed(1)}s`, 10)}${pad(
        `${(r.p90 / 1000).toFixed(1)}s`,
        10
      )}${pad(`${(r.max / 1000).toFixed(1)}s`, 10)}${share}${flag}`
    );
  }
  console.log('');
  console.log(`  median total across gates: ${(medianTotal / 1000).toFixed(1)}s`);
  console.log('  (a sum of per-gate medians, NOT one commit wall clock)');
}

function printFindings(rows) {
  console.log('');
  console.log('-'.repeat(RULE_WIDTH));
  console.log('  FINDINGS');
  console.log('-'.repeat(RULE_WIDTH));
  console.log('');

  // Bimodality: a p90 far above the median means two execution paths, not noise.
  const bimodal = rows
    .filter((r) => r.median > 0 && r.p90 / r.median >= 10)
    .map((r) => `${r.gate} (median ${(r.median / 1000).toFixed(1)}s, p90 ${(r.p90 / 1000).toFixed(1)}s, ${Math.round(
      r.p90 / r.median
    )}x)`);
  if (bimodal.length > 0) {
    console.log('  Bimodal runtime — two execution paths, not tail noise:');
    for (const b of bimodal) console.log(`    ${b}`);
  } else {
    console.log('  No gate shows a bimodal distribution (p90 < 10x median).');
  }
  console.log('');

  const small = rows.filter((r) => r.samples < MIN_SAMPLES_FOR_PERCENTILE);
  if (small.length > 0) {
    console.log(`  * fewer than ${MIN_SAMPLES_FOR_PERCENTILE} samples: p90 is "the worst few runs",`);
    console.log(`    not a percentile. ${small.length} of ${rows.length} gates are in that state.`);
  }
  console.log('');
  console.log('  SLOW IS NOT A REASON TO DELETE. It is a reason to investigate.');
  console.log('  A gate that spends time verifying earns that time back when it works.');
  console.log('');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rows = within(readJournal(opts.journal), opts.hours);
  const summary = summarise(rows);

  if (opts.json) {
    console.log(JSON.stringify({ hours: opts.hours, gates: summary }, null, 2));
    return;
  }
  if (summary.length === 0) {
    console.log(`No timing records in ${opts.journal} within ${opts.hours}h.`);
    return;
  }
  printTable(summary, opts.hours);
  printFindings(summary);
}

main();
