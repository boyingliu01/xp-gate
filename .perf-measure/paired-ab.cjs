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

function cleanupTransient() {
  for (const dir of TRANSIENT_DIRS) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* best effort: never mask the measurement result */ }
  }
}

function prepareBaselineSources() {
  fs.rmSync(BASE_DIR, { recursive: true, force: true });
  fs.mkdirSync(BASE_DIR, { recursive: true });
  // Copy the whole gate source tree at HEAD so relative imports resolve.
  const files = ['common.ts', 'common-process.ts', 'gate-9.ts', 'python-health.ts'];
  for (const f of files) {
    const r = spawnSync('git', ['show', `HEAD:src/gates/${f}`], { cwd: REPO, encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`git show failed for ${f}: ${r.stderr}`);
    fs.writeFileSync(path.join(BASE_DIR, f), r.stdout);
  }
}

function makeFixture() {
  fs.rmSync(FIXTURE, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE, 'README.md'), '# fixture\n');
  fs.writeFileSync(path.join(FIXTURE, 'data.json'), '{"a":1}\n');
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
  const r = spawnSync(process.execPath, [TSX_CLI, entry, '--run', '--cwd', FIXTURE], {
    encoding: 'utf-8', cwd: FIXTURE, timeout: 300000,
  });
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6, rc: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function main() {
  const rounds = +(process.argv[2] || 6);
  prepareBaselineSources();
  makeFixture();
  // Whatever happens below (including a throw mid-measurement), the transient
  // source copy must not survive into the working tree — see TRANSIENT_DIRS.
  process.on('exit', cleanupTransient);
  process.on('SIGINT', () => { cleanupTransient(); process.exit(130); });
  process.on('SIGTERM', () => { cleanupTransient(); process.exit(143); });

  const arms = {
    baseline: { entry: (g) => path.join(BASE_DIR, g.rel) },
    current: { entry: (g) => path.join(REPO, 'src', 'gates', g.rel) },
  };

  const res = {};
  for (const g of GATES) {
    res[g.name] = { baseline: { ms: [], load: [], verdict: [] }, current: { ms: [], load: [], verdict: [] } };
  }

  for (let r = 0; r < rounds; r++) {
    // ABBA: odd rounds run current-first, even rounds baseline-first.
    const order = r % 2 === 0 ? ['baseline', 'current'] : ['current', 'baseline'];
    for (const g of GATES) {
      for (const arm of order) {
        const load = cpuLoad();
        const out = runOne(arms[arm].entry(g));
        res[g.name][arm].ms.push(out.ms);
        res[g.name][arm].load.push(load);
        const m = out.out.match(/SKIPPED[^\n]*|WARN[^\n]*|PASSED[^\n]*|BLOCKED[^\n]*/);
        res[g.name][arm].verdict.push(m ? m[0].trim().slice(0, 55) : '?');
      }
    }
  }

  console.log(`\n=== PAIRED A/B (ABBA interval, ${rounds} rounds/gate) ===`);
  let allValid = true;
  for (const g of GATES) {
    const A = res[g.name].baseline;
    const B = res[g.name].current;
    const mean = (xs) => xs.reduce((x, y) => x + y, 0) / xs.length;
    const loadA = mean(A.load);
    const loadB = mean(B.load);
    const loadDiffPct = Math.abs(loadB - loadA) / Math.max(loadA, 1) * 100;
    // Rule 6: a load difference >5% invalidates the comparison.
    const valid = loadDiffPct <= 5;

    console.log(`\n--- ${g.name} ---`);
    console.log(`  baseline ms : ${A.ms.map((x) => Math.round(x)).join(', ')}`);
    console.log(`  current  ms : ${B.ms.map((x) => Math.round(x)).join(', ')}`);
    console.log(`  baseline med: ${median(A.ms).toFixed(0)} ms   (mean load ${loadA.toFixed(1)}%)`);
    console.log(`  current  med: ${median(B.ms).toFixed(0)} ms   (mean load ${loadB.toFixed(1)}%)`);
    const delta = (median(B.ms) - median(A.ms)) / median(A.ms) * 100;
    console.log(`  delta       : ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%  (negative = faster)`);
    console.log(`  LOAD VALID  : ${valid ? 'YES' : 'NO  <-- load diff ' + loadDiffPct.toFixed(1) + '% > 5%, comparison INVALID'}`);
    if (!valid) allValid = false;
    const sameVerdict = A.verdict.every((v) => v === B.verdict[0]) || A.verdict[0] === B.verdict[0];
    console.log(`  verdict A   : ${A.verdict[0]}`);
    console.log(`  verdict B   : ${B.verdict[0]}`);
    console.log(`  SAME VERDICT: ${A.verdict[0] === B.verdict[0] ? 'YES' : 'NO  <-- behaviour changed!'}`);
  }

  console.log(`\nOVERALL: ${allValid ? 'all comparisons load-valid' : 'some comparisons INVALID by rule 6'}`);
  fs.writeFileSync(path.join(__dirname, 'paired-ab-result.json'), JSON.stringify(res, null, 2));
  cleanupTransient();
}

try {
  main();
} finally {
  cleanupTransient();
}
