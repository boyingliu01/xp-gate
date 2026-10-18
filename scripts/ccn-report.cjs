#!/usr/bin/env node
/**
 * ccn-report — trustworthy repo-wide complexity + gate-timing report.
 *
 * Why this exists (sprint-20261018-quality REQ-A): lizard's batch mode
 * inflates function spans across files (branches of later files get charged
 * to an earlier function — measured: update-hooks.test.js reported CCN=728
 * in batch, 10 per-file). The ONLY safe invocation is one lizard process
 * per file, so measureFileArgs() must always yield exactly one positional
 * target; the regression test pins that.
 *
 * Usage:
 *   node scripts/ccn-report.cjs [--root <dir>] [--json] [--top N]
 */
'use strict';

const { execFile, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|swift|cpp|cc|c|h|hpp|m|mm|dart)$/i;
const TEST_PATH = /(^|[\\/])__tests__?[\\/]|\.test\.[cm]?[jt]sx?$|_test\.(py|go)$|Test\.java$|Tests\.java$/i;
// src/npm-package/** is a prepack-generated mirror of githooks/, skills/ and
// src/** (and plugins/*/src likewise). Measuring mirrors double-counts the
// same code and would make every refactor look like two hotspots; the
// canonical tree is what gets fixed, so it is what gets measured.
const MIRROR_PREFIX = /^src\/npm-package\//;
// Vendored plugin bundles are build outputs of plugins/*/src (same rule as
// the npm-package mirror: fix canonical, prepack regenerates the copy).
const PLUGIN_BUNDLE_PREFIX = /^plugins\/[^/]+\/src\//;
const ANOMALY_MAX_MS = 2 * 3600 * 1000; // anything above a 2h gate run is poisoned bookkeeping

function bucketFor(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (MIRROR_PREFIX.test(p) || PLUGIN_BUNDLE_PREFIX.test(p)) return 'mirror';
  return TEST_PATH.test(p) ? 'test' : 'production';
}

// One positional target only — never a directory, never a batch list.
function measureFileArgs(relPath) {
  return ['--csv', path.normalize(relPath)];
}

function findSourceFiles(root) {
  const out = [];
  const skipDirs = new Set(['.git', 'node_modules', 'dist', '.worktrees', '.codegraph', '.sprint-state', '.xp-gate']);
  // Git-untracked files are not repo content: scratch dirs, .stryker-tmp
  // sandboxes and .qoder reports would otherwise flood the report with
  // phantom "production" functions that no gate can even see.
  let tracked = null;
  try {
    tracked = new Set(
      execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split(/\r?\n/)
        .filter(Boolean)
        .map((p) => path.normalize(p))
    );
  } catch { /* outside a git repo: fall back to walking everything */ }
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) walk(full);
      } else if (SOURCE_EXT.test(e.name)) {
        const rel = path.relative(root, full);
        if (!tracked || tracked.has(path.normalize(rel))) out.push(rel);
      }
    }
  })(root);
  return out;
}

function parseCsvLine(line) {
  // lizard CSV rows: fields quoted where they contain commas; no embedded newlines.
  const fields = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

function runLizardOne(lizardCmd, root, relPath) {
  return new Promise((resolve) => {
    execFile(lizardCmd, measureFileArgs(relPath), { cwd: root, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      // lizard exits non-zero when warnings exist; output is still valid.
      resolve(stdout || '');
    });
  });
}

// Lizard's TS parser loses brace balance on generic-arrow fields such as
// `const handlers: Record<string, (p: X, n?: Y) => boolean> = {` — the `<...>`
// reads as comparison operators and the `{` goes uncounted. From that line to
// EOF every reported function span swallows everything in between, so CCN is
// charged across neighbours (measured: showHelp body is 687-706 real, lizard
// reports 687-763 with CCN=77). The scary numbers are exactly the broken ones.
// Recompute CCN over the brace-balanced body instead: +1 base plus one per
// branch keyword outside strings/comments/templates.
const BRANCH_RE = /\b(if|for|while|case|catch)\b|\?\?|&&|\|\||\belse\b/g;

function stripNonCode(line) {
  // Remove string/template/comment content so keywords inside them do not count.
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i], nx = line[i + 1];
    if (ch === '/' && nx === '/') break;
    if (ch === '/' && nx === '*') { const end = line.indexOf('*/', i + 2); i = end < 0 ? line.length : end + 2; continue; }
    if (ch === '"' || ch === "'") {
      i++;
      while (i < line.length) { if (line[i] === '\\') { i += 2; continue; } if (line[i] === ch) { i++; break; } i++; }
      out += ' ';
      continue;
    }
    if (ch === '`') {
      i++;
      while (i < line.length) { if (line[i] === '\\') { i += 2; continue; } if (line[i] === '`') { i++; break; } i++; }
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function ccnOfBody(bodyLines) {
  let ccn = 1;
  for (const raw of bodyLines) {
    const hits = stripNonCode(raw).match(BRANCH_RE);
    if (hits) ccn += hits.length;
  }
  return ccn;
}

// Locate a function body by name via brace balance. Returns [startIdx, endIdx]
// inclusive over `lines`, or null when no balanced body matches.
function findFunctionBody(lines, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(function\\s+${esc}\\s*[(<]|\\b${esc}\\s*[:(])`);
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(stripNonCode(lines[i]))) continue;
    let d = 0, started = false;
    for (let j = i; j < lines.length; j++) {
      const code = stripNonCode(lines[j]);
      for (const ch of code) {
        if (ch === '{') { d++; started = true; }
        else if (ch === '}') d--;
      }
      if (started && d === 0) return [i, j];
    }
  }
  return null;
}

async function mapPool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) || 0 }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results.flat();
}

function resolveLizard() {
  try {
    execFileSync('lizard', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return 'lizard';
  } catch { /* fall through */ }
  const local = path.join(process.env.HOME || '', '.local', 'bin', 'lizard');
  if (fs.existsSync(local)) return local;
  throw new Error('lizard not found (pip install lizard)');
}

async function run(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const lizard = options.lizardCmd || resolveLizard();
  const files = findSourceFiles(root);
  // Sequential on purpose. A shared pool of concurrent lizards corrupts rows
  // in ways that silently zero the report (observed: 779 -> 0 with an 8-wide
  // pool on Windows). Per-file isolation is the whole point of this tool;
  // speed is secondary to trustworthiness.
  const functions = [];
  for (const rel of files) {
    const csv = await runLizardOne(lizard, root, rel);
    const bucket = bucketFor(rel);
    // Source lines for span verification (REQ-A: trust but verify lizard).
    let srcLines = null;
    try {
      srcLines = fs.readFileSync(path.join(root, rel), 'utf8').split(/\r?\n/);
    } catch { srcLines = null; }
    let dataRows = 0;
    let sawHeader = false;
    for (const line of csv.split(/\r?\n/)) {
      if (!line) continue;
      // CSV header (`NLOC,CCN,...`): printed once per file WITH function rows,
      // and also on its own when a file yields none. Track it so an empty
      // spawn output can be told apart from a genuinely function-less file —
      // silent zeros are exactly the failure mode this tool exists to kill.
      if (/^NLOC\b/.test(line)) { sawHeader = true; continue; }
      if (!/^\d+,/.test(line)) continue;
      dataRows++;
      const f = parseCsvLine(line);
      let ccn = parseInt(f[4], 10);
      if (!Number.isFinite(ccn)) continue;
      const nameField = f[7] || '(anon)';
      // long_name (field 5, "name@start-end@path") is the AUTHORITATIVE name:
      // field 8 is only trustworthy when it carries no '@'. A C operator
      // function ("operator,@12-18@f.cpp") would otherwise be keyed as "@12"
      // and vanish from the baseline — every later change then reads as a new
      // function. The ratchet lib parses names the same way; keep in sync.
      const loc = f[5] || '';
      let name = (nameField || '').trim();
      let lineNo = '';
      let endNo = 0;
      if (loc.includes('@')) {
        const at = loc.split('@');
        name = at[0];
        const span = (at[1] || '').split('-');
        lineNo = span[0];
        endNo = parseInt(span[1], 10) || 0;
        if (!name || /@/.test(name)) name = (nameField || '(anon)').trim();
      } else if (!name) {
        name = '(anon)';
      }
      // Span verification: when lizard's reported body is longer than the
      // brace-balanced truth, its CCN charged the neighbours too. Recompute
      // over the real extent and mark the row honest-but-corrected.
      let inflated = false;
      if (srcLines && Number(lineNo) > 0 && endNo > lineNo) {
        // Search window: the reported span plus slack — when lizard's parser
        // broke earlier in the file, its END line is wrong too, and a body
        // that really extends past the reported end must not be missed.
        const from = lineNo - 1;
        const to = Math.min(srcLines.length, endNo + 200);
        const body = findFunctionBody(srcLines.slice(from, to), name);
        if (body) {
          const realEnd = from + body[1];
          const recomputed = ccnOfBody(srcLines.slice(from + body[0], realEnd + 1));
          if (recomputed !== ccn) {
            inflated = recomputed < ccn;
            ccn = recomputed;
          }
        }
      }
      functions.push({ file: rel.replace(/\\/g, '/'), bucket, name, ccn, nloc: parseInt(f[0], 10) || 0, line: parseInt(lineNo, 10) || 0, span_inflated: inflated || undefined });
    }
    if (!dataRows && !sawHeader) {
      // Not a silent-zero risk: lizard emits NO header at all for files with
      // no parsable functions (empty config shims, type-only modules). Record
      // them so the report can prove coverage instead of hiding gaps.
      functions.push({ file: rel.replace(/\\/g, '/'), bucket, name: '(no parsable output)', ccn: 0, nloc: 0, line: 0 });
    }
  }
  return { root, filesScanned: files.length, functions };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function gateTimingStats(rows) {
  const ok = rows
    .filter((r) => Number.isFinite(r.duration_ms) && r.duration_ms >= 0 && r.duration_ms <= ANOMALY_MAX_MS && r.duration_anomaly !== true)
    .map((r) => r.duration_ms)
    .sort((a, b) => a - b);
  return { count: ok.length, p50: percentile(ok, 0.5), p95: percentile(ok, 0.95), max: ok.length ? ok[ok.length - 1] : null };
}

function readAuditRows(auditPath) {
  const rows = [];
  if (!fs.existsSync(auditPath)) return rows;
  for (const line of fs.readFileSync(auditPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* tolerate torn lines */ }
  }
  return rows;
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const report = await run({ root: get('--root') || process.cwd() });

  // Baseline refresh (REQ-D): record every production function's CURRENT CCN
  // keyed by path::name. Gate 3 then blocks only regressions past these
  // ceilings. Renames/moves intentionally fall out of the key space and are
  // treated as new code — moving debt around must not launder it.
  if (argv.includes('--write-baseline')) {
    const baseline = {};
    for (const f of report.functions) {
      if (f.bucket !== 'production' || f.name === '(no parsable output)') continue;
      baseline[`${f.file}::${f.name}`] = f.ccn;
    }
    const target = path.join(report.root, '.ccn-baseline.json');
    fs.writeFileSync(target, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`wrote ${Object.keys(baseline).length} entries -> ${target}`);
    return;
  }

  const audit = readAuditRows(path.join(report.root, '.xp-gate', 'audit.jsonl'));
  const byGate = {};
  const gatesSeen = new Set(audit.map((r) => r.gate_name).filter(Boolean));
  for (const g of gatesSeen) byGate[g] = gateTimingStats(audit.filter((r) => r.gate_name === g));
  const prodOver = report.functions.filter((f) => f.bucket === 'production' && f.ccn > 10);
  const summary = {
    files_scanned: report.filesScanned,
    production_functions_gt10: prodOver.length,
    test_functions_gt10: report.functions.filter((f) => f.bucket === 'test' && f.ccn > 10).length,
    mirror_functions_gt10: report.functions.filter((f) => f.bucket === 'mirror' && f.ccn > 10).length,
    worst_production: prodOver.sort((a, b) => b.ccn - a.ccn).slice(0, parseInt(get('--top') || '20', 10)),
    gate_timing: byGate,
  };
  if (argv.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`files scanned:            ${summary.files_scanned}`);
    console.log(`production funcs CCN>10:  ${summary.production_functions_gt10}   (canonical tree only)`);
    console.log(`test funcs CCN>10:        ${summary.test_functions_gt10}`);
    console.log(`mirror funcs CCN>10:      ${summary.mirror_functions_gt10}   (src/npm-package copies — fixed via canonical + prepack)`);
    console.log('\nworst production functions:');
    for (const f of summary.worst_production) console.log(`  CCN=${String(f.ccn).padStart(4)}  ${f.file}:${f.line}  ${f.name}`);
    console.log('\ngate timing (ms, anomalies filtered):');
    for (const [g, s] of Object.entries(byGate).sort((a, b) => (b[1].p50 || 0) - (a[1].p50 || 0))) {
      console.log(`  ${g.padEnd(26)} n=${String(s.count).padStart(4)}  p50=${s.p50 ?? '-'}  p95=${s.p95 ?? '-'}`);
    }
  }
}

module.exports = { run, measureFileArgs, bucketFor, gateTimingStats, findSourceFiles };

if (require.main === module) {
  main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
