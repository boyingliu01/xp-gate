/**
 * @test index.ts - CLI entry point
 * @intent Verify CLI parses arguments and runs analysis correctly
 * @covers clean-code-solid-checker-design Section 3 (Integration)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { main, parseArgs } from '../index';
import { resetActiveConfig } from '../config';

describe('index.ts - CLI Entry Point', () => {
  // Each main() call installs the config it loads. Production runs one process
  // per invocation; this file calls main() repeatedly in one process, so the
  // documented reset-per-run lifecycle is what keeps #457's replacement
  // guardrail from reporting the test harness itself.
  beforeEach(() => {
    resetActiveConfig();
  });


  describe('parseArgs', () => {
    it('should parse --files argument', () => {
      const args = ['--files', 'test.ts test2.ts'];
      const options = parseArgs(args);
      
      expect(options.files).toEqual(['test.ts', 'test2.ts']);
    });

    it('should parse --format argument', () => {
      const args = ['--files', 'test.ts', '--format', 'json'];
      const options = parseArgs(args);
      
      expect(options.format).toBe('json');
    });

    it('should parse --changed-only flag', () => {
      const args = ['--files', 'test.ts', '--changed-only'];
      const options = parseArgs(args);
      
      expect(options.changedOnly).toBe(true);
    });

    it('should parse --show-score flag', () => {
      const args = ['--files', 'test.ts', '--show-score'];
      const options = parseArgs(args);
      
      expect(options.showScore).toBe(true);
    });

    it('should default format to console', () => {
      const args = ['--files', 'test.ts'];
      const options = parseArgs(args);
      
      expect(options.format).toBe('console');
    });

    it('should handle positional file arguments', () => {
      const args = ['test.ts', 'test2.ts'];
      const options = parseArgs(args);
      
      expect(options.files).toEqual(['test.ts', 'test2.ts']);
    });
  });

  describe('main', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('should return 2 when no files provided', async () => {
      const result = await main([]);

      // 2, not 1. Exit 1 asserts "I examined files and found ERROR-severity
      // violations"; a gate that sees 1 with an empty report reads a clean pass, so
      // a miswired hook would announce PASSED having checked nothing (#457).
      expect(result).toBe(2);
      expect(console.error).toHaveBeenCalled();
    });

    it('should run analysis on provided files', async () => {
      const result = await main(['--files', 'src/principles/types.ts']);
      
      expect(result).toBeDefined();
      expect(console.log).toHaveBeenCalled();
    });

    it('should return 0 when no violations', async () => {
      const result = await main(['--files', 'src/principles/types.ts', '--format', 'json']);
      
      expect(result).toBe(0);
    });
  });
});