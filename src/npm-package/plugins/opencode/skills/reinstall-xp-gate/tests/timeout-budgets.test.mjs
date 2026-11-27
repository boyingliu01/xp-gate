import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { XP_GATE_SLOW_OP_TIMEOUT_MS } from '../scripts/lib/proc.mjs';

// ---------------------------------------------------------------------------
// Timeout budgets must be named, and named by intent.
//
// reinstall.mjs and verify.mjs cannot be imported (they run top-level side
// effects), so their budgets are pinned at the source level. A source-level
// assertion is coarse, but it is the only guard that exists for a file no test
// can load: without it a refactor could retune a 5-minute uninstall to 5 seconds
// and nothing would notice until a real reinstall truncated halfway.
// ---------------------------------------------------------------------------

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('XP_GATE_SLOW_OP_TIMEOUT_MS is a five-minute budget for xp-gate mutations', () => {
  // uninstall --purge, npm uninstall -g, update-hooks and doctor all shell out to
  // xp-gate and share one budget: they are the same kind of slow operation.
  assert.equal(XP_GATE_SLOW_OP_TIMEOUT_MS, 300000);
});

test('reinstall.mjs has no bare 300000 left', () => {
  assert.deepEqual(read('scripts/reinstall.mjs').match(/timeout: 300000\b/g) || [], []);
});

test('verify.mjs has no bare 300000 left', () => {
  assert.deepEqual(read('scripts/verify.mjs').match(/timeout: 300000\b/g) || [], []);
});

test('reinstall.mjs does not silently drop the shared budget for its own 600000', () => {
  // The verify subprocess is a different tier (a full re-verification), so it
  // keeps its own number -- but it must not be a bare literal either.
  const src = read('scripts/reinstall.mjs');
  assert.deepEqual(src.match(/timeout: 600000\b/g) || [], [], 'name it rather than inlining 600000');
});
