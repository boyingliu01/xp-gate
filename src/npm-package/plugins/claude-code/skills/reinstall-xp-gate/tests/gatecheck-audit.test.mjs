import test from 'node:test';
import assert from 'node:assert/strict';

import { CASES, summarize } from '../scripts/lib/gatecheck.mjs';

// The audit is only useful if its own bookkeeping is right. These tests pin the
// three outcomes a case can have WITHOUT running a gate, because the expensive
// part (spawning git + xp-gate) is covered by `node scripts/audit.mjs --gates`.
// The bug this guards against was measured: Gate 2's CONTROL tree blocked (jscpd
// missing), the old summary counted that as a gate failure, and the report read
// as "the gates are broken" when the truth was "a tool is missing".

const ok = (id) => ({
  id, name: `g${id}`, cleanVerdict: 'passed', dirtyVerdict: 'blocked', knownGap: false, ok: true, measurementValid: true,
});
const failed = (id) => ({
  id, name: `g${id}`, cleanVerdict: 'passed', dirtyVerdict: 'passed', knownGap: false, ok: false, measurementValid: true,
});
const unmeasurable = (id) => ({
  id, name: `g${id}`, cleanVerdict: 'blocked', dirtyVerdict: 'blocked', knownGap: false, ok: false, measurementValid: false,
});
const gap = (id) => ({
  id, name: `g${id}`, cleanVerdict: 'passed', dirtyVerdict: 'unknown', knownGap: true, ok: false, measurementValid: true,
});

test('summarize passes when every measurable case separated clean from dirty', () => {
  const s = summarize([ok(8), ok(3)]);
  assert.equal(s.pass, true);
  assert.equal(s.ok, 2);
  assert.equal(s.failed, 0);
});

test('summarize fails when a gate passed a tree with a known defect in it', () => {
  const s = summarize([ok(8), failed(3)]);
  assert.equal(s.pass, false);
  assert.equal(s.failed, 1);
});

test('summarize reports a blocking control as invalid, not as a gate failure', () => {
  // This is the measured upstream state: jscpd absent, so the clean tree blocked
  // too. It must not be counted as "the gate is broken".
  const s = summarize([ok(8), unmeasurable(2)]);
  assert.equal(s.invalid, 1);
  assert.equal(s.failed, 0, 'an unmeasurable case is not a gate failure');
  assert.equal(s.pass, false, 'but the audit cannot claim a pass either');
});

test('summarize excludes known gaps from both counters', () => {
  const s = summarize([ok(8), gap(12)]);
  assert.equal(s.knownGaps, 1);
  assert.equal(s.failed, 0);
  assert.equal(s.pass, true, 'a documented upstream gap must not turn the audit permanently red');
});

test('summarize passes only when every case was measured', () => {
  assert.equal(summarize([ok(1)]).pass, true);
  assert.equal(summarize([]).pass, true);
});

test('every declared case states an explicit expected verdict', () => {
  // A case without `expect` would compare against undefined and silently never
  // be satisfiable, so it must be impossible to add one.
  for (const c of CASES) {
    assert.ok(['blocked', 'detected'].includes(c.expect), `${c.id} has an unsupported expectation: ${c.expect}`);
    assert.equal(typeof c.plant, 'function', `${c.id} must plant a defect`);
    assert.ok(c.name.length > 0, `${c.id} needs a name`);
  }
});

test('Gate 2 is expected to block, because 0.38.75 added a threshold', () => {
  // Pinned because the expectation silently rotted once already: until 0.38.74
  // jscpd was invoked without --threshold and returns 0 no matter how much it
  // finds, so Gate 2 could only ever 'detect'. When the audit kept expecting
  // 'detected' after the gate started failing, a working gate was reported as
  // FAILED -- the audit cried wolf on its own improvement.
  const gate2 = CASES.find((c) => c.id === 2);
  assert.equal(gate2.expect, 'blocked');
});

test('the gate ids under test are unique', () => {
  const ids = CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------------------
// Execution paths (TODO-2).
//
// The bookkeeping above was covered; what was not is the code that actually
// runs: tmpRepo/stageAll build the fixture, gateRun invokes the real CLI, and
// runCase/measure/erroredCase/evaluateCase turn two verdicts into a finding.
// These are exercised with a gate id that no fixture can satisfy, so the
// spawn path is real while the assertions stay about this module's bookkeeping.
// ---------------------------------------------------------------------------

import os from 'node:os';
import fs from 'node:fs';

import { runCase, auditGates } from '../scripts/lib/gatecheck.mjs';

/** A case whose plant() writes a marker file and whose id cannot match a gate. */
function probeCase(overrides = {}) {
  return {
    id: 404,
    name: 'probe case',
    plant: (dir) => fs.writeFileSync(`${dir}/planted.txt`, 'x'),
    expect: 'blocked',
    ...overrides,
  };
}

test('runCase returns a well-formed result even when the gate id does not exist', () => {
  // This is the path that must never throw: a case that throws mid-flight has
  // already created two temp repos, and the finally-block cleanup is the only
  // thing keeping them from piling up in /tmp.
  const r = runCase(probeCase());
  assert.equal(r.id, 404);
  assert.equal(typeof r.dirtyVerdict, 'string');
  assert.equal(r.error, undefined, `runCase must not leak an error: ${r.error}`);
});

test('runCase leaves no temporary repo behind', () => {
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('xgr-gate-')).length;
  runCase(probeCase());
  const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('xgr-gate-')).length;
  assert.equal(after, before, 'every fixture repo must be removed, including on the dirty run');
});

test('runCase records a throwing plant() as unmeasurable instead of propagating', () => {
  // A broken case must degrade to "could not measure", never crash the audit.
  const r = runCase(probeCase({ plant: () => { throw new Error('plant exploded'); } }));
  assert.equal(r.measurementValid, false);
  assert.equal(r.ok, false);
  assert.equal(r.dirtyVerdict, 'unknown');
  assert.match(r.error, /plant exploded/);
});

test('runCase carries knownGap through to the result', () => {
  // summarize() filters on this field, so losing it here would silently turn a
  // documented upstream gap into a permanent audit failure.
  const r = runCase(probeCase({ plant: () => {} , knownGap: true }));
  assert.equal(r.knownGap, true);
});

test('runCase without a control reports the clean side as skipped, not as unknown', () => {
  // control:false means "do not run the clean tree". Reporting 'unknown' would
  // read as "we ran it and could not parse it", which is a different claim.
  const r = runCase(probeCase({ plant: () => {} }), { control: false });
  assert.equal(r.cleanVerdict, 'skipped');
  assert.equal(r.measurementValid, true, 'with no control there is nothing that can invalidate the measurement');
});

test('auditGates runs every supplied case and summarises the results', async () => {
  const { cases, summary } = await auditGates({ cases: [probeCase(), probeCase({ id: 405 })] });
  assert.equal(cases.length, 2);
  assert.equal(summary.total, 2);
  assert.deepEqual(cases.map((c) => c.id), [404, 405]);
});
