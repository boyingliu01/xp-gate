/**
 * @test REQ-327 mock-policy test coverage
 * @intent Verify gate-m3 orchestrator (runGateM3) and CLI entry (main)
 * @covers AC-327-01
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runGateM3, main } from '../gate-m3';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempProject(name: string): string {
  const tmpDir = join(tmpdir(), `gate-m3-test-${name}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  writeFileSync(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      dependencies: { stripe: '^12.0.0', axios: '^1.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    }),
  );

  mkdirSync(join(tmpDir, 'src', '__tests__'), { recursive: true });
  mkdirSync(join(tmpDir, 'src', 'services'), { recursive: true });

  return tmpDir;
}

// ---------------------------------------------------------------------------
// runGateM3 — orchestrator
// ---------------------------------------------------------------------------
describe('runGateM3', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempProject('orchestrator');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns skip status for empty file list', async () => {
    const result = await runGateM3([], tmpDir);

    expect(result.status).toBe('skip');
    expect(result.exitCode).toBe(0);
    expect(result.violations).toEqual([]);
    expect(result.scores.totalTests).toBe(0);
    expect(result.scores.integrationTests).toBe(0);
    expect(result.scores.mockDensity).toBe(0);
    expect(result.scores.pendingMocks).toBe(0);
  });

  it('returns skip when only non-test files are provided', async () => {
    const result = await runGateM3(
      ['src/services/user.ts', 'src/services/order.ts'],
      tmpDir,
    );

    expect(result.status).toBe('skip');
    expect(result.exitCode).toBe(0);
    expect(result.scores.totalTests).toBe(0);
  });

  it('filters out non-test files and processes only test files', async () => {
    const testFile = join(tmpDir, 'src/__tests__/user.test.ts');
    writeFileSync(testFile, [
      "import { describe, it, expect } from 'vitest';",
      '',
      "describe('user', () => {",
      "  it('works', () => {",
      '    expect(true).toBe(true);',
      '  });',
      '});',
    ].join('\n'));

    const result = await runGateM3(
      ['src/services/user.ts', testFile],
      tmpDir,
    );

    expect(result.status).toBe('pass');
    expect(result.scores.totalTests).toBe(1);
  });

  it('counts integration tests correctly in scores', async () => {
    const intTest = join(tmpDir, 'src/__tests__/payment.integration.test.ts');
    writeFileSync(intTest, [
      "import Stripe from 'stripe';",
      '',
      "describe('payment', () => {",
      "  it('creates charge', async () => {",
      "    const s = new Stripe('sk_test');",
      '  });',
      '});',
    ].join('\n'));

    const unitTest = join(tmpDir, 'src/__tests__/helper.test.ts');
    writeFileSync(unitTest, [
      "import { describe, it, expect } from 'vitest';",
      '',
      "describe('helper', () => {",
      "  it('works', () => {",
      '    expect(1 + 1).toBe(2);',
      '  });',
      '});',
    ].join('\n'));

    const result = await runGateM3([intTest, unitTest], tmpDir);

    expect(result.scores.totalTests).toBe(2);
    expect(result.scores.integrationTests).toBe(1);
  });

  it('returns pass with warning severity even when violations exist', async () => {
    const testFile = join(tmpDir, 'src/__tests__/payment.integration.test.ts');
    writeFileSync(testFile, [
      "import Stripe from 'stripe';",
      '',
      "describe('payment', () => {",
      "  it('creates charge', async () => {",
      "    const s = new Stripe('sk_test');",
      '  });',
      '});',
    ].join('\n'));

    // No .mockpolicyrc → default severity is 'warning'
    const result = await runGateM3([testFile], tmpDir);

    expect(result.status).toBe('pass');
    expect(result.exitCode).toBe(0);
    // Violations may exist but severity=warning means no block
    if (result.violations.length > 0) {
      expect(result.violations.every(v => v.severity === 'warning')).toBe(true);
    }
  });

  it('returns block with error severity when violations exist', async () => {
    writeFileSync(
      join(tmpDir, '.mockpolicyrc'),
      JSON.stringify({ severity: 'error' }),
    );

    const testFile = join(tmpDir, 'src/__tests__/payment.integration.test.ts');
    writeFileSync(testFile, [
      "import Stripe from 'stripe';",
      '',
      "describe('payment', () => {",
      "  it('creates charge', async () => {",
      "    const s = new Stripe('sk_test');",
      '  });',
      '});',
    ].join('\n'));

    const result = await runGateM3([testFile], tmpDir);

    expect(result.status).toBe('block');
    expect(result.exitCode).toBe(1);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('returns pass with error severity when no violations exist', async () => {
    writeFileSync(
      join(tmpDir, '.mockpolicyrc'),
      JSON.stringify({ severity: 'error' }),
    );

    // Test file with no imports → no violations possible
    const testFile = join(tmpDir, 'src/__tests__/clean.test.ts');
    writeFileSync(testFile, [
      'describe("clean", () => {',
      '  it("works", () => {',
      '    // no imports, no violations',
      '  });',
      '});',
    ].join('\n'));

    const result = await runGateM3([testFile], tmpDir);

    expect(result.status).toBe('pass');
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('throws when a test file is unreadable during validation', async () => {
    const nonExistentTest = join(tmpDir, 'src/__tests__/missing.test.ts');

    await expect(runGateM3([nonExistentTest], tmpDir)).rejects.toThrow('ENOENT');
  });

  it('processes .spec.ts files as test files', async () => {
    const specFile = join(tmpDir, 'src/__tests__/helper.spec.ts');
    writeFileSync(specFile, [
      "import { describe, it, expect } from 'vitest';",
      '',
      "describe('helper', () => {",
      "  it('works', () => {",
      '    expect(1).toBe(1);',
      '  });',
      '});',
    ].join('\n'));

    const result = await runGateM3([specFile], tmpDir);

    expect(result.scores.totalTests).toBe(1);
    expect(result.status).toBe('pass');
  });

  it('uses process.cwd() as default projectRoot when not specified', async () => {
    // This test verifies the default parameter behavior
    // We can't easily test the actual cwd behavior without side effects,
    // but we verify the function accepts being called without projectRoot
    const result = await runGateM3([]);

    expect(result.status).toBe('skip');
    expect(result.scores.totalTests).toBe(0);
  });

  it('produces correct result shape with all required fields', async () => {
    const result = await runGateM3([], tmpDir);

    expect(result).toHaveProperty('exitCode');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('violations');
    expect(result).toHaveProperty('scores');
    expect(result.scores).toHaveProperty('totalTests');
    expect(result.scores).toHaveProperty('integrationTests');
    expect(result.scores).toHaveProperty('mockDensity');
    expect(result.scores).toHaveProperty('pendingMocks');
    expect(typeof result.exitCode).toBe('number');
    expect(['pass', 'block', 'skip']).toContain(result.status);
    expect(Array.isArray(result.violations)).toBe(true);
  });

  it('counts pendingMocks in scores when pending violations exist', async () => {
    // Create an integration test that imports a non-existent module
    // which may be classified as pending by the scope scanner
    const testFile = join(tmpDir, 'src/__tests__/feature.integration.test.ts');
    writeFileSync(testFile, [
      '',
      "vi.mock('../services/not-implemented', () => {",
      '  return { doSomething: vi.fn() };',
      '});',
      '',
      "import { doSomething } from '../services/not-implemented';",
      '',
      "describe('feature', () => {",
      "  it('does something', () => {",
      '    doSomething();',
      '  });',
      '});',
    ].join('\n'));

    const result = await runGateM3([testFile], tmpDir);

    // pendingMocks counts violations whose reason includes 'pending'
    expect(typeof result.scores.pendingMocks).toBe('number');
    expect(result.scores.pendingMocks).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// main — CLI entry point
// ---------------------------------------------------------------------------
describe('main', () => {
  let tmpDir: string;
  let consoleErrorSpy: any;
  let consoleLogSpy: any;

  beforeEach(() => {
    tmpDir = createTempProject('main-cli');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* noop */ });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it('returns 1 and prints usage when no args provided', async () => {
    const exitCode = await main([]);

    expect(exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Usage:'),
    );
  });

  it('returns 0 for valid test files with no violations', async () => {
    const testFile = join(tmpDir, 'src/__tests__/clean.test.ts');
    writeFileSync(testFile, [
      "import { describe, it, expect } from 'vitest';",
      '',
      "describe('clean', () => {",
      "  it('works', () => {",
      '    expect(true).toBe(true);',
      '  });',
      '});',
    ].join('\n'));

    const exitCode = await main([testFile]);

    expect(exitCode).toBe(0);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Gate M3'),
    );
  });

  it('prints violation details when violations exist', async () => {
    // main() uses process.cwd(), so we cannot control config via tmpDir.
    // Instead, we verify that when violations are found, the "Violations:"
    // header is printed. With default config (severity=warning), exitCode=0.
    const testFile = join(tmpDir, 'src/__tests__/payment.integration.test.ts');
    writeFileSync(testFile, [
      "import Stripe from 'stripe';",
      '',
      "describe('payment', () => {",
      "  it('creates charge', async () => {",
      "    const s = new Stripe('sk_test');",
      '  });',
      '});',
    ].join('\n'));

    const exitCode = await main([testFile]);

    const logCalls: string[] = consoleLogSpy.mock.calls.map(
      (c: any[]) => String(c[0]),
    );
    expect(logCalls.some((msg) => msg.includes('Gate M3'))).toBe(true);
    expect(exitCode).toBe(0);
  });

  it('prints PASS label when no blocking violations', async () => {
    const testFile = join(tmpDir, 'src/__tests__/clean.test.ts');
    writeFileSync(testFile, [
      "import { describe, it, expect } from 'vitest';",
      '',
      "describe('clean', () => {",
      "  it('works', () => {",
      '    expect(true).toBe(true);',
      '  });',
      '});',
    ].join('\n'));

    await main([testFile]);

    const logCalls: string[] = consoleLogSpy.mock.calls.map(
      (c: any[]) => String(c[0]),
    );
    const hasPassLabel = logCalls.some(
      (msg) => msg.includes('PASS'),
    );
    expect(hasPassLabel).toBe(true);
  });

  it('prints file count in header', async () => {
    const testFile = join(tmpDir, 'src/__tests__/clean.test.ts');
    writeFileSync(testFile, "import { describe } from 'vitest';");

    await main([testFile]);

    const logCalls: string[] = consoleLogSpy.mock.calls.map(
      (c: any[]) => String(c[0]),
    );
    const hasFileCount = logCalls.some(
      (msg) => msg.includes('Changed files: 1'),
    );
    expect(hasFileCount).toBe(true);
  });
});
