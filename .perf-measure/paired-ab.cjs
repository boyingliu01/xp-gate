/**
 * Paired A/B: baseline implementation vs short-circuit implementation, run
 * INTERLEAVED so drift in machine load affects both groups symmetrically
 * (~/.dsh/AGENTS.md rules 5 and 6; a cross-run A vs B comparison is invalid here
 * because this machine's load swings between 20% and 80%).
 *
 * Method: keep two copies of the gate sources side by side — `baseline/` taken from
 * git HEAD, `current/` from the working tree — and alternate them ABBA within each
 * round. The gate under test is chosen by which source tree the tsx entry points at,
 * so the ONLY difference between A and B is the code.
 *
 * Usage: node .perf-measure/paired-ab.cjs [rounds]
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(REPO, '.perf-measure', 'fixture-no-input');
const BASE_DIR = path.join(REPO, '.perf-measure', 'baseline-src');
const TSX_CLI = path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const GATES = [
  { name: 'gate-9', rel: 'gate-9.ts' },
  { name: 'python-health', rel: 'python-health.ts' },
];

/**
 * Transient directories this script creates.
 *
 * MUST be removed on exit: `baseline-src/` is a full copy of gate sources, so
 * leaving it behind makes archlint (Gate 6) and jscpd (Gate 2) report the repo's
 * own sources as HIGH-severity CodeClone against themselves — which is exactly
 * how this script once turned the repository's `xp-gate arch` check red.
 */
const TRANSIENT_DIRS = [BASE_DIR, FIXTURE];

/**
 * Git ref the baseline arm is built from.
 *
 * Defaults to HEAD, which is only correct while the change under test is
 * UNCOMMITTED. Once it lands, HEAD already contains it and both arms run the same
 * code — the comparison then reports ~0% and looks like a failed optimisation.
 * Point this at the parent commit to re-measure a landed change:
 *
 *   BASELINE_REF=HEAD~1 node .perf-measure/paired-ab.cjs 12
 */
const BASE_REF = process.env.BASELINE_REF || 'HEAD';

function cleanupTransient() {
  for (const dir of TRANSIENT_DIRS) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* best effort: never mask the measurement result */ }
  }
}

function prepareBaselineSources() {
  try {
    fs.rmSync(BASE_DIR, { recursive: true, force: true });
    fs.mkdirSync(BASE_DIR, { recursive: true });
  } catch (err) {
    // Without the baseline tree there is no A arm, and continuing would compare the
    // current code with itself -- a clean, meaningless result.
    throw new Error(`cannot prepare the baseline sources at ${BASE_DIR}: ${err.message}`);
  }
  // Copy the whole gate source tree at HEAD so relative imports resolve.
  const files = ['common.ts', 'common-process.ts', 'gate-9.ts', 'python-health.ts'];
  for (const f of files) {
    const r = spawnSync('git', ['show', `${BASE_REF}:src/gates/${f}`], { cwd: REPO, encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`git show failed for ${f}: ${r.stderr}`);
    fs.writeFileSync(path.join(BASE_DIR, f), r.stdout);
  }
}

function makeFixture() {
  try {
    fs.rmSync(FIXTURE, { recursive: true, force: true });
    fs.mkdirSync(FIXTURE, { recursive: true });
    fs.writeFileSync(path.join(FIXTURE, 'README.md'), '# fixture\n');
    fs.writeFileSync(path.join(FIXTURE, 'data.json'), '{"a":1}\n');
  } catch (err) {
    throw new Error(`cannot create the fixture at ${FIXTURE}: ${err.message}`);
  }
}

function cpuLoad() {
  const snap = () => os.cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((x, y) => x + y, 0) }));
  const a = snap();
  const t0 = Date.now();
  while (Date.now() - t0 < 300) { /* busy wait */ }
  const b = snap();
  let idle = 0, total = 0;
  b.forEach((c, i) => { idle += c.idle - a[i].idle; total += c.total - a[i].total; });
  return total > 0 ? 100 * (1 - idle / total) : 0;
}

function runOne(entry) {
  const t0 = process.hrtime.bigint();
  try {
    const r = spawnSync(process.execPath, [TSX_CLI, entry, '--run', '--cwd', FIXTURE], {
      encoding: 'utf-8', cwd: FIXTURE, timeout: 300000,
    });
    const t1 = process.hrtime.bigint();
    return { ms: Number(t1 - t0) / 1e6, rc: r.status, out: (r.stdout || '') + (r.stderr || '') };
  } catch (err) {
    // A run that could not even START still consumed the wall time, and silently
    // dropping it would shrink the sample and bias the median.
    const t1 = process.hrtime.bigint();
    return { ms: Number(t1 - t0) / 1e6, rc: -1, out: `SPAWN FAILED: ${err.message}` };
  }
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Empty per-gate result bucket. */
function emptyResult() {
  const res = {};
  for (const g of GATES) {
    res[g.name] = { baseline: { ms: [], load: [], verdict: [] }, current: { ms: [], load: [], verdict: [] } };
  }
  return res;
}

/** Extract a comparable verdict word from a gate's output. */
function verdictOf(out) {
  const m = out.match(/SKIPPED[^\n]*|WARN[^\n]*|PASSED[^\n]*|BLOCKED[^\n]*/);
  return m ? m[0].trim().slice(0, 55) : '?';
}

/** Run one round for one gate in both arms, in ABBA order. */
function runRound(arms, g, roundIndex, res) {
  const order = roundIndex % 2 === 0 ? ['baseline', 'current'] : ['current', 'baseline'];
  for (const arm of order) {
    const load = cpuLoad();
    const out = runOne(arms[arm].entry(g));
    res[g.name][arm].ms.push(out.ms);
    res[g.name][arm].load.push(load);
    res[g.name][arm].verdict.push(verdictOf(out.out));
  }
}

/** Install the cleanup handlers that keep transient dirs out of the worktree. */
function installCleanupHandlers() {
  process.on('exit', cleanupTransient);
  process.on('SIGINT', () => { cleanupTransient(); process.exit(130); });
  process.on('SIGTERM', () => { cleanupTransient(); process.exit(143); });
}

function main() {
  const rounds = +(process.argv[2] || 6);
  prepareBaselineSources();
  makeFixture();
  // Whatever happens below (including a throw mid-measurement), the transient source copy
  // must not survive into the working tree — see TRANSIENT_DIRS.
  installCleanupHandlers();

  const res = measureAll(rounds);
  printReport(res, rounds);
  writeResultFile(res);
  cleanupTransient();
}

/**
 * Persist the raw result.
 *
 * A failed write is REPORTED rather than thrown: the console report has already been
 * printed, and losing the JSON must not make a completed measurement look failed.
 */
function writeResultFile(res) {
  try {
    fs.writeFileSync(path.join(__dirname, 'paired-ab-result.json'), JSON.stringify(res, null, 2));
  } catch (err) {
    console.error(`could not write paired-ab-result.json: ${err.message}`);
  }
}

/** The arithmetic mean of a non-empty list. */
function meanOf(xs) {
  return xs.reduce((x, y) => x + y, 0) / xs.length;
}

/** Both arms, as the ABBA schedule consumes them. */
function armsFor() {
  return {
    baseline: { entry: (g) => path.join(BASE_DIR, g.rel) },
    current: { entry: (g) => path.join(REPO, 'src', 'gates', g.rel) },
  };
}

/** Run every gate for every round, alternating A-B-B-A. */
function measureAll(rounds) {
  const arms = armsFor();
  const res = emptyResult();
  for (let r = 0; r < rounds; r++) {
    for (const g of GATES) runRound(arms, g, r, res);
  }
  return res;
}

/**
 * Print one line of the per-gate A/B comparison.
 *
 * Rule 6 of the measurement discipline: a load difference above 5% between the arms makes
 * the comparison INVALID, and saying so is the point -- a number produced under unequal
 * load is a time trend, not a treatment effect.
 */
function printComparison(g, res, onInvalid) {
  const A = res[g.name].baseline;
  const B = res[g.name].current;
  const loadA = meanOf(A.load);
  const loadB = meanOf(B.load);
  const loadDiffPct = Math.abs(loadB - loadA) / Math.max(loadA, 1) * 100;
  const valid = loadDiffPct <= 5;
  if (!valid) onInvalid();

  console.log(`\n--- ${g.name} ---`);
  console.log(`  baseline ms : ${A.ms.map((x) => Math.round(x)).join(', ')}`);
  console.log(`  current  ms : ${B.ms.map((x) => Math.round(x)).join(', ')}`);
  console.log(`  baseline med: ${median(A.ms).toFixed(0)} ms   (mean load ${loadA.toFixed(1)}%)`);
  console.log(`  current  med: ${median(B.ms).toFixed(0)} ms   (mean load ${loadB.toFixed(1)}%)`);
  const delta = (median(B.ms) - median(A.ms)) / median(A.ms) * 100;
  console.log(`  delta       : ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%  (negative = faster)`);
  console.log(`  LOAD VALID  : ${valid ? 'YES' : 'NO  <-- load diff ' + loadDiffPct.toFixed(1) + '% > 5%, comparison INVALID'}`);
  console.log(`  verdict A   : ${A.verdict[0]}`);
  console.log(`  verdict B   : ${B.verdict[0]}`);
  console.log(`  SAME VERDICT: ${A.verdict[0] === B.verdict[0] ? 'YES' : 'NO  <-- behaviour changed!'}`);
}

/** The whole report: every gate, then the overall validity line. */
function printReport(res, rounds) {
  console.log(`\n=== PAIRED A/B (ABBA interval, ${rounds} rounds/gate) ===`);
  let allValid = true;
  for (const g of GATES) {
    printComparison(g, res, () => { allValid = false; });
  }
  console.log(`\nOVERALL: ${allValid ? 'all comparisons load-valid' : 'some comparisons INVALID by rule 6'}`);
}

try {
  main();
} finally {
  cleanupTransient();
}
