import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFailCount } from '../scripts/lib/testreport.mjs';

// Node switches reporter based on whether stdout is a TTY, so this parse sees
// two different spellings of the same summary. Matching only one of them is how
// the mutation gate reported "the runner failed" on every CI run while passing
// locally -- the counts were there, under a different name.

test('parseFailCount reads the spec reporter used on a terminal', () => {
  const out = 'ℹ tests 92\nℹ pass 92\nℹ fail 0\n';
  assert.equal(parseFailCount(out), 0);
});

test('parseFailCount reads the TAP reporter used when piped', () => {
  // This is the exact shape CI produced.
  const out = '# tests 92\n# pass 92\n# fail 0\n';
  assert.equal(parseFailCount(out), 0);
});

test('parseFailCount reports a non-zero failure count in both formats', () => {
  assert.equal(parseFailCount('ℹ fail 3\n'), 3);
  assert.equal(parseFailCount('# fail 3\n'), 3);
});

test('parseFailCount returns -1 when there is no count at all', () => {
  // -1 must be distinct from 0: "the runner produced nothing readable" and
  // "nothing failed" are opposite conclusions about the same mutation.
  assert.equal(parseFailCount(''), -1);
  assert.equal(parseFailCount('Could not find tests/*.test.mjs'), -1);
  assert.equal(parseFailCount('ℹ pass 92\n'), -1);
});

test('parseFailCount does not mistake the pass line for the fail line', () => {
  // A greedy or loose pattern would read "pass 92" as a failure count and turn
  // every mutation into a false kill.
  assert.equal(parseFailCount('ℹ pass 92\nℹ fail 0\n'), 0);
  assert.equal(parseFailCount('# pass 92\n# fail 1\n'), 1);
});
