import test from 'node:test';
import assert from 'node:assert/strict';

import { table, section, item, note, MARK } from '../scripts/lib/report.mjs';

/** Capture everything a reporter function writes to stdout. */
function capture(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

test('MARK exposes every status the report renders', () => {
  for (const key of ['PASS', 'WARN', 'FAIL', 'SKIP', 'INFO']) {
    assert.equal(typeof MARK[key], 'string');
    assert.ok(MARK[key].length > 0);
  }
});

test('section and item format exactly one line each', () => {
  assert.deepEqual(capture(() => section('Title')), ['\n=== Title ===']);
  assert.deepEqual(capture(() => item(MARK.PASS, 'all good')), ['  [PASS] all good']);
  assert.deepEqual(capture(() => note('detail')), ['         detail']);
});

test('table pads every column to the widest cell', () => {
  const lines = capture(() => table(['a', 'bb'], [['xx', 'y'], ['z', 'zzz']]));
  assert.equal(lines.length, 4);

  const sep = lines[1].replace(/^ {2}/, '');
  const parts = sep.split('  ');
  // Widest cell per column: "a"/"xx"/"z" -> 2, "bb"/"y"/"zzz" -> 3.
  assert.equal(parts[0].length, 2);
  assert.equal(parts[1].length, 3);

  // Every data row must start its cells at the same offsets, or the table
  // renders misaligned -- the one job this helper has.
  for (const line of [lines[0], lines[2], lines[3]]) {
    const body = line.replace(/^ {2}/, '');
    assert.ok(body.slice(0, 2).trim().length > 0);
    assert.equal(body.slice(2, 4), '  ');
  }
});

test('table renders null and undefined cells as empty, not "null"', () => {
  const lines = capture(() => table(['h'], [[null], [undefined], [0]]));
  assert.ok(!lines.some((l) => l.includes('null') || l.includes('undefined')));
  // 0 must still render; only null/undefined become blank.
  assert.ok(lines.some((l) => l.trim() === '0'));
});

test('table handles a headers-only call without throwing', () => {
  assert.equal(capture(() => table(['only'], [])).length, 2);
});

test('table with a single column does not emit undefined', () => {
  const lines = capture(() => table(['x'], [['1'], ['22']]));
  assert.equal(lines.length, 4);
  assert.ok(lines.every((l) => !l.includes('undefined')));
});
