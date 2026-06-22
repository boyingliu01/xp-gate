/**
 * @test Gate 10 import resolver — extractImports, resolveImportPath, runImportCheck
 * @intent Verify that relative imports are extracted, resolved, and checked against
 *         the project boundary. Catches the original bug where tui-plugin.ts imported
 *         ../../src/... which exists in the repo but not in the published npm package.
 * @covers extractImports, resolveImportPath, runImportCheck
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { extractImports, resolveImportPath, runImportCheck } from '../gate-10';

/**
 * ─── extractImports ────────────────────────────────────────────────────────────
 */
describe('extractImports', () => {
  it('extracts named import with single quotes', () => {
    const content = `import { foo } from './bar';`;
    const result = extractImports(content);
    expect(result).toEqual([{ path: './bar', line: 1 }]);
  });

  it('extracts default import', () => {
    const content = `import foo from './bar';`;
    const result = extractImports(content);
    expect(result).toEqual([{ path: './bar', line: 1 }]);
  });

  it('extracts namespace import', () => {
    const content = `import * as foo from './bar';`;
    const result = extractImports(content);
    expect(result).toEqual([{ path: './bar', line: 1 }]);
  });

  it('extracts require() call', () => {
    const content = `const foo = require('./bar');`;
    const result = extractImports(content);
    expect(result).toEqual([{ path: './bar', line: 1 }]);
  });

  it('extracts dynamic import()', () => {
    const content = `const foo = import('./bar');`;
    const result = extractImports(content);
    expect(result).toEqual([{ path: './bar', line: 1 }]);
  });

  it('extracts named export from', () => {
    const content = `export { foo } from './bar';`;
    const result = extractImports(content);
    expect(result).toEqual([{ path: './bar', line: 1 }]);
  });

  it('extracts star export from', () => {
    const content = `export * from './bar';`;
    const result = extractImports(content);
    expect(result).toEqual([{ path: './bar', line: 1 }]);
  });

  it('extracts multiple imports from multiple lines', () => {
    const content = [
      `import { a } from './a';`,
      `import b from './b';`,
      `const c = require('./c');`,
      `export * from './d';`,
    ].join('\n');
    const result = extractImports(content);
    expect(result).toEqual([
      { path: './a', line: 1 },
      { path: './b', line: 2 },
      { path: './c', line: 3 },
      { path: './d', line: 4 },
    ]);
  });

  it('skips bare npm package imports', () => {
    const content = [
      `import { foo } from 'lodash';`,
      `import path from 'path';`,
      `import { bar } from './local';`,
    ].join('\n');
    const result = extractImports(content);
    expect(result).toEqual([{ path: './local', line: 3 }]);
  });

  it('skips node: protocol imports', () => {
    const content = [
      `import fs from 'node:fs';`,
      `import { readFile } from 'node:fs/promises';`,
      `import { bar } from './local';`,
    ].join('\n');
    const result = extractImports(content);
    expect(result).toEqual([{ path: './local', line: 3 }]);
  });

  it('handles double-quoted import paths', () => {
    const content = `import { foo } from "./bar";`;
    const result = extractImports(content);
    expect(result).toEqual([{ path: './bar', line: 1 }]);
  });

  it('handles parent-relative imports', () => {
    const content = `import { foo } from '../parent/bar';`;
    const result = extractImports(content);
    expect(result).toEqual([{ path: '../parent/bar', line: 1 }]);
  });

  it('handles deeply nested relative imports', () => {
    const content = `import { foo } from '../../../deep/path';`;
    const result = extractImports(content);
    expect(result).toEqual([{ path: '../../../deep/path', line: 1 }]);
  });

  it('returns empty array for content with no imports', () => {
    const content = `const x = 42;\nconsole.log(x);`;
    const result = extractImports(content);
    expect(result).toEqual([]);
  });

  it('handles import with .js extension', () => {
    const content = `import { foo } from './bar.js';`;
    const result = extractImports(content);
    expect(result).toEqual([{ path: './bar.js', line: 1 }]);
  });

  it('handles side-effect import', () => {
    const content = `import './side-effect';`;
    const result = extractImports(content);
    expect(result).toEqual([{ path: './side-effect', line: 1 }]);
  });
});

/**
 * ─── resolveImportPath ─────────────────────────────────────────────────────────
 */
describe('resolveImportPath', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-resolver-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null for bare npm package imports', () => {
    const result = resolveImportPath('lodash', '/some/file.ts');
    expect(result).toBeNull();
  });

  it('returns null for node: protocol imports', () => {
    const result = resolveImportPath('node:fs', '/some/file.ts');
    expect(result).toBeNull();
  });

  it('resolves relative import to existing .ts file', async () => {
    const targetFile = path.join(tmpDir, 'bar.ts');
    await fs.writeFile(targetFile, 'export const x = 1;');

    const fromFile = path.join(tmpDir, 'foo.ts');
    const result = resolveImportPath('./bar', fromFile);
    expect(result).toBe(targetFile);
  });

  it('resolves relative import to existing .tsx file', async () => {
    const targetFile = path.join(tmpDir, 'component.tsx');
    await fs.writeFile(targetFile, 'export const X = () => null;');

    const fromFile = path.join(tmpDir, 'app.ts');
    const result = resolveImportPath('./component', fromFile);
    expect(result).toBe(targetFile);
  });

  it('resolves relative import to existing .js file', async () => {
    const targetFile = path.join(tmpDir, 'util.js');
    await fs.writeFile(targetFile, 'module.exports = {};');

    const fromFile = path.join(tmpDir, 'main.ts');
    const result = resolveImportPath('./util', fromFile);
    expect(result).toBe(targetFile);
  });

  it('resolves relative import with explicit .js extension to .ts file', async () => {
    // TypeScript allows `import './bar.js'` to resolve to `bar.ts`
    const targetFile = path.join(tmpDir, 'bar.ts');
    await fs.writeFile(targetFile, 'export const x = 1;');

    const fromFile = path.join(tmpDir, 'foo.ts');
    const result = resolveImportPath('./bar.js', fromFile);
    expect(result).toBe(targetFile);
  });

  it('resolves relative import to index.ts in directory', async () => {
    const subDir = path.join(tmpDir, 'mydir');
    await fs.mkdir(subDir);
    const indexFile = path.join(subDir, 'index.ts');
    await fs.writeFile(indexFile, 'export const x = 1;');

    const fromFile = path.join(tmpDir, 'foo.ts');
    const result = resolveImportPath('./mydir', fromFile);
    expect(result).toBe(indexFile);
  });

  it('resolves relative import to index.js in directory', async () => {
    const subDir = path.join(tmpDir, 'mydir');
    await fs.mkdir(subDir);
    const indexFile = path.join(subDir, 'index.js');
    await fs.writeFile(indexFile, 'module.exports = {};');

    const fromFile = path.join(tmpDir, 'foo.ts');
    const result = resolveImportPath('./mydir', fromFile);
    expect(result).toBe(indexFile);
  });

  it('resolves parent-relative import', async () => {
    const subDir = path.join(tmpDir, 'sub');
    await fs.mkdir(subDir);
    const targetFile = path.join(tmpDir, 'bar.ts');
    await fs.writeFile(targetFile, 'export const x = 1;');

    const fromFile = path.join(subDir, 'foo.ts');
    const result = resolveImportPath('../bar', fromFile);
    expect(result).toBe(targetFile);
  });

  it('returns null when target file does not exist', () => {
    const fromFile = path.join(tmpDir, 'foo.ts');
    const result = resolveImportPath('./nonexistent', fromFile);
    expect(result).toBeNull();
  });

  it('resolves import with .mjs extension', async () => {
    const targetFile = path.join(tmpDir, 'mod.mjs');
    await fs.writeFile(targetFile, 'export const x = 1;');

    const fromFile = path.join(tmpDir, 'foo.ts');
    const result = resolveImportPath('./mod.mjs', fromFile);
    expect(result).toBe(targetFile);
  });

  it('resolves import with .cjs extension', async () => {
    const targetFile = path.join(tmpDir, 'mod.cjs');
    await fs.writeFile(targetFile, 'module.exports = {};');

    const fromFile = path.join(tmpDir, 'foo.ts');
    const result = resolveImportPath('./mod.cjs', fromFile);
    expect(result).toBe(targetFile);
  });

  it('resolves import with .jsx extension', async () => {
    const targetFile = path.join(tmpDir, 'comp.jsx');
    await fs.writeFile(targetFile, 'export default function() { return null; }');

    const fromFile = path.join(tmpDir, 'app.ts');
    const result = resolveImportPath('./comp', fromFile);
    expect(result).toBe(targetFile);
  });
});

/**
 * ─── runImportCheck ────────────────────────────────────────────────────────────
 */
describe('runImportCheck', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-check-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns pass when all relative imports resolve within project', async () => {
    // Create project structure
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir);

    const barFile = path.join(srcDir, 'bar.ts');
    await fs.writeFile(barFile, 'export const x = 1;');

    const fooFile = path.join(srcDir, 'foo.ts');
    await fs.writeFile(fooFile, `import { x } from './bar';\nconsole.log(x);\n`);

    const result = await runImportCheck([fooFile], tmpDir, 30000);
    expect(result.status).toBe('pass');
    expect(result.violations).toEqual([]);
  });

  it('returns fail when import resolves outside project root (original bug)', async () => {
    // Simulate the original bug: a deeply nested file imports a path that
    // resolves outside the project root. From pkg/dist/sub/, the import
    // ../../../../outside escapes tmpDir (the project root).
    const nestedDir = path.join(tmpDir, 'pkg', 'dist', 'sub');
    await fs.mkdir(nestedDir, { recursive: true });

    const badFile = path.join(nestedDir, 'file.ts');
    await fs.writeFile(
      badFile,
      `import { x } from '../../../../outside';\n`
    );

    const result = await runImportCheck([badFile], tmpDir, 30000);
    expect(result.status).toBe('fail');
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0].reason).toMatch(/escapes|outside|boundary/i);
  });

  it('returns fail when imported file does not exist', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir);

    const fooFile = path.join(srcDir, 'foo.ts');
    await fs.writeFile(fooFile, `import { x } from './nonexistent';\n`);

    const result = await runImportCheck([fooFile], tmpDir, 30000);
    expect(result.status).toBe('fail');
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0].reason).toMatch(/not found|does not exist|missing/i);
  });

  it('returns pass when only bare npm imports are used', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir);

    const fooFile = path.join(srcDir, 'foo.ts');
    await fs.writeFile(
      fooFile,
      `import path from 'path';\nimport fs from 'node:fs';\nimport _ from 'lodash';\n`
    );

    const result = await runImportCheck([fooFile], tmpDir, 30000);
    expect(result.status).toBe('pass');
    expect(result.violations).toEqual([]);
  });

  it('returns pass when no changed files are provided', async () => {
    const result = await runImportCheck([], tmpDir, 30000);
    expect(result.status).toBe('pass');
    expect(result.violations).toEqual([]);
  });

  it('checks multiple changed files', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir);

    const barFile = path.join(srcDir, 'bar.ts');
    await fs.writeFile(barFile, 'export const x = 1;');

    const goodFile = path.join(srcDir, 'good.ts');
    await fs.writeFile(goodFile, `import { x } from './bar';\n`);

    const badFile = path.join(srcDir, 'bad.ts');
    await fs.writeFile(badFile, `import { y } from './missing';\n`);

    const result = await runImportCheck([goodFile, badFile], tmpDir, 30000);
    expect(result.status).toBe('fail');
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].file).toBe(badFile);
  });

  it('skips files that do not exist on disk', async () => {
    const result = await runImportCheck(['/nonexistent/file.ts'], tmpDir, 30000);
    expect(result.status).toBe('pass');
    expect(result.violations).toEqual([]);
  });

  it('reports correct line number for violation', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir);

    const fooFile = path.join(srcDir, 'foo.ts');
    await fs.writeFile(
      fooFile,
      [`const x = 1;`, `const y = 2;`, `import { z } from './missing';`, `console.log(x, y);`].join('\n')
    );

    const result = await runImportCheck([fooFile], tmpDir, 30000);
    expect(result.status).toBe('fail');
    expect(result.violations[0].line).toBe(3);
  });

  it('handles import with explicit .js extension resolving to .ts', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir);

    const barFile = path.join(srcDir, 'bar.ts');
    await fs.writeFile(barFile, 'export const x = 1;');

    const fooFile = path.join(srcDir, 'foo.ts');
    await fs.writeFile(fooFile, `import { x } from './bar.js';\n`);

    const result = await runImportCheck([fooFile], tmpDir, 30000);
    expect(result.status).toBe('pass');
    expect(result.violations).toEqual([]);
  });

  it('includes durationMs in result', async () => {
    const result = await runImportCheck([], tmpDir, 30000);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('includes message in result', async () => {
    const result = await runImportCheck([], tmpDir, 30000);
    expect(typeof result.message).toBe('string');
  });
});
