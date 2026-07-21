/**
 * @test-type unit
 * @test REQ-002 Layered test reporter
 * @covers AC-005 AC-006 AC-007
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import { generateLayeredTestReport } from '../layered-test-reporter';

vi.mock('fs/promises');

describe('layered-test-reporter — Layered Test Statistics', () => {
  it('should classify test files by @test-type annotation', async () => {
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce('/** @test-type unit */\nimport { describe, it } from "vitest";')
      .mockResolvedValueOnce('/** @test-type integration */\nimport { describe, it } from "vitest";')
      .mockResolvedValueOnce('/** @test-type e2e */\nimport { describe, it } from "vitest";');

    const result = await generateLayeredTestReport(
      ['src/__tests__/a.test.ts', 'src/__tests__/b.test.ts', 'src/__tests__/c.test.ts'],
      process.cwd(),
    );

    expect(result.unit.testFiles).toBe(1);
    expect(result.integration.testFiles).toBe(1);
    expect(result.e2e.testFiles).toBe(1);
    expect(result.total.testFiles).toBe(3);
  });

  it('should fall back to path-based detection when no annotation', async () => {
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce('import { describe, it } from "vitest";')
      .mockResolvedValueOnce('import { describe, it } from "vitest";');

    const result = await generateLayeredTestReport(
      ['src/__tests__/unit.test.ts', 'src/e2e/flow.e2e.test.ts'],
      process.cwd(),
    );

    expect(result.unit.testFiles).toBe(1);
    expect(result.e2e.testFiles).toBe(1);
  });

  it('should count mock density per layer', async () => {
    const highMockContent = `
      /** @test-type unit */
      import { vi } from 'vitest';
      vi.mock('a'); vi.mock('b'); vi.mock('c'); vi.mock('d');
      it('test1', () => {}); it('test2', () => {});
    `;
    const lowMockContent = `
      /** @test-type unit */
      import { describe, it } from 'vitest';
      it('test1', () => {}); it('test2', () => {}); it('test3', () => {});
    `;
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(highMockContent)
      .mockResolvedValueOnce(lowMockContent);

    const result = await generateLayeredTestReport(
      ['src/__tests__/high.test.ts', 'src/__tests__/low.test.ts'],
      process.cwd(),
    );

    expect(result.unit.testFiles).toBe(2);
    expect(result.unit.mockDensity).toBeGreaterThan(0);
  });

  it('should categorize unannotated non-matching files as unknown', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('import { it } from "vitest";');

    const result = await generateLayeredTestReport(
      ['src/services/user.ts'],
      process.cwd(),
    );

    // Not a test file — should be skipped entirely
    expect(result.total.testFiles).toBe(0);
  });

  it('should handle empty file list', async () => {
    const result = await generateLayeredTestReport([], process.cwd());

    expect(result.total.testFiles).toBe(0);
    expect(result.unit.testFiles).toBe(0);
    expect(result.integration.testFiles).toBe(0);
    expect(result.e2e.testFiles).toBe(0);
  });

  it('should compute layer distribution percentages', async () => {
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce('/** @test-type unit */\nimport "vitest";')
      .mockResolvedValueOnce('/** @test-type unit */\nimport "vitest";')
      .mockResolvedValueOnce('/** @test-type e2e */\nimport "vitest";');

    const result = await generateLayeredTestReport(
      ['a.test.ts', 'b.test.ts', 'c.e2e.test.ts'],
      process.cwd(),
    );

    expect(result.total.layerDistribution.unit).toBeCloseTo(66.67, 0);
    expect(result.total.layerDistribution.e2e).toBeCloseTo(33.33, 0);
  });

  it('should handle unreadable files gracefully', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

    const result = await generateLayeredTestReport(
      ['src/__tests__/missing.test.ts'],
      process.cwd(),
    );

    // Falls back to path detection
    expect(result.unit.testFiles).toBe(1);
  });
});
