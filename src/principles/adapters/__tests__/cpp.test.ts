import { describe, it, expect, vi } from 'vitest';
import { CppAdapter } from '../cpp';
import type { Adapter } from '../../types';

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
  });

  it('should extract classes from C++ code', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
class Calculator {
public:
  int add(int a, int b) {
    return a + b;
  }
};
`);
    const adapter = new CppAdapter('test.cpp');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'Calculator')).toBe(true);
  });

  it('should extract structs from C++ code', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
struct Point {
  int x;
  int y;
};
`);
    const adapter = new CppAdapter('test.cpp');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'Point')).toBe(true);
  });

  it('should count C++ file physical lines', () => {
    (readFileSync as vi.Mock).mockReturnValue('int main() {\n  return 0;\n}');
    const adapter = new CppAdapter('test.cpp');
    const lineCount = adapter.countLines();
    expect(lineCount).toBe(3);
  });

  it('should handle C++ templates correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
template<typename T>
class Container {
public:
  T value;
  void setValue(T v) { value = v; }
  T getValue() const { return value; }
};
`);
    
    const adapter = new CppAdapter('test.cpp');
    
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'Container')).toBe(true);
    
    expect(adapter.detectLanguage()).toBe('cpp');
  });

  it('should handle C++ namespaces correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
namespace math {
  int add(int a, int b) { return a + b; }
  class Calculator {
  public:
    int multiply(int a, int b) { return a * b; }
  };
}
`);
    
    const adapter = new CppAdapter('test.cpp');
    
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'Calculator')).toBe(true);
  });

  it('should handle C++ inheritance correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
class Base {
public:
  virtual void foo() {}
};

class Derived : public Base {
public:
  void foo() override {}
};
`);
    
    const adapter = new CppAdapter('test.cpp');
    
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'Base')).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'Derived')).toBe(true);
  });

  it('should handle C++ comments correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
// Single line comment
int main() {
  /* Multi-line
     comment */
  return 0;
}
`);
    
    const adapter = new CppAdapter('test.cpp');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as any).name === 'main')).toBe(true);
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
    expect(functions.some(fn => (fn as any).name === 'main')).toBe(true);
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
