import { describe, it, expect, vi } from 'vitest';
import { CppAdapter } from '../cpp';

type MockFunction = Record<string, unknown>;

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

describe('CppAdapter', () => {
  
  it('should implement the Adapter interface', () => {
    (readFileSync as vi.Mock).mockReturnValue('int main() { return 0; }');
    const adapter = new CppAdapter('test.cpp');
    
    expect(adapter).toHaveProperty('detectLanguage');
    expect(adapter).toHaveProperty('parseAST');
    expect(adapter).toHaveProperty('extractFunctions');
    expect(adapter).toHaveProperty('extractClasses');
    expect(adapter).toHaveProperty('countLines');
  });

  it('should detect language as cpp for .cpp files', () => {
    (readFileSync as vi.Mock).mockReturnValue('int main() { return 0; }');
    const adapter = new CppAdapter('test.cpp');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('cpp');
  });

  it('should detect language as cpp for .cxx files', () => {
    (readFileSync as vi.Mock).mockReturnValue('int main() { return 0; }');
    const adapter = new CppAdapter('test.cxx');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('cpp');
  });

  it('should detect language as cpp for .cc files', () => {
    (readFileSync as vi.Mock).mockReturnValue('int main() { return 0; }');
    const adapter = new CppAdapter('test.cc');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('cpp');
  });

  it('should detect language as cpp for .c files', () => {
    (readFileSync as vi.Mock).mockReturnValue('int main() { return 0; }');
    const adapter = new CppAdapter('test.c');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('cpp');
  });

  it('should detect language as cpp for .hpp files', () => {
    (readFileSync as vi.Mock).mockReturnValue('#pragma once');
    const adapter = new CppAdapter('test.hpp');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('cpp');
  });

  it('should detect language as cpp for .h files', () => {
    (readFileSync as vi.Mock).mockReturnValue('#pragma once');
    const adapter = new CppAdapter('test.h');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('cpp');
  });

  it('should parse C++ file AST correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue('int main() { return 0; }');
    const adapter = new CppAdapter('test.cpp');
    const ast = adapter.parseAST();
    expect(ast).toHaveProperty('content');
    expect(ast).toHaveProperty('language');
    expect(ast).toHaveProperty('filePath');
    expect(ast.language).toBe('cpp');
  });

  it('should extract functions from C++ code', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
int add(int a, int b) {
  return a + b;
}

int main() {
  return add(1, 2);
}
`);
    const adapter = new CppAdapter('test.cpp');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as MockFunction).name === 'main')).toBe(true);
  });

  it('should handle C++ strings with special characters', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
int main() {
  const char* str = "Hello \\"World\\"";
  char c = '\\'';
  return 0;
}
`);
    
    const adapter = new CppAdapter('test.cpp');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as {name: string}).name === 'main')).toBe(true);
  });
  
  it('should throw error when file cannot be read', () => {
    (readFileSync as vi.Mock).mockImplementation(() => {
      throw new Error('Could not read file');
    });
    
    expect(() => {
      new CppAdapter('nonexistent-file.cpp');
    }).toThrow('Could not read file:');
  });
});

/**
 * @test REQ-COV-004 CppAdapter extractCodeBlock branch coverage
 * @intent Verify block-comment handling and nested-brace counting inside extractCodeBlock
 * @covers AC-COV-004
 */
describe('CppAdapter - extractCodeBlock edge cases', () => {
  it('should skip single-line block comment before the opening brace', () => {
    const src = `int foo() /* inline comment */ { return 1; }`;
    (readFileSync as vi.Mock).mockReturnValue(src);
    const adapter = new CppAdapter('test.cpp');
    const block = adapter.extractCodeBlock(0);
    expect(block).toContain('{ return 1; }');
    expect(block.endsWith('}')).toBe(true);
  });

  it('should skip multi-line block comment spanning multiple lines', () => {
    const src = [
      'int foo()',
      '/* this is a',
      '   multi-line block',
      '   comment */',
      '{',
      '  return 42;',
      '}',
    ].join('\n');
    (readFileSync as vi.Mock).mockReturnValue(src);
    const adapter = new CppAdapter('test.cpp');
    const block = adapter.extractCodeBlock(0);
    expect(block).toContain('return 42;');
    expect(block.trim().endsWith('}')).toBe(true);
  });

  it('should ignore braces inside block comments', () => {
    const src = `int foo() /* fake { brace } here */ { return 7; }`;
    (readFileSync as vi.Mock).mockReturnValue(src);
    const adapter = new CppAdapter('test.cpp');
    const block = adapter.extractCodeBlock(0);
    expect(block).toContain('return 7;');
    expect(block.trim().endsWith('}')).toBe(true);
  });

  it('should count nested braces correctly via braceCount++ path', () => {
    const src = `void foo() { if (x) { return; } }`;
    (readFileSync as vi.Mock).mockReturnValue(src);
    const adapter = new CppAdapter('test.cpp');
    const block = adapter.extractCodeBlock(0);
    expect(block).toBe('void foo() { if (x) { return; } }');
  });

  it('should handle deeply nested braces (triple nesting)', () => {
    const src = `int bar() { if (a) { while (b) { c++; } } return 0; }`;
    (readFileSync as vi.Mock).mockReturnValue(src);
    const adapter = new CppAdapter('test.cpp');
    const block = adapter.extractCodeBlock(0);
    expect(block.trim().endsWith('}')).toBe(true);
    expect(block).toContain('c++;');
    const opens = (block.match(/\{/g) || []).length;
    const closes = (block.match(/\}/g) || []).length;
    expect(opens).toBe(closes);
  });

  it('should combine block comments and nested braces in same body', () => {
    const src = [
      'int compute() {',
      '  /* outer block comment',
      '     with text { and } symbols */',
      '  if (a) {',
      '    /* nested comment */',
      '    return 1;',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');
    (readFileSync as vi.Mock).mockReturnValue(src);
    const adapter = new CppAdapter('test.cpp');
    const block = adapter.extractCodeBlock(0);
    expect(block.trim().endsWith('}')).toBe(true);
    expect(block).toContain('return 1;');
    expect(block).toContain('return 0;');
  });

  it('should skip line comments (// ...) before brace', () => {
    const src = [
      'int foo() {',
      '  // line comment with { fake brace }',
      '  return 5;',
      '}',
    ].join('\n');
    (readFileSync as vi.Mock).mockReturnValue(src);
    const adapter = new CppAdapter('test.cpp');
    const block = adapter.extractCodeBlock(0);
    expect(block).toContain('return 5;');
    expect(block.trim().endsWith('}')).toBe(true);
  });

  it('should extract constructors with member initializer lists', () => {
    const src = [
      'class Foo {',
      'public:',
      '  Foo(int x) : value_(x) {',
      '    init();',
      '  }',
      'private:',
      '  int value_;',
      '};',
    ].join('\n');
    (readFileSync as vi.Mock).mockReturnValue(src);
    const adapter = new CppAdapter('test.cpp');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as { type: string }).type === 'constructor')).toBe(true);
  });

  it('should extract classes from C++ source', () => {
    const src = [
      'class MyClass {',
      'public:',
      '  void doStuff() { return; }',
      '};',
      'struct MyStruct : public Base {',
      '  int x;',
      '};',
    ].join('\n');
    (readFileSync as vi.Mock).mockReturnValue(src);
    const adapter = new CppAdapter('test.cpp');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.length).toBeGreaterThanOrEqual(2);
    expect(classes.some(c => (c as { name: string }).name === 'MyClass')).toBe(true);
    expect(classes.some(c => (c as { name: string }).name === 'MyStruct')).toBe(true);
  });

  it('should count lines correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue('line1\nline2\nline3');
    const adapter = new CppAdapter('test.cpp');
    expect(adapter.countLines()).toBe(3);
  });

  it('should fall back to super.detectLanguage for non-cpp extensions', () => {
    (readFileSync as vi.Mock).mockReturnValue('content');
    const adapter = new CppAdapter('test.txt');
    expect(adapter.detectLanguage()).toBe('unknown');
  });

  it('should extract functions correctly when source has block comments and nested braces', () => {
    const src = [
      '/* file header comment */',
      'int outer(int x) {',
      '  /* explain logic */',
      '  if (x > 0) {',
      '    return x;',
      '  }',
      '  return -x;',
      '}',
    ].join('\n');
    (readFileSync as vi.Mock).mockReturnValue(src);
    const adapter = new CppAdapter('test.cpp');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as { name: string }).name === 'outer')).toBe(true);
  });
});
