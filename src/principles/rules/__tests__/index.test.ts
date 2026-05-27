import { describe, it, expect } from 'vitest';
import * as rulesIndex from '../index';

/**
 * @test REQ-COV-002 Coverage: src/principles/rules/index.ts
 * @intent Verify all 15 rule re-exports are accessible
 * @covers AC-COV-002
 */
describe('principles/rules/index', () => {
  const expectedCleanCodeRules = [
    'longFunctionRule',
    'largeFileRule',
    'magicNumbersRule',
    'godClassRule',
    'deepNestingRule',
    'tooManyParamsRule',
    'missingErrorHandlingRule',
    'unusedImportsRule',
    'codeDuplicationRule',
    'manyExportsRule',
  ];

  const expectedSolidRules = ['srpRule', 'ocpRule', 'lspRule', 'ispRule', 'dipRule'];

  it('exports all 10 clean-code rules', () => {
    for (const name of expectedCleanCodeRules) {
      expect(rulesIndex).toHaveProperty(name);
      expect(typeof (rulesIndex as Record<string, unknown>)[name]).toBe('object');
    }
  });

  it('exports all 5 SOLID rules', () => {
    for (const name of expectedSolidRules) {
      expect(rulesIndex).toHaveProperty(name);
      expect(typeof (rulesIndex as Record<string, unknown>)[name]).toBe('object');
    }
  });

  it('each exported rule has an id and check function', () => {
    const allRules = [...expectedCleanCodeRules, ...expectedSolidRules];
    for (const name of allRules) {
      const rule = (rulesIndex as Record<string, { id?: string; check?: unknown }>)[name];
      expect(rule.id).toBeDefined();
      expect(typeof rule.id).toBe('string');
      expect(rule.check).toBeDefined();
      expect(typeof rule.check).toBe('function');
    }
  });
});
