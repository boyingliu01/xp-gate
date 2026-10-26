/**
 * @test REQ-618 `check --all` must not count a gate that ran NOTHING as passed
 * @intent Three gates the CLI advertises as runnable analysed nothing and were
 *         counted as passes. Measured on xp-gate 0.31.3:
 *
 *             Gate python-health: TypeScript module not found and no bash fallback available.
 *             Gate test-layers:   TypeScript module not found and no bash fallback available.
 *             Gate pbt:           TypeScript module not found and no bash fallback available.
 *
 *             [xp-gate check --all] 8 passed / 2 failed / 5 skipped / 15 total
 *
 *         None of the three analysed anything, and all three were inside the
 *         `8 passed`. The root cause was `runTsGate()`'s no-entry branch: it
 *         printed a message and then fell through to `return 0`, which is
 *         indistinguishable from "ran and found nothing". #568 taught the
 *         summary to separate `preCommitOnly` skips from passes; this is the
 *         same distinction one level down -- a gate that could not run is a
 *         skip, not a pass.
 *
 *         The second defect on the same path: the bash-fallback branch called
 *         `runGateAdapter(...)` and DISCARDED its verdict, so a fallback that
 *         failed still reported 0.
 * @covers AC-618-01, AC-618-02, AC-618-03
 */
const gateRunner = require('../gate-runner.js');
const { checkAllGates } = require('../check.js');

const { GATE_REGISTRY, GATE_NOT_RUN } = gateRunner;

/** Original registry contents, restored after every test. */
let ORIGINAL_REGISTRY;

const SENTINEL_GATE_ID = '618-sentinel';
const PASS_GATE_ID = '618-pass';
const FAIL_GATE_ID = '618-fail';

beforeEach(() => {
  ORIGINAL_REGISTRY = { ...GATE_REGISTRY };
  for (const k of Object.keys(GATE_REGISTRY)) delete GATE_REGISTRY[k];
});

afterEach(() => {
  for (const k of Object.keys(GATE_REGISTRY)) delete GATE_REGISTRY[k];
  Object.assign(GATE_REGISTRY, ORIGINAL_REGISTRY);
});

function installGates() {
  GATE_REGISTRY[SENTINEL_GATE_ID] = {
    name: 'ran nothing',
    description: 'no module, no fallback',
    aliases: [],
    run: () => GATE_NOT_RUN,
  };
  GATE_REGISTRY[PASS_GATE_ID] = {
    name: 'ran and passed',
    description: 'ordinary passing gate',
    aliases: [],
    run: () => 0,
  };
  GATE_REGISTRY[FAIL_GATE_ID] = {
    name: 'ran and failed',
    description: 'ordinary failing gate',
    aliases: [],
    run: () => 1,
  };
}

test('AC-618-01: the sentinel is distinct from every exit code', () => {
  // It must not be a number: 0 means "ran, found nothing" and 1 means "failed".
  expect(typeof GATE_NOT_RUN).not.toBe('number');
  expect(GATE_NOT_RUN).not.toBe(0);
  expect(GATE_NOT_RUN).not.toBe(1);
});

test('AC-618-02: a gate that ran nothing is counted as skipped, not passed', async () => {
  installGates();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await checkAllGates('.');
    const printed = log.mock.calls.map(c => String(c[0])).join('\n');
    // 3 gates total: one skipped (ran nothing), one passed, one failed.
    expect(printed).toMatch(/1 passed \/ 1 failed \/ 1 skipped \/ 3 total/);
  } finally {
    log.mockRestore();
  }
});

test('AC-618-03: runGate propagates the sentinel instead of flattening it to 0', async () => {
  installGates();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    // The sentinel must survive runGate(), otherwise check.js cannot see it.
    expect(await gateRunner.runGate(SENTINEL_GATE_ID, '.')).toBe(GATE_NOT_RUN);
    // And the ordinary verdicts must be untouched by the change.
    expect(await gateRunner.runGate(PASS_GATE_ID, '.')).toBe(0);
    expect(await gateRunner.runGate(FAIL_GATE_ID, '.')).toBe(1);
  } finally {
    log.mockRestore();
  }
});
