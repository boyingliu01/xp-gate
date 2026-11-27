import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLizardCsv, ccnViolations, splitCsvLine } from '../scripts/lib/ccn.mjs';

// These tests exist because the complexity check silently passed on a tree that
// contained a CCN-22 function, twice, for two different reasons: lizard was run
// without --csv (so stdout was empty), and the CSV column indices were wrong (so
// every row was dropped). Both failures looked exactly like clean code.

/** A real lizard 1.26.1 record, copied verbatim apart from the numbers. */
const REAL_ROW = '13,11,99,1,13,"tangled@1-13@src/a.js","src/a.js","tangled","tangled ( n )",1,13';

test('parseLizardCsv reads CCN from column 1, not column 0', () => {
  // Column 0 is NLOC (13 here). A parser reading column 0 reports the wrong
  // number and, worse, ranks a 13-line flat function above a branchy one.
  const [row] = parseLizardCsv(REAL_ROW);
  assert.equal(row.ccn, 11);
  assert.equal(row.nloc, 13);
});

test('parseLizardCsv does not use the token count as complexity', () => {
  // Columns 1 and 2 are adjacent and both plausible-looking numbers. Measured
  // contrast that makes the trap concrete: a branch-free helper is CCN 1 with 54
  // tokens, while a two-branch function is CCN 3 with 25 tokens -- so ranking by
  // tokens orders the code backwards. This fixture pins CCN 1 alongside a much
  // larger token count.
  const flat = '7,1,54,1,7,"simple@1-7@a.js","a.js","simple","simple ( n )",1,7';
  const [row] = parseLizardCsv(flat);
  assert.equal(row.ccn, 1, 'a branch-free function is CCN 1');
  assert.notEqual(row.ccn, 54, 'the token count must never be read as CCN');
});

test('parseLizardCsv keeps the file and the source line of the violation', () => {
  // A violation detached from its file is not actionable; this is what a naive
  // split(',') produces, because lizard's signature cell contains commas.
  const [row] = parseLizardCsv(REAL_ROW);
  assert.equal(row.file, 'src/a.js');
  assert.equal(row.line, 1);
  assert.equal(row.name, 'tangled');
});

test('parseLizardCsv survives a signature containing commas', () => {
  const row = '9,7,80,2,9,"f@5-9@b.js","b.js","f","f ( a , b )",5,9';
  const [parsed] = parseLizardCsv(row);
  assert.equal(parsed.ccn, 7);
  assert.equal(parsed.file, 'b.js');
  assert.equal(parsed.line, 5);
});

test('parseLizardCsv drops non-function lines instead of counting them as CCN 0', () => {
  assert.deepEqual(parseLizardCsv(''), []);
  assert.deepEqual(parseLizardCsv('not,a,function,row'), []);
  assert.deepEqual(parseLizardCsv('\n\n  \n'), []);
});

test('parseLizardCsv handles CRLF output', () => {
  // lizard emits CRLF on Windows; a parser splitting on "\n" alone leaves the
  // stray "\r" inside the last numeric cell and Number() becomes NaN.
  const text = `${REAL_ROW}\r\n${REAL_ROW}\r\n`;
  assert.equal(parseLizardCsv(text).length, 2);
});

test('splitCsvLine honours quoted cells', () => {
  assert.deepEqual(splitCsvLine('1,2,3'), ['1', '2', '3']);
  assert.deepEqual(splitCsvLine('1,"a,b",c'), ['1', 'a,b', 'c']);
  assert.deepEqual(splitCsvLine('"a",b'), ['a', 'b']);
  assert.deepEqual(splitCsvLine('a,"b"'), ['a', 'b']);
  assert.deepEqual(splitCsvLine('""'), ['']);
});

test('splitCsvLine treats a doubled quote as one literal quote', () => {
  assert.deepEqual(splitCsvLine('"a""b"'), ['a"b']);
  assert.deepEqual(splitCsvLine('"a","b"'), ['a', 'b']);
});

test('ccnViolations blocks strictly above the threshold', () => {
  // Gate 3 blocks above 5, so exactly 5 must pass. An off-by-one here would
  // either block every helper at the limit or let the reference case through.
  const rows = [{ ccn: 4 }, { ccn: 5 }, { ccn: 6 }];
  assert.deepEqual(ccnViolations(rows, 5).map((r) => r.ccn), [6]);
});

test('ccnViolations returns everything above a zero threshold', () => {
  const rows = [{ ccn: 1 }, { ccn: 2 }];
  assert.equal(ccnViolations(rows, 0).length, 2);
});
