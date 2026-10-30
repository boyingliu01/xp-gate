/**
 * @test check-changed-brief
 * @intent Prove `xp-gate check --changed --brief` scopes to the current diff, prints one honest verdict per gate, and never reports a gate as PASS when it did not run
 * @covers AC-DSH-019
 */
const { fileExtension, printBriefSummary } = require('../check.js');

describe('check --changed --brief helpers', () => {
  describe('fileExtension', () => {
    it('returns the lowercased extension without the dot', () => {
      expect(fileExtension('src/a/B.TS')).toBe('ts');
      expect(fileExtension('x/y/z.mjs')).toBe('mjs');
    });

    it('returns empty string for a path without an extension', () => {
      expect(fileExtension('Makefile')).toBe('');
      expect(fileExtension('docs/README')).toBe('');
    });
  });

  describe('printBriefSummary', () => {
    function capture(fn) {
      const lines = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
      const ret = fn();
      spy.mockRestore();
      return { out: lines.join('\n'), ret };
    }

    it('reports one PASS line per passing gate and returns 0 failures', () => {
      const { out, ret } = capture(() =>
        printBriefSummary(['a.ts'], ['a.ts'], [{ id: '3', code: 0 }, { id: '4', code: 0 }], 12),
      );
      expect(out).toMatch(/Gate 3 Complexity\s+PASS/);
      expect(out).toMatch(/Gate 4 Principles\s+PASS/);
      expect(out).toMatch(/✅ clear/);
      expect(ret).toBe(0);
    });

    it('reports BLOCK and counts failures when a gate fails', () => {
      const { out, ret } = capture(() =>
        printBriefSummary(['a.ts'], ['a.ts'], [{ id: '3', code: 0 }, { id: '4', code: 1 }], 12),
      );
      expect(out).toMatch(/Gate 4 Principles\s+BLOCK/);
      expect(out).toMatch(/❌ 1 blocking/);
      expect(ret).toBe(1);
    });

    it('never prints PASS for a gate that did not run (NOT_RUN -> SKIP)', () => {
      const { out, ret } = capture(() =>
        printBriefSummary(['a.ts'], ['a.ts'], [{ id: '3', code: 'NOT_RUN' }], 5),
      );
      expect(out).toMatch(/Gate 3 Complexity\s+SKIP/);
      expect(out).not.toMatch(/Gate 3 Complexity\s+PASS/);
      expect(ret).toBe(0);
    });

    it('states docs/config-only diffs apply no blocking source gate', () => {
      const { out } = capture(() => printBriefSummary(['README.md'], [], [], 3));
      expect(out).toMatch(/No source files changed/);
    });
  });
});
