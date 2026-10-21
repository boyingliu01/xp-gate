/**
 * @test REQ-563 runGate must not discard a synchronous gate verdict
 * @intent `runGate()` reports "passed" for every gate whose `run()` returns a
 *         number instead of a Promise. Four registry entries — gates 3, 7, 8
 *         and 9 — reach `runTsGate()`, which returns `result.status` as a plain
 *         number, and the runner's own code path was:
 *
 *             const result = gate.run(targetPath);
 *             if (result && typeof result.then === 'function') return await result;
 *             return 0;                      // <-- the number is dropped here
 *
 *         So a gate that exits 1 in its child process is reported as 0 by
 *         `xp-gate check`. `checkAllGates()` counts `code !== 0` as a failure, so
 *         it faithfully counts whatever `runGate` hands back — which is always
 *         0 for those four gates. The fail-open is in exactly one place and it
 *         is silent: nothing in the output says the verdict was manufactured.
 *
 *         Gates 4 and 6 escaped this by returning `Promise.resolve(...)`, and
 *         gate 2 escaped it because `execFileSync` throws on a non-zero exit and
 *         the `catch` converts that to 1. Both of those are accidents of how
 *         each handler was written, not a contract — which is why the fix has to
 *         be in the runner, not in each handler.
 * @covers AC-563-01, AC-563-02, AC-563-03
 */
const gateRunner = require('../gate-runner.js');
const { runGate, GATE_REGISTRY } = gateRunner;

const STUB_GATE_ID = '__stub_gate__';

/**
 * Install a throwaway registry entry and return a cleanup function.
 * @param {object} handler - the `run` implementation to install
 * @returns {Function} cleanup
 */
function withStubGate(handler) {
  GATE_REGISTRY[STUB_GATE_ID] = {
    name: 'Stub Gate',
    description: 'test double',
    aliases: [],
    run: handler,
  };
  return () => {
    delete GATE_REGISTRY[STUB_GATE_ID];
  };
}

let cleanup = null;

beforeEach(() => {
  // Keep the console quiet: runGate prints a banner for every invocation.
  if (!global.__xpGateStubLog) {
    global.__xpGateStubLog = console.log;
  }
  console.log = () => {};
});

afterEach(() => {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  console.log = global.__xpGateStubLog;
});

describe('runGate verdict propagation', () => {
  test('AC-563-01: a synchronous non-zero verdict is returned, not swallowed', async () => {
    // This is the exact shape `runTsGate` has: a plain number, no Promise.
    cleanup = withStubGate(() => 1);

    const code = await runGate(STUB_GATE_ID, '.');

    expect(
      code,
      'runGate returned a manufactured 0 for a gate whose synchronous handler ' +
        'said 1 — the caller (checkAllGates) cannot distinguish pass from fail'
    ).toBe(1);
  });

  test('AC-563-02: a synchronous zero verdict still reads as pass', async () => {
    // The guard against "fix it by always failing": a genuine 0 must stay 0.
    cleanup = withStubGate(() => 0);

    const code = await runGate(STUB_GATE_ID, '.');

    expect(code).toBe(0);
  });

  test('AC-563-03: async and throwing handlers keep their existing verdicts', async () => {
    // Promise-returning handlers already worked; the fix must not regress them.
    cleanup = withStubGate(() => Promise.resolve(2));
    expect(await runGate(STUB_GATE_ID, '.')).toBe(2);
    cleanup();

    cleanup = withStubGate(() => {
      throw new Error('boom');
    });
    expect(await runGate(STUB_GATE_ID, '.')).toBe(1);
    cleanup();

    // An async handler that REJECTS must also fail closed, not propagate an
    // unhandled rejection out of runGate.
    cleanup = withStubGate(() => Promise.reject(new Error('async boom')));
    expect(await runGate(STUB_GATE_ID, '.')).toBe(1);
  });
});
