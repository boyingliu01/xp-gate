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
