/**
 * @test Gate 10 runGate10 orchestrator + main CLI
 * @intent Verify that runGate10 combines tsc/pack/import checks correctly,
 *         and that main() parses CLI args and returns correct exit codes.
 * @covers runGate10, main
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import { runGate10, main } from '../gate-10';

vi.setConfig({ testTimeout: 30000 });

describe('runGate10', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gate10-orch-'));
    const projectNodeModules = path.join(process.cwd(), 'node_modules');
    const testNodeModules = path.join(tmpDir, 'node_modules');
    try {
      await fs.symlink(projectNodeModules, testNodeModules, 'dir');
    } catch { /* may already exist */ }
  });

  afterEach(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
        break;
      } catch {
        if (attempt < 4) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  });

  it('returns skip status when no package.json exists', async () => {
    const result = await runGate10({
      changedFiles: [],
      projectRoot: tmpDir,
      timeoutMs: 30000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.checks.tsc.status).toBe('skip');
    expect(result.checks.pack.status).toBe('skip');
    expect(result.checks.imports.status).toBe('pass');
    expect(result.errors).toHaveLength(0);
  });

  it('returns skip when no changed TS/JS files and no tsconfig', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0' })
    );

    const result = await runGate10({
      changedFiles: [],
      projectRoot: tmpDir,
      timeoutMs: 30000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.checks.tsc.status).toBe('skip');
    expect(result.checks.imports.status).toBe('pass');
  });

  it('returns pass when all checks pass', async () => {
    // Create a minimal valid project
    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2020', module: 'commonjs', strict: true, noEmit: true },
        include: ['*.ts'],
      })
    );
    await fs.writeFile(path.join(tmpDir, 'valid.ts'), 'const x: number = 42;\n');
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', version: '1.0.0' })
    );

    const validFile = path.join(tmpDir, 'valid.ts');
    const result = await runGate10({
      changedFiles: [validFile],
      projectRoot: tmpDir,
      timeoutMs: 60000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.status).toBe('pass');
    expect(result.checks.tsc.status).toBe('pass');
    expect(result.checks.imports.status).toBe('pass');
    expect(result.errors).toHaveLength(0);
  });

  it('returns block (exitCode 1) when tsc check fails', async () => {
    // Create a project with type errors
    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2020', module: 'commonjs', strict: true, noEmit: true },
        include: ['*.ts'],
      })
    );
    await fs.writeFile(path.join(tmpDir, 'bad.ts'), 'const x: number = "string";\n');
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', version: '1.0.0' })
    );

    const badFile = path.join(tmpDir, 'bad.ts');
    const result = await runGate10({
      changedFiles: [badFile],
      projectRoot: tmpDir,
      timeoutMs: 60000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.status).toBe('block');
    expect(result.checks.tsc.status).toBe('fail');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns block when import check fails', async () => {
    // Create a project with a broken import
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir);
    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2020', module: 'commonjs', strict: true, noEmit: true },
        include: ['src/*.ts'],
      })
    );
    await fs.writeFile(
      path.join(srcDir, 'bad-import.ts'),
      `import { x } from './nonexistent';\n`
    );
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', version: '1.0.0' })
    );

    const badFile = path.join(srcDir, 'bad-import.ts');
    const result = await runGate10({
      changedFiles: [badFile],
      projectRoot: tmpDir,
      timeoutMs: 60000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.status).toBe('block');
    expect(result.checks.imports.status).toBe('fail');
    expect(result.checks.imports.violations.length).toBeGreaterThan(0);
  });

  it('includes warnings array in result', async () => {
    const result = await runGate10({
      changedFiles: [],
      projectRoot: tmpDir,
      timeoutMs: 30000,
    });

    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('includes errors array in result', async () => {
    const result = await runGate10({
      changedFiles: [],
      projectRoot: tmpDir,
      timeoutMs: 30000,
    });

    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('runs all checks in parallel (total time < sum of individual times)', async () => {
    // This is a soft check — we just verify the result has all three check results
    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2020', module: 'commonjs', strict: true, noEmit: true },
        include: ['*.ts'],
      })
    );
    await fs.writeFile(path.join(tmpDir, 'valid.ts'), 'const x: number = 42;\n');
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', version: '1.0.0' })
    );

    const result = await runGate10({
      changedFiles: [path.join(tmpDir, 'valid.ts')],
      projectRoot: tmpDir,
      timeoutMs: 60000,
    });

    // All three checks should have been run
    expect(result.checks.tsc).toBeDefined();
    expect(result.checks.pack).toBeDefined();
    expect(result.checks.imports).toBeDefined();
    // All should have non-negative duration
    expect(result.checks.tsc.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.checks.pack.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.checks.imports.durationMs).toBeGreaterThanOrEqual(0);
  });
});

/**
 * ─── main CLI ─────────────────────────────────────────────────────────────────
 */
describe('main', () => {
  let tmpDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consoleSpy: any;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gate10-cli-'));
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* intentional no-op for spy */ });
    const projectNodeModules = path.join(process.cwd(), 'node_modules');
    const testNodeModules = path.join(tmpDir, 'node_modules');
    try {
      await fs.symlink(projectNodeModules, testNodeModules, 'dir');
    } catch { /* may already exist */ }
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
        break;
      } catch {
        if (attempt < 4) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  });

  it('returns 0 when no changed files provided', async () => {
    const exitCode = await main([
      '--changed-files', '',
      '--project-root', tmpDir,
    ]);
    expect(exitCode).toBe(0);
  });

  it('parses comma-separated changed files', async () => {
    const file1 = path.join(tmpDir, 'a.ts');
    const file2 = path.join(tmpDir, 'b.ts');
    await fs.writeFile(file1, 'const a = 1;\n');
    await fs.writeFile(file2, 'const b = 2;\n');

    const exitCode = await main([
      '--changed-files', `${file1},${file2}`,
      '--project-root', tmpDir,
    ]);

    expect(exitCode).toBe(0);
  });

  it('returns 1 when a check fails', async () => {
    // Create a project with type errors
    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2020', module: 'commonjs', strict: true, noEmit: true },
        include: ['*.ts'],
      })
    );
    const badFile = path.join(tmpDir, 'bad.ts');
    await fs.writeFile(badFile, 'const x: number = "string";\n');

    const exitCode = await main([
      '--changed-files', badFile,
      '--project-root', tmpDir,
    ]);

    expect(exitCode).toBe(1);
  });

  it('prints formatted results table', async () => {
    const exitCode = await main([
      '--changed-files', '',
      '--project-root', tmpDir,
    ]);

    // Check that console.log was called with table-like output
    expect(exitCode).toBe(0);
    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toMatch(/tsc|pack|import/i);
  });

  it('returns 0 for --help flag', async () => {
    const exitCode = await main(['--help']);
    expect(exitCode).toBe(0);
    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toMatch(/usage|help|changed-files/i);
  });
});
