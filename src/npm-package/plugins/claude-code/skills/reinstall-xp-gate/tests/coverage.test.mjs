import test from 'node:test';
import assert from 'node:assert/strict';

import { reportLines, fileRow, istanbulEntry, stripDecoration } from '../scripts/coverage.mjs';

// These pin the translation between Node's textual coverage report and the
// istanbul artefact Gate 5 reads. Getting it wrong in the lenient direction
// reports 100% for a tree nothing measured -- the same failure as parsing zero
// lizard rows as "no complex functions".

/** Two real rows exactly as node 24 prints them, emoji prefix and all. */
const REAL = [
  '\u2139 file             | line % | branch % | funcs % | uncovered lines',
  '\u2139 scripts          |        |          |         |',
  '\u2139   lib            |        |          |         |',
  '\u2139    ccn.mjs        | 100.00 |    96.30 |  100.00 |',
  '\u2139    tools.mjs      |  43.33 |   100.00 |   15.79 | 35-38 40-42',
  '\u2139 all files        |  88.29 |    93.14 |   81.47 |',
];

test('reportLines keeps only per-file rows', () => {
  // Directory headers (`lib |` with no number) and the summary separator must not
  // become rows: they would contribute a phantom 0% file.
  const rows = reportLines(REAL.join('\n')).map(fileRow).filter(Boolean);
  assert.deepEqual(rows.map((r) => r.file), ['ccn.mjs', 'tools.mjs']);
});

test('reportLines tolerates empty and malformed input', () => {
  assert.deepEqual(reportLines(''), []);
  assert.deepEqual(reportLines('no table here'), []);
  assert.deepEqual(reportLines(null), []);
});

test('fileRow reads the three percentages in order', () => {
  const row = fileRow('   tools.mjs      |  43.33 |   100.00 |   15.79 | 35-38');
  assert.deepEqual(row, { file: 'tools.mjs', lines: 43.33, branches: 100, funcs: 15.79 });
});

test('fileRow rejects a row whose percentage is not a number', () => {
  // A column shift or a truncated line must be dropped, not read as 0%.
  assert.equal(fileRow('lib | | | |'), null);
  assert.equal(fileRow('ccn.mjs | n/a | n/a | n/a'), null);
  assert.equal(fileRow('ccn.mjs'), null);
});

test('istanbulEntry emits the pct shape the gate reads', () => {
  // Gate 5 reads `total.lines.pct`; the other three keys exist so a reader that
  // asks for coverage other than lines gets a real number instead of undefined.
  const entry = istanbulEntry({ lines: 88.29, branches: 93.14, funcs: 81.47 });
  assert.equal(entry.lines.pct, 88.29);
  assert.equal(entry.branches.pct, 93.14);
  assert.equal(entry.functions.pct, 81.47);
  assert.equal(entry.statements.pct, 88.29);
});

test('stripDecoration handles both node report shapes', () => {
  // CI runs node 22 while local dev here is node 24, and they decorate the table
  // differently. Stripping only the emoji left "#   tools.mjs" as a file name on
  // CI: the row parsed and nothing failed, but the "worst file" line named a
  // file that does not exist. Both shapes are pinned so that cannot regress.
  assert.equal(stripDecoration('ℹ    ccn.mjs   | 100.00 |'), 'ccn.mjs   | 100.00 |');
  assert.equal(stripDecoration('ℹ #   tools.mjs  | 43.33 |'), 'tools.mjs  | 43.33 |');
  assert.equal(stripDecoration('ℹ ├─ util.mjs | 9 |'), 'util.mjs | 9 |');
});

test('node 22 tree rows survive the full parse', () => {
  const rows = reportLines('ℹ #   tools.mjs      |  43.33 |   100.00 |   15.79 | 35-38').map(fileRow).filter(Boolean);
  assert.deepEqual(rows.map((r) => r.file), ['tools.mjs']);
});
