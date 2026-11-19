/**
 * @test REQ-731-PHP-ADAPTER
 * @intent The principles engine must actually inspect PHP. `gate-4.sh` accepting
 *   `.php` while `analyzer.ts`'s adapterMap has no entry is the #717 shape: the
 *   file is accepted by the filter and then inspected by nobody, which reads as
 *   "Gate 4 ran and found nothing".
 * @covers AC-731-PHP-ADAPTER-01, AC-731-PHP-ADAPTER-02
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { PhpAdapter } from '../php';
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
});
