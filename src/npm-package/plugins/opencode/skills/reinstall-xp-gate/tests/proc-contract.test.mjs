import test from 'node:test';
import assert from 'node:assert/strict';

import * as proc from '../scripts/lib/proc.mjs';

// ---------------------------------------------------------------------------
// proc.mjs is the module every other script imports from, so splitting it up
// must not move a single name off its public surface. These assertions pin the
// contract; the modules behind it are free to reorganise.
//
// Gate 4 flagged proc.mjs for "too many exports: 20 (maximum: 10)". The count
// is a symptom of one module owning three jobs: starting child processes,
// locating the xp-gate launcher, and abstracting the platform. Splitting by
// those jobs is the fix; changing the import sites is not, because they are
// correct -- the surface they see is one cohesive "process utilities" API.
// ---------------------------------------------------------------------------

const EXPECTED = [
  'HOME',
  'PROBE_TIMEOUT_MS',
  'XP_GATE_SLOW_OP_TIMEOUT_MS',
  'effectivePath',
  'envWithPath',
  'firstExisting',
  'gitConfig',
  'isWindowsShim',
  'npmCli',
  'packageDir',
  'parseWhichOutput',
  'probe',
  'resetPackageDir',
  'run',
  'runNpm',
  'toolVersion',
  'which',
  'withPlatform',
  'xp',
  'xpJson',
];

test('proc.mjs still exports exactly the documented surface', () => {
  assert.deepEqual(Object.keys(proc).sort(), [...EXPECTED].sort());
});

test('every exported name is the right kind', () => {
  for (const name of EXPECTED) {
    assert.notEqual(proc[name], undefined, `${name} must not be undefined`);
  }
  assert.equal(typeof proc.HOME, 'string');
  for (const fn of EXPECTED.filter((n) => !n.endsWith('_MS') && n !== 'HOME')) {
    assert.equal(typeof proc[fn], 'function', `${fn} must stay callable`);
  }
});

test('the timeout budgets keep their values through the split', () => {
  assert.equal(proc.PROBE_TIMEOUT_MS, 10000);
  assert.equal(proc.XP_GATE_SLOW_OP_TIMEOUT_MS, 300000);
});
