/**
 * @test REQ-TIMING-001
 * @intent A gate's reported cost must reflect what it costs WHEN IT RUNS, not the
 *         average of "ran" and "skipped". The combined table reports one median per
 *         gate, and when a gate skips most commits that median describes the SKIP
 *         path. Measured 2026-11-22: gate-3 showed a 0.9 s median and a 46.7 s p90,
 *         so the combined row said "cheap" about a gate that spent 25-51 s on every
 *         source-touching commit. The number was not wrong; it answered a different
 *         question than the one being asked.
 * @covers summariseByStatus in scripts/gate-timing-report.cjs
 *
 * The falsification that matters: build a gate whose SKIP samples are FAST and whose
 * PASS samples are SLOW, and assert the split reports both. An implementation that
 * merely re-summarised everything (ignoring gate_status) would report a single row
 * here and fail, which is exactly the defect this pins.
 */
const { summarise, summariseByStatus } = require('../gate-timing-report.cjs');

function rec(gate, status, ms) {
  return { gate_id: gate, gate_name: gate, gate_status: status, duration_ms: ms };
}

describe('gate timing: verdict split', () => {
  it('separates a gate that is cheap when skipping and expensive when running', () => {
    // Deliberately the shape measured on gate-3: 18 cheap SKIPs, 15 expensive PASSes.
    const records = [
      ...Array.from({ length: 18 }, () => rec('gate-3', 'SKIP', 700)),
      ...Array.from({ length: 15 }, () => rec('gate-3', 'PASS', 58400)),
    ];

    // The combined view is the trap: one number that describes neither path.
    const combined = summarise(records);
    expect(combined).toHaveLength(1);
    expect(combined[0].median).toBe(700);

    const split = summariseByStatus(records);
    expect(split).toHaveLength(2);

    const pass = split.find((r) => r.status === 'PASS');
    const skip = split.find((r) => r.status === 'SKIP');
    expect(pass.samples).toBe(15);
    expect(pass.median).toBe(58400);
    expect(skip.samples).toBe(18);
    expect(skip.median).toBe(700);
  });

  it('produces one row per verdict, not one row per gate', () => {
    const records = [
      rec('gate-12', 'WARN', 12000),
      rec('gate-12', 'PASS', 3400),
      rec('gate-12', 'SKIP', 400),
    ];
    const split = summariseByStatus(records);
    expect(split.map((r) => r.status).sort()).toEqual(['PASS', 'SKIP', 'WARN']);
    // Every row keeps its own sample count; nothing is merged across verdicts.
    expect(split.every((r) => r.samples === 1)).toBe(true);
  });

  it('keeps a single-verdict gate as a single row rather than inventing one', () => {
    const split = summariseByStatus([rec('gate-9', 'PASS', 5000), rec('gate-9', 'PASS', 6000)]);
    expect(split).toHaveLength(1);
    expect(split[0].samples).toBe(2);
    expect(split[0].status).toBe('PASS');
  });

  it('ignores records with no duration instead of counting them as instant', () => {
    // "Not measured" must not look like "fast" -- the same rule the gates follow.
    const split = summariseByStatus([
      rec('gate-2', 'SKIP', 5000),
      { gate_id: 'gate-2', gate_status: 'SKIP' },
      { gate_id: 'gate-2', gate_status: 'SKIP', duration_ms: null },
    ]);
    expect(split).toHaveLength(1);
    expect(split[0].samples).toBe(1);
    expect(split[0].median).toBe(5000);
  });
});
