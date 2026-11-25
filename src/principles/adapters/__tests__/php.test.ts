/**
 * @test REQ-731-PHP-ADAPTER
 * @intent The principles engine must actually inspect PHP. `gate-4.sh` accepting
 *   `.php` while `analyzer.ts`'s adapterMap has no entry is the #717 shape: the
 *   file is accepted by the filter and then inspected by nobody, which reads as
 *   "Gate 4 ran and found nothing".
 * @covers AC-731-PHP-ADAPTER-01, AC-731-PHP-ADAPTER-02
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { PhpAdapter, stripPhpLiterals } from '../php';
import { getAdapterForFile } from '../../analyzer';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

/** Build an adapter over a fixed source string. */
function adapterFor(filePath: string, source: string): PhpAdapter {
  (readFileSync as Mock).mockReturnValue(source);
  return new PhpAdapter(filePath);
}

describe('PhpAdapter', () => {
  it('implements the full Adapter interface', () => {
    const adapter = adapterFor('a.php', '<?php');
    for (const method of ['detectLanguage', 'parseAST', 'extractFunctions', 'extractClasses', 'countLines']) {
      expect(adapter).toHaveProperty(method);
    }
  });

  it('detects php for .php and .phtml', () => {
    expect(adapterFor('a.php', '<?php').detectLanguage()).toBe('php');
    expect(adapterFor('t.phtml', '<?php').detectLanguage()).toBe('php');
  });

  it('is the adapter the analyzer actually resolves (.php is in adapterMap)', () => {
    // The assertion that would have caught the real defect: a filter that accepts
    // .php plus a map without it yields null here, and Gate 4 reports a clean run
    // over files it never opened.
    expect(getAdapterForFile('src/Calc.php')).toBeInstanceOf(PhpAdapter);
    expect(getAdapterForFile('src/Calc.phtml')).toBeInstanceOf(PhpAdapter);
  });

  it('extracts free functions, methods and constructors', () => {
    const src = [
      '<?php',
      'function topLevel(int $a): int { return $a; }',
      'final class Calc {',
      '    public function add(int $a, int $b): int { return $a + $b; }',
      '    public static function make(): self { return new self(); }',
      '    public function __construct() {}',
      '}',
    ].join('\n');
    const names = (adapterFor('a.php', src).extractFunctions() as Array<{ name: string }>).map((m) => m.name);
    expect(names).toContain('topLevel');
    expect(names).toContain('add');
    expect(names).toContain('make');
    expect(names).toContain('__construct');
  });

  it('does not attribute a closure binding to a function name', () => {
    // `$fn = function () { ... }` has no declaration name; reporting one would
    // blame a variable the rules cannot reason about.
    const src = '<?php\n$fn = function (int $a): int { return $a; };\n';
    const names = (adapterFor('a.php', src).extractFunctions() as Array<{ name: string }>).map((m) => m.name);
    expect(names).toEqual([]);
  });

  it('extracts class, interface, trait and enum declarations distinctly', () => {
    const src = [
      '<?php',
      'class A extends B {}',
      'interface I {}',
      'trait T {}',
      'enum E {}',
    ].join('\n');
    const found = adapterFor('a.php', src).extractClasses() as Array<{ name: string; type: string }>;
    const byName = Object.fromEntries(found.map((c) => [c.name, c.type]));
    expect(byName.A).toBe('class');
    expect(byName.I).toBe('interface');
    expect(byName.T).toBe('trait');
    expect(byName.E).toBe('enum');
  });

  it('does not treat a by-reference return function as a different name', () => {
    const src = '<?php\nfunction &refReturn(array &$a) { return $a; }\n';
    const names = (adapterFor('a.php', src).extractFunctions() as Array<{ name: string }>).map((m) => m.name);
    expect(names).toContain('refReturn');
  });

  /**
   * `length` must be the FUNCTION's own line count.
   *
   * Regression: `extractCodeBlock` used to take the LAST zero-crossing of the
   * brace scan, which for a method inside a class is the CLASS's closing brace.
   * Every method therefore reported "start line .. end of file", so helpers of
   * three lines were reported as 70+ lines and every PHP file with more than 50
   * lines produced unfixable `clean-code.long-function` warnings.
   */
  /**
   * `stripPhpLiterals` must return a string of EXACTLY the same length.
   *
   * The whole brace scan depends on it: `extractCodeBlock` computes positions on
   * the blanked view and then slices the ORIGINAL text with them. Two separate
   * off-by-ones broke that contract:
   *
   *   1. `blankBlockComment` advanced past `*` but stopped on `/`, and
   *   2. `stripPhpLiterals` resumed at `last` although its own `i++` then ran.
   *
   * Each dropped one character per literal, so every position after the first
   * literal drifted left. Measured on a 30,587-byte file: 181 bytes short, which
   * made a 9-line method span 113 lines.
   */
  describe('stripPhpLiterals preserves length', () => {
    const cases: Array<[string, string]> = [
      ['line comment', '<?php\n$x = 1; // hello\n$y = 2;\n'],
      ['block comment', '<?php\n/* hi */\n$x = 1;\n'],
      ['multi-line docblock', '<?php\n/**\n * Doc.\n */\nclass A {}\n'],
      ['single-quoted string', "<?php\n$x = 'abc';\n"],
      ['double-quoted string', '<?php\n$x = "abc";\n'],
      ['escaped quote', "<?php\n$x = 'it\\'s';\n"],
      ['heredoc', '<?php\n$x = <<<EOT\nabc\nEOT;\n$y = 1;\n'],
      ['each form together', '<?php\n/* a */\n$x = "b"; // c\n$y = \'d\';\n'],
    ];

    for (const [name, src] of cases) {
      it(`keeps the byte length for ${name}`, () => {
        expect(stripPhpLiterals(src)).toHaveLength(src.length);
      });
    }

    it('keeps the byte length on a file with many docblocks', () => {
      const src = Array.from({ length: 20 }, (_, i) =>
        [`    /**\n     * Method ${i}.\n     */`, `    public function m${i}() { return ${i}; }`].join('\n'),
      ).join('\n');
      const file = ['<?php', 'class A {', src, '}'].join('\n');
      expect(stripPhpLiterals(file)).toHaveLength(file.length);
    });
  });

  describe('length is the function body, not the distance to EOF', () => {
    const lengths = (src: string, file = 'a.php') =>
      Object.fromEntries(
        (adapterFor(file, src).extractFunctions() as Array<{ name: string; length: number }>).map((f) => [
          f.name,
          f.length,
        ]),
      );

    it('reports each method separately, not the whole class', () => {
      const src = [
        '<?php',
        'class A {',
        '    public function first() { return 1; }',
        '    public function second() { return 2; }',
        '    public function third() { return 3; }',
        '}',
      ].join('\n');
      expect(lengths(src)).toEqual({ first: 1, second: 1, third: 1 });
    });

    it('keeps a method short when later methods make the file long', () => {
      // The trigger for the original defect: enough trailing methods that the
      // last zero-crossing is far from the method under inspection.
      const fillers = Array.from({ length: 60 }, (_, i) => `    public function filler${i}() { return ${i}; }`);
      const src = ['<?php', 'class A {', '    public function first() { return 1; }', ...fillers, '}'].join('\n');
      const found = lengths(src);
      expect(found.first).toBe(1);
      expect(found.filler59).toBe(1);
    });

    it('measures a multi-line method exactly', () => {
      const src = [
        '<?php',
        'class A {',
        '    public function multi() {',
        '        $a = 1;',
        '        $b = 2;',
        '        return $a + $b;',
        '    }',
        '}',
      ].join('\n');
      expect(lengths(src).multi).toBe(5);
    });

    it('is not confused by a heredoc containing braces', () => {
      // The reason "first crossing" was rejected originally. Literals are
      // blanked before the scan, so the heredoc's `{` never moves the depth.
      const src = [
        '<?php',
        'class A {',
        '    public function withHeredoc() {',
        '        $x = <<<EOT',
        '        { { {',
        '        if (1) { if (2) { } }',
        'EOT;',
        '        return $x;',
        '    }',
        '    public function after() { return 1; }',
        '}',
      ].join('\n');
      expect(lengths(src)).toEqual({ withHeredoc: 7, after: 1 });
    });
  });
});
