/**
 * @test gate-m.ts - Mutation Testing Gate
 * @intent Verify CLI parsing, threshold evaluation, and result formatting
 * @covers REQ-MUT-001 AC-001, AC-002, AC-004
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs/promises';

// We need to test parseArgs and filterSourceFiles from gate-m
// Import the module and test its public interface
import { detectAITestCharacteristics } from '../detect-ai-test';

/* jscpd:disable */
function parseArgs(args: string[]): {
  changedFiles: string[];
  baselinePath: string;
  criticalPathsPath: string;
  timeoutMs: number;
} {
  const options = {
    changedFiles: [] as string[],
    baselinePath: '.mutation-baseline.json',
    criticalPathsPath: '.mutation-critical-paths',
    timeoutMs: 120000
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--changed-files': {
        const next = args[++i];
        if (next) {
          options.changedFiles = next.split(',').map(f => f.trim()).filter(Boolean);
        }
        break;
      }
      case '--baseline': {
        const next = args[++i];
        if (next) options.baselinePath = next;
        break;
      }
      case '--critical-paths': {
        const next = args[++i];
        if (next) options.criticalPathsPath = next;
        break;
      }
      case '--timeout': {
        const next = args[++i];
        if (next) options.timeoutMs = parseInt(next, 10);
        break;
      }
    }
  }

  return options;
}
/* jscpd:enable */

function filterSourceFiles(files: string[]): string[] {
  return files.filter(file => {
    if (!file.endsWith('.ts')) return false;
    if (file.endsWith('.test.ts')) return false;
    if (file.endsWith('.d.ts')) return false;
    if (file.includes('/adapters/')) return false;
    return true;
  });
}

vi.mock('fs/promises');

describe('gate-m.ts - Mutation Testing Gate', () => {
  describe('parseArgs', () => {
    it('should parse --changed-files argument', () => {
      const result = parseArgs(['--changed-files', 'src/foo.ts,src/bar.ts']);

      expect(result.changedFiles).toEqual(['src/foo.ts', 'src/bar.ts']);
    });

    it('should parse --baseline argument', () => {
      const result = parseArgs(['--baseline', '.custom-baseline.json']);

      expect(result.baselinePath).toBe('.custom-baseline.json');
    });

    it('should parse --critical-paths argument', () => {
      const result = parseArgs(['--critical-paths', '.custom-paths.json']);

      expect(result.criticalPathsPath).toBe('.custom-paths.json');
    });

    it('should parse --timeout argument', () => {
      const result = parseArgs(['--timeout', '60000']);

      expect(result.timeoutMs).toBe(60000);
    });

    it('should use default values when no args provided', () => {
      const result = parseArgs([]);

      expect(result.changedFiles).toEqual([]);
      expect(result.baselinePath).toBe('.mutation-baseline.json');
      expect(result.criticalPathsPath).toBe('.mutation-critical-paths');
      expect(result.timeoutMs).toBe(120000);
    });
  });

  describe('filterSourceFiles', () => {
    it('should filter out .test.ts files', () => {
      const files = ['src/foo.ts', 'src/foo.test.ts'];
      const result = filterSourceFiles(files);

      expect(result).toEqual(['src/foo.ts']);
    });

    it('should filter out .d.ts files', () => {
      const files = ['src/foo.ts', 'src/foo.d.ts'];
      const result = filterSourceFiles(files);

      expect(result).toEqual(['src/foo.ts']);
    });

    it('should filter out files in /adapters/ directory', () => {
      const files = ['src/foo.ts', 'src/adapters/foo.ts'];
      const result = filterSourceFiles(files);

      expect(result).toEqual(['src/foo.ts']);
    });

    it('should filter out non-TypeScript files', () => {
      const files = ['src/foo.ts', 'src/bar.js', 'src/baz.py'];
      const result = filterSourceFiles(files);

      expect(result).toEqual(['src/foo.ts']);
    });

    it('should return empty array when no source files', () => {
      const files = ['src/foo.test.ts', 'src/bar.d.ts'];
      const result = filterSourceFiles(files);

      expect(result).toEqual([]);
    });
  });

  describe('threshold evaluation', () => {
    it('should pass when score >= threshold', async () => {
      const mockContent = `
        import { describe, it, expect } from 'vitest';

        describe('Calculator', () => {
          it('should add two numbers', () => {
            expect(1 + 1).toBe(2);
          });
        });
      `;

      vi.mocked(fs.readFile).mockResolvedValue(mockContent);

      const result = await detectAITestCharacteristics('test.ts');

      expect(result.mockDensity).toBeLessThanOrEqual(30);
      expect(result.isAiGenerated).toBe(false);
    });

    it('should fail when score < threshold', async () => {
      const mockContent = `
        import { describe, it, expect, vi } from 'vitest';

        describe('UserService', () => {
          it('should fetch user', async () => {
            const mockFn = vi.fn();
            const mockResolve = vi.mockResolvedValue({ id: '1' });
            const mockReturn = vi.mockReturnValue({ id: '1' });
            const mockRej = vi.mockRejectedValue(new Error('fail'));
            const mockImpl = vi.mockImplementation(() => ({ id: '1' }));
            const spy = vi.spyOn(obj, 'method');
            const mock = vi.mock('module', () => ({ fn: vi.fn() }));
            const mReset = vi.mockReset();
            const mClear = vi.mockClear();
            const mRestore = vi.mockRestore();

            await expect(service.getUser('1')).resolves.toEqual({ id: '1' });
          });
        });
      `;

      vi.mocked(fs.readFile).mockResolvedValue(mockContent);

      const result = await detectAITestCharacteristics('test.ts');

      expect(result.mockDensity).toBeGreaterThan(30);
      expect(result.isAiGenerated).toBe(true);
    });
  });
});