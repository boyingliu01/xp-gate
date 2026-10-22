/**
 * @test REQ-565 `xp-gate principles <dir>` must examine the files in the directory
 * @intent `principles()` forwarded its target straight to
 *         `principles-checker --files <target>`, and the checker only accepts
 *         FILE paths — a directory matches no adapter extension and is dropped
 *         without a word. The reported result was therefore:
 *
 *             ✓ No violations found
 *             Files checked: 0            <-- and exit code 0
 *
 *         which is indistinguishable from a directory that genuinely has no
 *         violations. The CLI's own usage string advertises
 *         `<file_or_directory>`, so the directory form is not an unsupported
 *         extra — it is the documented one, silently doing nothing.
 *
 *         This is the same defect class as #561 and #563: a gate that reports
 *         success for work it never performed. Expanding the directory belongs
 *         in the CLI layer because that is where the `<file_or_directory>`
 *         contract is declared; the checker's file-list contract is correct.
 * @covers AC-565-01, AC-565-02, AC-565-03
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const { expandTargets } = require('../principles');

let TMP;

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'principles-expand-'));
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

/**
 * Write a file inside the temp tree.
 * @param {string} rel - path relative to TMP
 * @param {string} content - file body
 */
function touch(rel, content) {
  const abs = path.join(TMP, rel);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`fixture setup failed writing ${rel}: ${msg}`);
  }
}

describe('principles directory expansion', () => {
  test('AC-565-01: a directory target expands to the source files inside it', () => {
    touch('src/a.ts', 'export const a = 1;\n');
    touch('src/b.js', 'module.exports = 1;\n');
    touch('src/nested/c.ts', 'export const c = 2;\n');
    touch('src/readme.md', 'not source\n');
    touch('src/skip.test.ts', '// test file\n');

    const out = expandTargets([path.join(TMP, 'src')]);

    const names = out.map(p => path.relative(TMP, p).replace(/\\/g, '/')).sort();
    expect(names).toEqual(['src/a.ts', 'src/b.js', 'src/nested/c.ts']);
  });

  test('AC-565-02: a file target is passed through untouched', () => {
    // The file form already worked; expanding must not disturb it.
    const file = path.join(TMP, 'single.ts');
    touch('single.ts', 'export const x = 1;\n');

    expect(expandTargets([file])).toEqual([file]);
  });

  test('AC-565-03: a directory with no source files yields an empty list, not the directory', () => {
    // The caller must be able to see "nothing to check" and say so, rather than
    // hand the checker a directory that silently matches nothing.
    fs.mkdirSync(path.join(TMP, 'empty'), { recursive: true });
    touch('empty/notes.txt', 'hi\n');

    const out = expandTargets([path.join(TMP, 'empty')]);

    expect(out).toEqual([]);
    expect(out).not.toContain(path.join(TMP, 'empty'));
  });
});
