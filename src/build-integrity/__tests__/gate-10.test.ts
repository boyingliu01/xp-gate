import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { runTscCheck, runPackCheck } from '../gate-10';

// Increase test timeout for subprocess calls (tsc, npm pack)
vi.setConfig({ testTimeout: 30000 });

/**
 * @test Gate 10 runTscCheck
 * @intent Verify tsc --noEmit check behavior for build integrity gate
 * @covers runTscCheck
 */

describe('runTscCheck', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gate10-test-'));
    // Symlink node_modules from project root so tsc is available
    const projectNodeModules = path.join(process.cwd(), 'node_modules');
    const testNodeModules = path.join(tmpDir, 'node_modules');
    try {
      await fs.symlink(projectNodeModules, testNodeModules, 'dir');
    } catch {
      // Ignore if symlink fails (e.g., already exists)
    }
  });

  afterEach(async () => {
    // Windows may hold a file lock from tsc subprocess; retry with backoff
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
        break;
      } catch {
        if (attempt < 4) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  });

  it('returns skip when no tsconfig.json exists', async () => {
    const result = await runTscCheck(tmpDir, 30000);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('tsconfig.json');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns skip when tsc is not available on PATH', async () => {
    // Create tsconfig.json in an isolated dir with no node_modules
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gate10-notsc-'));
    try {
      await fs.writeFile(
        path.join(isolatedDir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true } })
      );

      // Override PATH and cwd to exclude all tsc resolution paths
      const originalPath = process.env.PATH;
      const originalCwd = process.cwd;
      process.env.PATH = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin:/bin';
      process.cwd = () => isolatedDir;

      try {
        const result = await runTscCheck(isolatedDir, 30000);
        expect(result.status).toBe('skip');
        expect(result.message).toContain('tsc');
      } finally {
        process.env.PATH = originalPath;
        process.cwd = originalCwd;
      }
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('returns pass when tsc exits 0', async () => {
    // Create a minimal valid TypeScript project
    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          strict: true,
          noEmit: true,
        },
        include: ['*.ts'],
      })
    );

    await fs.writeFile(
      path.join(tmpDir, 'valid.ts'),
      'const x: number = 42;\nconsole.log(x);\n'
    );

    const result = await runTscCheck(tmpDir, 60000);
    expect(result.status).toBe('pass');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns fail when tsc exits non-zero', async () => {
    // Create a TypeScript project with type errors
    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          strict: true,
          noEmit: true,
        },
        include: ['*.ts'],
      })
    );

    await fs.writeFile(
      path.join(tmpDir, 'invalid.ts'),
      'const x: number = "string";\n'
    );

    const result = await runTscCheck(tmpDir, 60000);
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/error|Error/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns skip when tsc times out', async () => {
    // Create a large TypeScript project that will timeout
    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          strict: true,
          noEmit: true,
        },
        include: ['*.ts'],
      })
    );

    // Create many files to slow down tsc
    for (let i = 0; i < 100; i++) {
      const content = `
        export const value${i} = ${i};
        export function fn${i}(): number { return ${i}; }
        export interface Interface${i} { prop: number; }
      `;
      await fs.writeFile(path.join(tmpDir, `file${i}.ts`), content);
    }

    // Very short timeout to force timeout (or tsc unavailable on slow platforms)
    const result = await runTscCheck(tmpDir, 500);
    expect(result.status).toBe('skip');
    expect(result.message).toMatch(/timeout|Timeout|TIMEOUT|timed out|not available/i);
  });
});

/**
 * @test Gate 10 runPackCheck
 * @intent Verify npm pack --dry-run check behavior for build integrity gate
 * @covers runPackCheck
 */
describe('runPackCheck', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gate10-pack-'));
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

  it('returns skip when no package.json exists', async () => {
    const result = await runPackCheck(tmpDir, 30000);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('package.json');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns skip when package.json has no files field', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', version: '1.0.0' })
    );

    const result = await runPackCheck(tmpDir, 30000);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('files');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns pass when npm pack produces non-empty file list', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-pkg',
        version: '1.0.0',
        files: ['index.js'],
      })
    );
    await fs.writeFile(path.join(tmpDir, 'index.js'), 'module.exports = {};\n');

    const result = await runPackCheck(tmpDir, 60000);
    expect(result.status).toBe('pass');
    expect(result.message).toMatch(/\d+ file/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns fail when npm pack exits non-zero', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-pkg',
        version: '1.0.0',
        files: ['index.js'],
        scripts: { prepack: 'exit 1' },
      })
    );
    await fs.writeFile(path.join(tmpDir, 'index.js'), 'module.exports = {};\n');

    const result = await runPackCheck(tmpDir, 60000);
    expect(result.status).toBe('fail');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns skip when npm pack times out', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-pkg',
        version: '1.0.0',
        files: ['index.js'],
      })
    );
    await fs.writeFile(path.join(tmpDir, 'index.js'), 'module.exports = {};\n');

    const result = await runPackCheck(tmpDir, 1);
    expect(result.status).toBe('skip');
    expect(result.message).toMatch(/timeout|Timeout|TIMEOUT/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
