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

// Named timeout for the runImportCheck calls that assert verdicts; keeps the
// Boy Scout magic-number count from growing with each new test case.
const IMPORT_CHECK_TIMEOUT_MS = 30000;

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

  /**
   * Issue #759 — import TEXT that is not import CODE.
   *
   * Every case below is a shape that a real project contains on purpose (a test
   * pinning a scanner's own behaviour, a doc block, a parser fixture) and that
   * the scanner used to report as a violation for a path that never existed.
   * Eight of these eleven were reproduced in dialog-survey, where they blocked
   * pushes.
   *
   * The fixture strings are built with template literals so the nesting is
   * visible; `BS` keeps a literal backslash unambiguous, because writing `\\'`
   * inside a template literal silently yields just `'` and turns the test into
   * one that passes against the bug.
   */
  describe('ignores import text inside strings, templates and comments (#759)', () => {
    const BS = String.fromCharCode(92);
    // Built from a code point so a backtick in the fixture cannot end the
    // surrounding template literal by accident (same trap as `BS` above).
    const BT = String.fromCharCode(96);

    it('ignores import text inside a double-quoted string', () => {
      const content = `const x = "import foo from './missing';";`;
      expect(extractImports(content)).toEqual([]);
    });

    it('ignores import text inside a single-quoted string', () => {
      const content = `const x = 'import foo from "./missing";';`;
      expect(extractImports(content)).toEqual([]);
    });

    it('ignores require() text inside a string', () => {
      const content = `const x = "require('./missing')";`;
      expect(extractImports(content)).toEqual([]);
    });

    it('ignores dynamic import text inside a string', () => {
      const content = `const x = "import('./missing')";`;
      expect(extractImports(content)).toEqual([]);
    });

    it('ignores export-from text inside a string', () => {
      const content = `const x = "export * from './missing'";`;
      expect(extractImports(content)).toEqual([]);
    });

    it('ignores import text inside a single-line template literal', () => {
      const content = "const x = `import foo from './missing';`;";
      expect(extractImports(content)).toEqual([]);
    });

    it('ignores import text inside a multi-line template literal', () => {
      const content = "const x = `\nimport foo from './missing';\n`;";
      expect(extractImports(content)).toEqual([]);
    });

    it('ignores import text inside a trailing line comment', () => {
      const content = `const y = 1; // import foo from './missing';`;
      expect(extractImports(content)).toEqual([]);
    });

    it('ignores import text inside a block comment', () => {
      const content = `/* import foo from './missing'; */`;
      expect(extractImports(content)).toEqual([]);
    });

    it('ignores import text inside JSDoc', () => {
      const content = `/**\n * import foo from './missing';\n */`;
      expect(extractImports(content)).toEqual([]);
    });

    /**
     * The other half of a comment: that it ENDS.
     *
     * The two cases above only prove text INSIDE a comment is ignored. A masker
     * that never leaves block-comment mode keeps both green while swallowing
     * every real import after the closing delimiter — found by mutation: making
     * the closing check unreachable survived all 58 tests. These pin the resume.
     */
    it('resumes scanning after a block comment closes', () => {
      const content = `/* import gone from './missing'; */\nimport real from './real';`;
      expect(extractImports(content)).toEqual([{ path: './real', line: 2 }]);
    });

    it('resumes scanning after a JSDoc block closes', () => {
      const content = `/**\n * import gone from './missing';\n */\nimport real from './real';`;
      expect(extractImports(content)).toEqual([{ path: './real', line: 4 }]);
    });

    it('resumes scanning after a line comment ends at the newline', () => {
      const content = `// import gone from './missing';\nimport real from './real';`;
      expect(extractImports(content)).toEqual([{ path: './real', line: 2 }]);
    });

    it('still treats a template interpolation as code', () => {
      const content = "const x = `${import('./real')}`;";
      expect(extractImports(content)).toEqual([{ path: './real', line: 1 }]);
    });

    /**
     * Nested interpolations must return to the INNER template, not to code.
     *
     * A single integer depth counter cannot express that: on entering the inner
     * `${`, assigning (instead of pushing) made the inner `}` look like the
     * close of the outer one, so the masker stayed in template mode and every
     * real import after the line was masked. Measured against the counter
     * version, `extractImports` returned `[]` for the case below.
     */
    it('stays aligned through a nested template interpolation', () => {
      const Q = BT;
      const content =
        'const a = ' + Q + '${' + Q + '${x}' + Q + '}' + Q + ';\n' +
        "import real from './real';\n";
      expect(extractImports(content)).toEqual([{ path: './real', line: 2 }]);
    });

    it('stays aligned through nested interpolation containing an import', () => {
      const Q = BT;
      const content =
        'const a = ' + Q + '${' + Q + '${import("./inner")}' + Q + '}' + Q + ';\n' +
        "import real from './real';\n";
      // The inner import is inside code (an interpolation), so it counts; the
      // outer import must survive the nesting too.
      expect(extractImports(content)).toEqual([
        { path: './inner', line: 1 },
        { path: './real', line: 2 },
      ]);
    });

    /**
     * A regex literal that contains `//` used to open a phantom line comment.
     * The masker does not parse regex literals (documented limitation), but a
     * line holding both a URL-ish regex and a real import must not lose the
     * import. The `/` of `//` inside a regex is escaped in real code, and an
     * unescaped `//` in a regex is a syntax error, so the remaining risk is
     * confined to generated/minified text — pinned here so it stays a KNOWN
     * limitation rather than an untested assumption.
     */
    it('keeps a real import on the same line as a regex literal', () => {
      const content = 'const re = /(?:a)/; import real from "./real";\n';
      expect(extractImports(content)).toEqual([{ path: './real', line: 1 }]);
    });

    /**
     * A line that STARTS with a comment can still carry a real import.
     *
     * The original guard asked `trimmed.startsWith('/*')` on the raw line and
     * skipped the whole line, so `/* eslint-disable *&#47; import real from ...`
     * was never scanned — a MISS, which is the one direction a compliance gate
     * must not fail in. Measured before the fix: `[]`.
     */
    it('keeps an import that follows a leading block comment', () => {
      const content = '/* eslint-disable */ import real from "./real";\n';
      expect(extractImports(content)).toEqual([{ path: './real', line: 1 }]);
    });

    it('still ignores import text that is only a comment', () => {
      const content = '/* import fake from "./fake" */\n';
      expect(extractImports(content)).toEqual([]);
    });

    it('still ignores import text on a JSDoc continuation line', () => {
      const content = ' * import fake from "./fake"\n';
      expect(extractImports(content)).toEqual([]);
    });

    /**
     * A static import whose path sits on a LATER line. Multi-line imports are
     * ordinary formatting, and a strictly per-line scan misses them entirely —
     * measured `[]` before joining, which is a MISS in the direction that
     * matters (a real boundary violation would not be reported).
     */
    it('finds an import whose path is on a continuation line', () => {
      const content = 'import {\n  foo,\n} from "./bar";\n';
      expect(extractImports(content)).toEqual([{ path: './bar', line: 1 }]);
    });

    it('does not double-report a multi-line import, and keeps the next line', () => {
      const content = 'import {\n  a,\n} from "./b";\nimport c from "./c";\n';
      expect(extractImports(content)).toEqual([
        { path: './b', line: 1 },
        { path: './c', line: 4 },
      ]);
    });

    it('finds a dynamic import written with a space before the paren', () => {
      // `import ('./x')` is legal and appears in formatted code; the pattern
      // required `import(` exactly and measured `[]`.
      const content = "const m = import ('./x');\n";
      expect(extractImports(content)).toEqual([{ path: './x', line: 1 }]);
    });

    it('does not report import.meta as a dynamic import', () => {
      const content = 'const u = import.meta.url;\n';
      expect(extractImports(content)).toEqual([]);
    });

    /**
     * KNOWN LIMITATION, pinned so it cannot drift unnoticed.
     *
     * A quote inside a regex literal opens a phantom string. Measured output for
     * the fixture below is `[{ path: './fake', line: 2 }]`: the import text
     * inside the real string is reported as if it were code, and the genuine
     * import on line 3 is missed. Both directions, which is why the masker's
     * header no longer claims "can only cause a MISS".
     *
     * It is tolerable because a regex holding an unescaped quote is a SYNTAX
     * ERROR — no file that parses can contain line 1. This test exists to make
     * that reasoning explicit: if it ever starts failing differently, the
     * limitation changed and the header comment must be re-measured.
     */
    it('documents the regex-quote limitation instead of pretending it cannot happen', () => {
      const SQ = String.fromCharCode(39);
      const DQ = String.fromCharCode(34);
      const content =
        'const re = /' + SQ + '/;\n' +
        'const s = ' + DQ + 'import x from ' + SQ + './fake' + SQ + DQ + ';\n' +
        'import real from ' + DQ + './real' + DQ + ';\n';
      expect(extractImports(content)).toEqual([{ path: './fake', line: 2 }]);
    });

    it('keeps line numbers truthful across a line continuation', () => {
      // A backslash immediately followed by a newline is a legal continuation
      // inside a string literal. Masking it as a plain space deleted a line, so
      // an import on line 3 was reported as line 2 — measured against the
      // version that emitted a space for the newline.
      const NL = String.fromCharCode(10);
      const content =
        "const s = 'aaa" + BS + NL + "bbb';" + NL +
        "import real from './real';" + NL;
      expect(extractImports(content)).toEqual([{ path: './real', line: 3 }]);
    });

    it('resumes scanning after an unterminated-looking line comment', () => {
      const content = "const u = 'http://x'; import real from './real';\n";
      // The `//` sits inside a string, so it is text — the import is real code.
      expect(extractImports(content)).toEqual([{ path: './real', line: 1 }]);
    });

    it('does not end a string early on an escaped quote', () => {
      const content = `const x = 'it${BS}'s import foo from "./missing"';`;
      expect(extractImports(content)).toEqual([]);
    });

    it('does not end a string early on an escaped double quote', () => {
      const content = `const x = "say ${BS}"hi import foo from './missing'";`;
      expect(extractImports(content)).toEqual([]);
    });

    it('reports the real import on a line that also holds import text', () => {
      const content = [
        `import real from './real';`,
        `const doc = "import fake from './fake';";`,
      ].join('\n');
      expect(extractImports(content)).toEqual([{ path: './real', line: 1 }]);
    });
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

  it('passes when projectRoot spelling differs in drive case/slashes (Windows, #508)', async () => {
    // git rev-parse --show-toplevel reports "D:/repo" while path.resolve of a
    // repo-relative changed file inherits process.cwd()'s "d:\repo" drive case.
    // The case-sensitive startsWith judged every import as boundary-escaping,
    // blocking any TS-bearing push. The same root spelled the other way must
    // pass on Windows; drive letters do not exist on POSIX so skip there.
    if (process.platform !== 'win32') return;

    let fooFile: string;
    try {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir);

      const barFile = path.join(srcDir, 'bar.ts');
      await fs.writeFile(barFile, 'export const x = 1;');

      fooFile = path.join(srcDir, 'foo.ts');
      await fs.writeFile(fooFile, `import { x } from './bar';\nconsole.log(x);\n`);
    } catch (error) {
      throw new Error(`Fixture setup failed: ${error}`);
    }

    const altRoot = tmpDir.replace(/\\/g, '/').replace(/^[a-zA-Z]:/, (m) => m.toLowerCase());
    expect(altRoot).not.toBe(tmpDir);

    const result = await runImportCheck([fooFile], altRoot, IMPORT_CHECK_TIMEOUT_MS);
    expect(result.status).toBe('pass');
    expect(result.violations).toEqual([]);
  });

  it('still fails a true boundary escape after case normalization (#508 follow-up)', async () => {
    // Normalization must only absorb case/spelling differences, never widen the
    // boundary: an import that genuinely leaves the project root keeps failing
    // even when the root is spelled with a different drive-letter case.
    if (process.platform !== 'win32') return;

    let badFile: string;
    try {
      const nestedDir = path.join(tmpDir, 'pkg', 'dist', 'sub');
      await fs.mkdir(nestedDir, { recursive: true });

      badFile = path.join(nestedDir, 'file.ts');
      await fs.writeFile(badFile, `import { x } from '../../../../outside';\n`);
    } catch (error) {
      throw new Error(`Fixture setup failed: ${error}`);
    }

    const altRoot = tmpDir.replace(/\\/g, '/').replace(/^[a-zA-Z]:/, (m) => m.toLowerCase());

    const result = await runImportCheck([badFile], altRoot, IMPORT_CHECK_TIMEOUT_MS);
    expect(result.status).toBe('fail');
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0].reason).toMatch(/escapes|outside|boundary/i);
  });

  it('skips YAML files containing JavaScript-like require text', async () => {
    const workflowDir = path.join(tmpDir, '.github', 'workflows');
    await fs.mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'cross-platform-ci.yml');
    await fs.writeFile(workflowFile, `run: node -e "require('../test')"\n`);

    const result = await runImportCheck([workflowFile], tmpDir, 30000);
    expect(result.status).toBe('pass');
    expect(result.violations).toEqual([]);
  });

  it('still reports missing relative imports in supported JavaScript modules', async () => {
    const sourceFile = path.join(tmpDir, 'source.mjs');
    await fs.writeFile(sourceFile, `import './missing.js';\n`);

    const result = await runImportCheck([sourceFile], tmpDir, 30000);
    expect(result.status).toBe('fail');
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].importPath).toBe('./missing.js');
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
