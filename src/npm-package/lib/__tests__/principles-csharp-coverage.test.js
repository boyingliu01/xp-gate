/**
 * @test REQ-758 `xp-gate principles <dir>` must reach every file the engine has an adapter for
 * @intent `principles.js` keeps its own literal `SOURCE_EXTENSIONS` because the file must
 *         stay loadable by plain Node with no transpile step. Its own comment said the
 *         list "Must match `getAdapterForFile`'s adapterMap" — and it did not.
 *         `analyzer.ts` registered `.cs` and `.csx` since #717, but this walk never
 *         offered those files to the checker, so a directory of C# sources reported
 *         `Files checked: 0`, which reads exactly like "no violations".
 *
 *         How the expected set is derived matters more than the assertion, because two
 *         weaker designs both shipped a guard that could pass while the defect lived:
 *
 *         1. A regex over analyzer.ts. Measured: changing `'.ts'` to `".ts"` — cosmetic,
 *            same semantics — dropped the parsed set from 21 to 20 and the test still
 *            passed. A guard that weakens under a legal refactor is the same "covered
 *            but cannot block" shape as the bug.
 *         2. A hand-written candidate list probed through `getAdapterForFile`. Measured:
 *            adding `.fs` to BOTH adapterMap and the walk left every test green, because
 *            the candidate list simply did not contain `.fs`.
 *
 *         So: parse `adapterMap` with the TypeScript compiler API (syntax-aware — key
 *         quoting, comments and line breaks do not change the result; verified against
 *         three cosmetic refactors), and separately confirm through `getAdapterForFile`
 *         that each such extension is genuinely analysable. No hand-maintained list
 *         bounds the expectation, so an extension added to the analyzer alone fails here
 *         by name.
 * @covers AC-758-01, AC-758-02, AC-758-03, AC-758-04, AC-758-05
 */
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const { collectSourceFiles } = require('../principles');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ANALYZER = path.join(REPO_ROOT, 'src', 'principles', 'analyzer.ts');

let TMP;
let getAdapterForFile;

beforeAll(async () => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'principles-csharp-'));
  const mod = await import(pathToFileURL(ANALYZER).href);
  getAdapterForFile = mod.getAdapterForFile;
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

/**
 * Keys of the `adapterMap` object literal in a TypeScript source string.
 *
 * Uses the compiler API rather than a regex so that formatting is irrelevant: quoted
 * any way, reordered, commented or reformatted, the key set is the same. Throws when
 * the map cannot be found at all — a silently empty result would make every assertion
 * below pass vacuously.
 *
 * @param {string} source - TypeScript source text
 * @returns {string[]} extensions including the leading dot
 */
function adapterMapKeys(source) {
  const sf = ts.createSourceFile('analyzer.ts', source, ts.ScriptTarget.Latest, true);
  const keys = [];
  /**
   * @param {import('typescript').Node} node
   */
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sf) === 'adapterMap' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (
          (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) &&
          prop.name &&
          ts.isStringLiteralLike(prop.name)
        ) {
          keys.push(prop.name.text);
          continue;
        }
        // A spread or a computed key would make this extraction return FEWER extensions
        // than the map really holds: the derived expectation shrinks, every assertion
        // still passes, and the guard quietly stops covering what it claims to cover.
        // That is the exact failure shape this file was written to prevent, so fail
        // loudly instead of under-reporting.
        if (ts.isSpreadAssignment(prop) || ts.isComputedPropertyName(prop.name)) {
          throw new Error(
            'adapterMap contains a spread or computed key, so this guard cannot derive ' +
              'the full extension set from it. Extend adapterMapKeys() rather than ' +
              'letting it silently under-report.',
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (keys.length === 0) {
    throw new Error('adapterMap not found (or holds no string keys) in analyzer.ts');
  }
  return keys;
}

describe('principles walk covers every language the engine has an adapter for', () => {
  test('AC-758-01: a .cs file in the target directory is offered to the checker', () => {
    touch('cs-only/Program.cs', 'namespace Aot { class P { static void Main() {} } }\n');

    const found = collectSourceFiles(path.join(TMP, 'cs-only'));

    expect(found.map(f => path.basename(f))).toContain('Program.cs');
  });

  test('AC-758-02: every extension in adapterMap is collected by the walk', () => {
    const expected = adapterMapKeys(fs.readFileSync(ANALYZER, 'utf8'));

    // The C# entries are what this file exists for; assert them explicitly so a
    // regression names the extension rather than just shrinking a count.
    expect(expected).toContain('.cs');
    expect(expected).toContain('.csx');

    for (const ext of expected) {
      touch(`all-ext/file${ext}`, '// fixture\n');
    }

    const names = new Set(
      collectSourceFiles(path.join(TMP, 'all-ext')).map(f => path.basename(f)),
    );

    const missing = expected
      .filter(ext => !names.has(`file${ext}`))
      .map(ext => `${ext} is registered in adapterMap but the walk never collected file${ext}`);

    expect(missing).toEqual([]);
  });

  test('AC-758-04: each adapterMap extension is genuinely analysable, not just listed', () => {
    // adapterMap could name an extension whose adapter is broken. Confirm through the
    // real entry point that a file with that extension produces an adapter at all.
    //
    // The function is asserted to BE a function first. Without that, a broken dynamic
    // import (interop change, undefined export) would make every probe throw a
    // TypeError, the catch below would swallow each one, `notAnalysable` would stay
    // empty, and this test would report success while asserting nothing. A guard that
    // goes green when its own instrument is missing is the defect class this file is
    // about.
    expect(typeof getAdapterForFile).toBe('function');

    const expected = adapterMapKeys(fs.readFileSync(ANALYZER, 'utf8'));
    const notAnalysable = [];
    let answered = 0;
    for (const ext of expected) {
      touch(path.join('analysable', `probe${ext}`), '// fixture\n');
      const abs = path.join(TMP, 'analysable', `probe${ext}`);
      try {
        const adapter = getAdapterForFile(abs);
        answered += 1;
        if (adapter === null) notAnalysable.push(ext);
      } catch (err) {
        // Adapters read their file in the constructor, so content the adapter rejects
        // still proves registration. Anything else (a TypeError from a missing
        // function) must not be mistaken for that, so the error type is checked.
        const name = err && err.constructor ? err.constructor.name : '';
        if (name === 'TypeError') throw err;
        if (!/Could not read file|ENOENT|parse/i.test(String(err && err.message))) throw err;
        answered += 1;
      }
    }
    // Every extension must have produced a real answer, otherwise the loop above
    // proved nothing.
    expect(answered).toBe(expected.length);
    expect(notAnalysable).toEqual([]);
  });

  test('AC-758-03: a directory of ONLY C# sources is not reported as empty', () => {
    touch('only-cs/Alpha.cs', 'class A {}\n');
    touch('only-cs/sub/Beta.cs', 'class B {}\n');

    const found = collectSourceFiles(path.join(TMP, 'only-cs'));

    expect(found.length).toBe(2);
    expect(found.map(f => path.basename(f)).sort()).toEqual(['Alpha.cs', 'Beta.cs']);
  });

  test('AC-758-05: .cs files survive upper/lower case variants, end to end', () => {
    // Both halves of the claim in the acceptance criterion, because either one alone
    // leaves the original symptom reachable:
    //  - the WALK must collect `Program.CS`, and
    //  - `getAdapterForFile` must accept it, since it lowercases the extension before
    //    lookup. If that normalisation regressed while the walk still collected the
    //    file, the adapter would be null, the file would be skipped, and a directory of
    //    all-uppercase C# would once again report Files checked: 0.
    touch('mixed-case/Upper.CS', 'class U {}\n');
    touch('mixed-case/Mixed.Cs', 'class M {}\n');

    const collected = collectSourceFiles(path.join(TMP, 'mixed-case'));
    const names = collected.map(f => path.basename(f));

    expect(names.sort()).toEqual(['Mixed.Cs', 'Upper.CS']);

    // The end-to-end half: every file the walk collected must also resolve to an
    // adapter, so "collected" cannot silently degrade into "collected then dropped".
    for (const file of collected) {
      expect(getAdapterForFile(file)).not.toBeNull();
    }
  });
});
