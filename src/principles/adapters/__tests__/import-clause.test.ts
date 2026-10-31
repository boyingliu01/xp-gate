/**
 * @test import-clause parsing
 * @intent The `imports` getter scores unused imports, so every symbol an import
 *         statement binds must be reported exactly once and under its LOCAL name.
 *         Splitting the clause grammar out of the getter makes each of the four
 *         TypeScript import shapes checkable on its own.
 * @covers AC-677-01, AC-677-02
 */
import { describe, it, expect } from 'vitest';
import { parseImportClause } from '../import-clause';

describe('parseImportClause', () => {
  it('AC-677-01: default binding', () => {
    expect(parseImportClause('React', false)).toEqual([{ name: 'React' }]);
  });

  it('AC-677-01: named bindings, including an `as` rename', () => {
    // The LOCAL name is what the unused-imports rule must look for; `Foo` is
    // never in scope after the rename.
    expect(parseImportClause('{ a, Foo as Bar }', false)).toEqual([
      { name: 'a' },
      { name: 'Bar' },
    ]);
  });

  it('AC-677-01: namespace binding', () => {
    expect(parseImportClause('* as path', false)).toEqual([{ name: 'path' }]);
  });

  it('AC-677-01: default plus named in one statement', () => {
    expect(parseImportClause('React, { useState }', false)).toEqual([
      { name: 'React' },
      { name: 'useState' },
    ]);
  });

  it('AC-677-02: `import type` marks every binding as type-only', () => {
    expect(parseImportClause('{ Foo, Bar }', true)).toEqual([
      { name: 'Foo', type: 'type' },
      { name: 'Bar', type: 'type' },
    ]);
  });

  it('AC-677-02: a per-member `type` modifier marks only that member', () => {
    expect(parseImportClause('{ type Foo, bar }', false)).toEqual([
      { name: 'Foo', type: 'type' },
      { name: 'bar' },
    ]);
  });

  it('AC-677-02: non-identifier names are dropped (anti-vacuity)', () => {
    // A malformed clause must not invent a symbol that would then be reported
    // as unused -- a phantom finding no edit could clear.
    expect(parseImportClause('{ "not-an-id": x }', false)).toEqual([]);
  });
});
