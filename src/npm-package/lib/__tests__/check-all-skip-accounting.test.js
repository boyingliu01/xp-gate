/**
 * @test REQ-568 `check --all` must not count a gate it never ran as passed
 * @intent Gate 5's own output already distinguishes four states — PASS, WARN,
 *         SKIP and FAIL — and `xp-gate check --all` collapses them into two:
 *         `code !== 0` is a failure, everything else is a pass. A gate whose
 *         registry entry is `preCommitOnly` prints
 *
 *             ⏭️  SKIPPED - <reason>
 *             return 0;
 *
 *         and that 0 is counted as a pass, so 15 registered gates report as
 *         `10/10 gate(s) passed` with exit 0. Measured on the registry:
 *
 *             total gates      : 15
 *             preCommitOnly    : 5   (ids 0, 1, 5, 10, 11)
 *             check --all runs : 10
 *
 *         The user-visible number is therefore true about the ten gates that
 *         ran and silent about the five that did not. `verdict: PARTIAL` in the
 *         hook's own report exists for the same reason; the CLI had no such
 *         notion. This is report §5 phase-0 action 0.2.
 * @covers AC-568-01, AC-568-02, AC-568-03
 */
const gateRunner = require('../gate-runner.js');
const { checkAllGates, formatGateTally } = require('../check.js');

const { GATE_REGISTRY } = gateRunner;

/** Original registry contents, restored after every test. */
let ORIGINAL_REGISTRY;

// Gate ids the CLI's `check --all` path should never treat as "passed" without
// saying so. The five real preCommitOnly ids from the shipped registry.
const PRECOMMIT_ONLY = ['0', '1', '5', '10', '11'];

/**
 * Swap every key in GATE_REGISTRY for the supplied object's keys.
 * @param {object} next - registry contents to install
 */
function replaceRegistry(next) {
  for (const id of Object.keys(GATE_REGISTRY)) delete GATE_REGISTRY[id];
  for (const [id, info] of Object.entries(next)) GATE_REGISTRY[id] = info;
}

/**
 * Replace the registry with a controlled set of stub gates.
 *
 * The registry is swapped WHOLESALE, not added to: `getAllGates()` maps every
 * entry, so leaving the real fifteen in place would run them too — they spawn
 * processes and take minutes — and the tally would be about the shipped
 * registry rather than the fixture. Measured: the first draft of this test ran
 * the real gates and reported "8 passed / 2 failed / 5 skipped / 15 total".
 *
 * @param {Array<{id: string, preCommitOnly?: boolean, code?: number}>} specs
 * @returns {Function} cleanup that restores the original registry
 */
function installGates(specs) {
  const stubs = {};
  for (const spec of specs) {
    stubs[spec.id] = spec.preCommitOnly
      ? {
          name: `Stub ${spec.id}`,
          description: 'test double',
          aliases: [],
          preCommitOnly: true,
          reason: 'runs during commit',
        }
      : {
          name: `Stub ${spec.id}`,
          description: 'test double',
          aliases: [],
          run: () => (typeof spec.code === 'number' ? spec.code : 0),
        };
  }
  replaceRegistry(stubs);
  return () => replaceRegistry(ORIGINAL_REGISTRY);
}

let cleanup = null;
let logSpy;

beforeAll(() => {
  ORIGINAL_REGISTRY = { ...GATE_REGISTRY };
});

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  vi.restoreAllMocks();
});

/**
 * Read everything the CLI printed during the run.
 * @returns {string} joined output
 */
function printed() {
  return logSpy.mock.calls.map(args => args.join(' ')).join('\n');
}

describe('check --all skip accounting', () => {
  test('AC-568-01: a preCommitOnly gate is reported as skipped, not passed', async () => {
    cleanup = installGates([
      ...PRECOMMIT_ONLY.map(id => ({ id, preCommitOnly: true })),
      { id: '2', code: 0 },
      { id: '3', code: 0 },
    ]);

    const code = await checkAllGates('.');

    const out = printed();
    // The summary must name the skips and must not claim a bare N/N.
    expect(out, 'the tally must distinguish skipped from passed').toMatch(/skipped/i);
    expect(out).toMatch(/2 passed/);
    expect(out).toMatch(/5 skipped/);
    // A clean run with skips still exits 0 — skips are not failures.
    expect(code).toBe(0);
  });

  test('AC-568-02: skipped gates never inflate the passed count', async () => {
    // The defect in one assertion: before the fix this printed "2/2 gate(s)
    // passed" for a run where zero gates were actually executed.
    cleanup = installGates([...PRECOMMIT_ONLY.map(id => ({ id, preCommitOnly: true }))]);

    await checkAllGates('.');

    const out = printed();
    expect(out).not.toMatch(/5\/5/);
    expect(out).toMatch(/0 passed/);
    expect(out).toMatch(/5 skipped/);
  });

  test('AC-568-03: a real failure still fails the run and is counted apart from skips', async () => {
    // Anti-vacuity: the tally must not have been made honest by making it
    // never fail. One failing gate among skips and passes fails the run.
    cleanup = installGates([
      { id: '0', preCommitOnly: true },
      { id: '1', preCommitOnly: true },
      { id: '2', code: 0 },
      { id: '3', code: 1 },
    ]);

    const code = await checkAllGates('.');

    const out = printed();
    expect(code, 'a failing gate must still exit non-zero').toBe(1);
    expect(out).toMatch(/1 passed/);
    expect(out).toMatch(/1 failed/);
    expect(out).toMatch(/2 skipped/);
  });

  test('AC-568-04: formatGateTally renders all four states without loss', () => {
    // The pure formatter, exercised directly so the wording contract is pinned
    // independently of the gate loop.
    expect(formatGateTally({ passed: 3, skipped: 4, failed: 0, warned: 0, total: 7 })).toBe(
      '3 passed / 4 skipped / 7 total'
    );
    expect(formatGateTally({ passed: 2, skipped: 1, failed: 1, warned: 0, total: 4 })).toBe(
      '2 passed / 1 failed / 1 skipped / 4 total'
    );
    expect(formatGateTally({ passed: 1, skipped: 0, failed: 0, warned: 2, total: 3 })).toBe(
      '1 passed / 2 warned / 3 total'
    );
  });
});
