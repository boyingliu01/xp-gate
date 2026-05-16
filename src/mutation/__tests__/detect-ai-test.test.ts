/**
 * @test detect-ai-test.ts - AI-generated test detection
 * @intent Verify mock density and annotation detection work correctly
 * @covers REQ-MUT-001 AC-003 (mock density heuristic)
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import { detectAITestCharacteristics } from '../detect-ai-test';

vi.mock('fs/promises');

describe('detect-ai-test.ts - AI Test Detection', () => {
  describe('detectAITestCharacteristics', () => {
    it('should return isAiGenerated=true when mock density > 30%', async () => {
      const mockContent = `
        import { describe, it, expect, vi } from 'vitest';

        describe('UserService', () => {
          it('should return user when valid id', async () => {
            const mockFn = vi.fn();
            const mockResolve = vi.mockResolvedValue({ id: '1', name: 'Test' });
            const mockReturn = vi.mockReturnValue({ id: '1', name: 'Test' });
            const mockRej = vi.mockRejectedValue(new Error('fail'));
            const mockImpl = vi.mockImplementation(() => ({ id: '1' }));
            const spy = vi.spyOn(obj, 'method');
            const mock = vi.mock('module', () => ({ fn: vi.fn() }));
            const mReset = vi.mockReset();
            const mClear = vi.mockClear();
            const mRestore = vi.mockRestore();

            await expect(service.getUser('1')).resolves.toEqual({ id: '1', name: 'Test' });
          });
        });
      `;

      vi.mocked(fs.readFile).mockResolvedValue(mockContent);

      const result = await detectAITestCharacteristics('src/__tests__/user.test.ts');

      expect(result.isAiGenerated).toBe(true);
      expect(result.mockDensity).toBeGreaterThan(30);
    });

    it('should return isAiGenerated=false when mock density <= 30%', async () => {
      const mockContent = `
        import { describe, it, expect } from 'vitest';

        describe('Calculator', () => {
          it('should add two numbers', () => {
            expect(1 + 1).toBe(2);
          });
        });
      `;

      vi.mocked(fs.readFile).mockResolvedValue(mockContent);

      const result = await detectAITestCharacteristics('src/__tests__/calc.test.ts');

      expect(result.isAiGenerated).toBe(false);
      expect(result.mockDensity).toBeLessThanOrEqual(30);
    });

    it('should detect @mutation-threshold annotation', async () => {
      const mockContent = `
        /**
         * @test Calculator
         * @mutation-threshold: 70
         */
        import { describe, it, expect } from 'vitest';

        describe('Calculator', () => {
          it('should add two numbers', () => {
            expect(1 + 1).toBe(2);
          });
        });
      `;

      vi.mocked(fs.readFile).mockResolvedValue(mockContent);

      const result = await detectAITestCharacteristics('src/__tests__/calc.test.ts');

      expect(result.explicitThreshold).toBe(70);
    });

    it('should detect @test, @intent, @covers annotations', async () => {
      const mockContent = `
        /**
         * @test Calculator
         * @intent Verify basic arithmetic
         * @covers AC-CALC-01
         */
        import { describe, it, expect } from 'vitest';

        describe('Calculator', () => {
          it('should add two numbers', () => {
            expect(1 + 1).toBe(2);
          });
        });
      `;

      vi.mocked(fs.readFile).mockResolvedValue(mockContent);

      const result = await detectAITestCharacteristics('src/__tests__/calc.test.ts');

      expect(result.annotations.hasTest).toBe(true);
      expect(result.annotations.hasIntent).toBe(true);
      expect(result.annotations.hasCovers).toBe(true);
    });

    it('should return default result when file read fails', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await detectAITestCharacteristics('nonexistent.test.ts');

      expect(result.isAiGenerated).toBe(false);
      expect(result.mockDensity).toBe(0);
      expect(result.annotations.hasTest).toBe(false);
    });
  });
});