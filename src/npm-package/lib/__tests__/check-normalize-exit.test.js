/**
 * @test check-normalize-exit
 * @intent Prove the CLI never hands a non-numeric verdict to process.exit (the #657 crash) and that ONLY the GATE_NOT_RUN sentinel is coerced to 0
 * @covers AC-DSH-019
 */
const { normalizeGateExit } = require('../check.js');

describe('normalizeGateExit (#657)', () => {
  it('coerces the GATE_NOT_RUN string sentinel to 0 (honest skip, not a crash)', () => {
    expect(normalizeGateExit('NOT_RUN')).toBe(0);
  });

  it('passes real numeric verdicts through unchanged', () => {
    expect(normalizeGateExit(0)).toBe(0);
    expect(normalizeGateExit(1)).toBe(1);
    expect(normalizeGateExit(2)).toBe(2);
  });

  it('never returns a non-number for any input', () => {
    for (const v of ['NOT_RUN', 0, 1, undefined, null]) {
      expect(typeof normalizeGateExit(v)).toBe('number');
    }
  });
});
