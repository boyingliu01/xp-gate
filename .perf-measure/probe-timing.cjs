/**
 * Measurement harness for P0-A input short-circuit (2026-11-09 handoff).
 *
 * Measures the TWO gates the handoff names as the remaining cost drivers:
 *   - gate-9 (SAST / semgrep)
 *   - python-health (5 tool probes)
 *
 * CALL CONTRACT (read from source, per ~/.dsh/AGENTS.md rule 1):
 *   src/npm-package/lib/gate-runner.js  resolveTsxInvocation():
 *     command = process.execPath
 *     args    = [ <node_modules/tsx/dist/cli.mjs>, <gate entry .ts>, '--run' ]
 *   and the gate module itself reads `--cwd <dir>` from argv.
 *   So: node node_modules/tsx/dist/cli.mjs src/gates/<g>.ts --run --cwd <fixture>
 *
 * NOTE: dist/gates/*.js (plain tsc output) CANNOT be run directly -- package.json is
 * "type":"module" and the emitted imports are extension-less, so node throws
 * ERR_MODULE_NOT_FOUND. tsx is not an optimisation here, it is the real loader.
 *
 * Fixture: NO input file for either gate (no semgrep-supported source, no .py).
 * That is the case the handoff measured as gate-9 2.1s / python-health 10.2s.
 *
 * Sampling: ABBA alternating + per-round load (rules 5/6), local disk only.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(REPO, '.perf-measure', 'fixture-no-input');
const TSX_CLI = path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const GATES = [
  { name: 'gate-9', entry: path.join(REPO, 'src', 'gates', 'gate-9.ts') },
  { name: 'python-health', entry: path.join(REPO, 'src', 'gates', 'python-health.ts') },
];

function makeFixture() {
  fs.rmSync(FIXTURE, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE, { recursive: true });
  // Files that match NO gate's input filter.
  fs.writeFileSync(path.join(FIXTURE, 'README.md'), '# fixture\n');
  fs.writeFileSync(path.join(FIXTURE, 'data.json'), '{"a":1}\n');
}

/** Real-time CPU load %, from os.cpus() deltas over ~300ms. */
function cpuLoad() {
  const snap = () => os.cpus().map(c => ({ idle: c.times.idle, total: Object.values(c.times).reduce((x, y) => x + y, 0) }));
  const a = snap();
  const t0 = Date.now();
  while (Date.now() - t0 < 300) { /* busy wait for a usable delta */ }
  const b = snap();
  let idle = 0, total = 0;
  b.forEach((c, i) => {
    idle += c.idle - a[i].idle;
    total += c.total - a[i].total;
  });
  return total > 0 ? +(100 * (1 - idle / total)).toFixed(1) : 0;
}

function timeGate(gate) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(
    process.execPath,
    [TSX_CLI, gate.entry, '--run', '--cwd', FIXTURE],
    { encoding: 'utf-8', cwd: FIXTURE, timeout: 300000 }
  );
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6, rc: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function main() {
  const rounds = +(process.argv[2] || 5);
  const label = process.argv[3] || 'run';

  if (!fs.existsSync(TSX_CLI)) { console.error('tsx CLI missing at ' + TSX_CLI); process.exit(1); }
  makeFixture();

  const report = {};
  for (const g of GATES) report[g.name] = { samples: [], loads: [], verdicts: [] };

  for (let r = 0; r < rounds; r++) {
    const order = r % 2 === 0 ? GATES : [...GATES].reverse(); // ABBA
    for (const g of order) {
      const load = cpuLoad();
      const res = timeGate(g);
      report[g.name].samples.push(Math.round(res.ms));
      report[g.name].loads.push(load);
      const m = res.out.match(/SKIPPED[^\n]*|WARN[^\n]*|PASSED[^\n]*|BLOCKED[^\n]*|Python:[^\n]*/);
      report[g.name].verdicts.push({ rc: res.rc, verdict: (m ? m[0] : '?').trim().slice(0, 70) });
    }
  }

  console.log(`\n=== probe-timing [${label}] ===`);
  console.log('fixture:', FIXTURE, '(no gate-relevant input)');
  for (const g of GATES) {
    const d = report[g.name];
    const meanLoad = d.loads.reduce((a, b) => a + b, 0) / d.loads.length;
    console.log(`\n${g.name}`);
    console.log(`  samples(ms)  : ${d.samples.join(', ')}`);
    console.log(`  min/median/max: ${Math.min(...d.samples)} / ${median(d.samples).toFixed(0)} / ${Math.max(...d.samples)}`);
    console.log(`  cpu load %   : ${d.loads.join(', ')}  (mean ${meanLoad.toFixed(1)})`);
    console.log(`  verdicts     : ${d.verdicts.map(v => `rc=${v.rc} ${v.verdict}`).join(' | ')}`);
  }
  fs.writeFileSync(path.join(__dirname, `result-${label}.json`), JSON.stringify(report, null, 2));
}

main();
