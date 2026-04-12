/**
 * @test types.ts - Core type definitions
 * @intent Verify Rule and Violation interfaces match design spec
 * @covers clean-code-solid-checker-design Section 6-7
 */

import { describe, it, expect } from 'vitest';

// These imports will fail until implementation exists - that's the RED phase!
import type { Rule, Violation, Severity, Adapter } from '../types';

describe('types.ts - Core Interfaces', () => {
  describe('Rule interface', () => {
    it('should have required fields: id, name, threshold, severity, check', () => {
      // This test will fail until types.ts exists
      const rule: Rule = {
        id: 'clean-code.long-function',
        name: 'Long Function',
        threshold: 50,
        severity: 'warning',
        check: () => [],
      };

      expect(rule.id).toBeDefined();
      expect(rule.name).toBeDefined();
      expect(rule.threshold).toBeDefined();
      expect(rule.severity).toBeDefined();
      expect(rule.check).toBeDefined();
    });

    it('should support all severity levels', () => {
      const severities: Severity[] = ['error', 'warning', 'info'];
      
      expect(severities).toContain('error');
      expect(severities).toContain('warning');
      expect(severities).toContain('info');
    });

    it('should have correct rule ID format', () => {
      // Rule IDs should follow pattern: category.rule-name
      const validIds = [
        'clean-code.long-function',
        'clean-code.magic-numbers',
        'solid.srp',
        'solid.dip',
      ];

      validIds.forEach(id => {
        expect(id).toMatch(/^[a-z-]+\.[a-z-]+$/);
      });
    });
  });

  describe('Violation interface', () => {
    it('should have required fields: file, line, ruleId, message, severity', () => {
      const violation: Violation = {
        file: 'src/test.ts',
        line: 42,
        ruleId: 'clean-code.long-function',
        message: 'Function exceeds 50 lines',
        severity: 'warning',
      };

      expect(violation.file).toBeDefined();
      expect(violation.line).toBeDefined();
      expect(violation.ruleId).toBeDefined();
      expect(violation.message).toBeDefined();
      expect(violation.severity).toBeDefined();
    });

    it('should support optional column field', () => {
      const violationWithColumn: Violation = {
        file: 'src/test.ts',
        line: 42,
        column: 10,
        ruleId: 'clean-code.magic-numbers',
        message: 'Magic number 47 detected',
        severity: 'info',
      };

      expect(violationWithColumn.column).toBe(10);
    });
  });

  describe('Adapter interface', () => {
    it('should have required methods: detectLanguage, parseAST, extractFunctions', () => {
      // This will fail until Adapter interface is defined
      const adapter: Adapter = {
        detectLanguage: () => 'typescript',
        parseAST: () => null,
        extractFunctions: () => [],
        extractClasses: () => [],
        countLines: () => 0,
      };

      expect(adapter.detectLanguage).toBeDefined();
      expect(adapter.parseAST).toBeDefined();
      expect(adapter.extractFunctions).toBeDefined();
    });
  });
});