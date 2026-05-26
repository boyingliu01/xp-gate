import { describe, it, expect } from 'vitest';
import { loadRules } from '../index';

/**
 * @test REQ-COV-001 Coverage: src/rules/index.ts
 * @intent Verify loadRules returns empty array placeholder
 * @covers AC-COV-001
 */
describe('rules/index', () => {
  it('loadRules returns an array', async () => {
    const rules = await loadRules({ rules: {} });
    expect(Array.isArray(rules)).toBe(true);
  });

  it('loadRules returns an empty array for empty config', async () => {
    const rules = await loadRules({ rules: {} });
    expect(rules).toEqual([]);
  });

  it('loadRules ignores config contents (placeholder impl)', async () => {
    const rules = await loadRules({
      rules: { 'clean-code': { 'long-function': { enabled: true, threshold: 50 } } },
    });
    expect(rules).toEqual([]);
  });
});
