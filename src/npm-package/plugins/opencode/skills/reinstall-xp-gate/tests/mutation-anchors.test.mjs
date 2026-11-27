import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MUTATIONS } from '../scripts/lib/mutations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every mutation must still point at code that exists.
 *
 * MEASURED: refactoring `util.mjs` into `fs-tree.mjs`, and moving `cmpVersion`
 * to `version.mjs`, left eight mutations whose anchor text was no longer in the
 * file they named. The mutator printed "[skip] anchor not found" for each, then
 * reported "every mutated defect was caught" and exited 0 -- so a refactor could
 * delete eight of nineteen property checks and make the gate look healthier
 * than it did before. A skipped mutation is an unverified property, not a pass.
 *
 * The table lives in its own module precisely so this test can read it: the
 * mutator has top-level side effects and cannot be imported.
 */

test('the mutation table is non-empty, or this test proves nothing', () => {
  assert.ok(MUTATIONS.length >= 19, `table shrank to ${MUTATIONS.length} entries`);
});

test('every mutation anchor is present in the file it names', () => {
  const missing = [];
  for (const m of MUTATIONS) {
    const abs = path.join(root, m.file);
    if (!fs.existsSync(abs)) {
      missing.push(`${m.name}: file gone (${m.file})`);
      continue;
    }
    if (!fs.readFileSync(abs, 'utf8').includes(m.from)) {
      missing.push(`${m.name}: anchor not found in ${m.file}`);
    }
  }
  assert.deepEqual(missing, [], `stale mutations:\n  ${missing.join('\n  ')}`);
});

test('every mutation replaces its anchor with something different', () => {
  // A `to` identical to `from` would apply cleanly and change nothing, which
  // reads as a SURVIVED mutation and slanders the tests.
  const noops = MUTATIONS.filter((m) => m.from === m.to).map((m) => m.name);
  assert.deepEqual(noops, [], 'these mutations are no-ops');
});
