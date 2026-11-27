#!/usr/bin/env node
/**
 * Write `coverage/coverage-summary.json` from Node's built-in coverage report.
 *
 * WHY THIS EXISTS
 * ---------------
 * xp-gate's Gate 5 refuses a JavaScript commit with
 * "coverage/coverage-summary.json not found", because it expects the istanbul
 * shape that vitest and jest emit. This repo deliberately has no test framework
 * (`node:test` is built in, zero dependencies), so nothing ever produced that
 * file and the gate blocked every commit on an artefact the project could never
 * generate.
 *
 * The options were to add vitest purely to satisfy a file-shape expectation, or
 * to translate what Node already measures. Node 24's `--experimental-test-coverage`
 * prints real per-file line/branch/function percentages, so the measurement is
 * not the problem -- only its format is. Translating keeps the zero-dependency
 * property and gives the gate an actual number instead of a hand-written
 * constant.
 *
 * Usage:
 *   node scripts/coverage.mjs            # write the summary, exit 1 below floor
 *   node scripts/coverage.mjs --json     # machine-readable
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const LINE_FLOOR = 80;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A coverage cell: digits with an optional decimal part. */
function isPct(cell) {
  return /^\d+(\.\d+)?$/.test(cell);
}

/**
 * Remove node's report decoration from the front of a line.
 *
 * Node 24 prefixes rows with the information emoji; node 22 uses tree glyphs
 * (`#`, `├─`, `│`) and indentation instead. Stripping only the emoji left the
 * file name reading `#   tools.mjs` on CI -- the row parsed, nothing failed, but
 * the "worst file" line named a file that does not exist. Both CI shapes are
 * pinned by tests/coverage.test.mjs.
 */
export function stripDecoration(line) {
  return String(line || '').replace(/^[\u2139\s\u2502\u251c\u2514\u2500#]+/, '').trim();
}

/**
 * Keep only lines that look like `name.mjs | 12.3 | ...`.
 *
 * The decoration is stripped first; without that the file name of every row
 * keeps a prefix and reports a path that matches nothing on disk.
 */
export function reportLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(stripDecoration)
    .filter((line) => line.includes('|') && /\.mjs\b/.test(line));
}

/** One `file | line% | branch% | funcs% | ...` row, or null if it is not one. */
export function fileRow(line) {
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length < 4) return null;
  const [file, lines, branches, funcs] = cells;
  // A blank cell must not become 0%: `Number('')` is 0, not NaN, so an empty
  // directory header would enter the average as a fully uncovered file and drag
  // the total down for a reason that has nothing to do with the code.
  if (!isPct(lines)) return null;
  return { file: file.trim(), lines: Number(lines), branches: Number(branches) || 0, funcs: Number(funcs) || 0 };
}

/** istanbul's per-file shape; Gate 5 reads `lines.pct` and nothing else. */
export function istanbulEntry(row) {
  return {
    lines: { pct: row.lines },
    branches: { pct: row.branches },
    functions: { pct: row.funcs },
    statements: { pct: row.lines },
  };
}

/** Average each column across files; a flat mean is what the gate's floor uses. */
export function meanOf(rows) {
  const avg = (pick) => Number((rows.reduce((s, r) => s + pick(r), 0) / rows.length).toFixed(2));
  return istanbulEntry({ lines: avg((r) => r.lines), branches: avg((r) => r.branches), funcs: avg((r) => r.funcs) });
}

/** Run the suite with coverage and return the parsed rows. */
function collect() {
  const files = fs.readdirSync(path.join(root, 'tests'))
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => path.join('tests', f));
  const r = spawnSync(process.execPath, ['--experimental-test-coverage', '--test', ...files], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  return { rows: reportLines(out).map(fileRow).filter(Boolean), exitCode: r.status, out };
}

function main() {
  const { rows, exitCode, out } = collect();
  if (rows.length === 0) {
    // Zero rows is a broken measurement, not full coverage. Saying so is the
    // whole lesson of scripts/hp-gate.mjs, where an empty parse read as a clean
    // pass and reported a tree with a CCN-22 function as compliant.
    console.error('coverage: node produced no per-file rows -- cannot report a percentage');
    console.error(out.split(/\r?\n/).slice(-15).join('\n'));
    process.exit(1);
  }

  const worst = rows.reduce((a, b) => (a.lines <= b.lines ? a : b));
  // Relative paths only: an absolute one buries this machine's temp directory in
  // a committed artefact, and the gate reads `total` anyway.
  const summary = { total: meanOf(rows), ...Object.fromEntries(rows.map((r) => [r.file, istanbulEntry(r)])) };

  fs.mkdirSync(path.join(root, 'coverage'), { recursive: true });
  fs.writeFileSync(path.join(root, 'coverage', 'coverage-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total: summary.total.lines.pct, worst, files: rows.length }, null, 2));
  } else {
    console.log(`coverage: ${rows.length} files, lines ${summary.total.lines.pct}%`
      + ` (floor ${LINE_FLOOR}%), worst ${worst.file} at ${worst.lines}%`);
  }

  // The test run itself failing must fail this step too; the coverage gate is not
  // a substitute for the suite.
  process.exit(exitCode !== 0 || summary.total.lines.pct < LINE_FLOOR ? 1 : 0);
}

// Importing this module must be side-effect free: tests/coverage.test.mjs needs
// the parsers, and a bare import used to re-run the whole suite as a child
// process, which the test runner reports as a recursive run() and fails.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
