import { describe, it, expect, vi } from 'vitest';
import { PythonAdapter } from '../python';
import type { Adapter } from '../../types';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

describe('PythonAdapter', () => {
  it('should implement the Adapter interface', () => {
    (readFileSync as vi.Mock).mockReturnValue('def test_fn(): pass\nclass TestClass:');
    const adapter = new PythonAdapter('test.py');
    
    expect(adapter).toHaveProperty('detectLanguage');
    expect(adapter).toHaveProperty('parseAST');
    expect(adapter).toHaveProperty('extractFunctions');
    expect(adapter).toHaveProperty('extractClasses');
    expect(adapter).toHaveProperty('countLines');
  });

  it('should detect language as python for .py files', () => {
    (readFileSync as vi.Mock).mockReturnValue('def test_fn(): pass');
    const adapter = new PythonAdapter('test.py');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('python');
  });

  it('should parse Python file AST correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue('def test_fn(): pass\nclass TestClass:');
    const adapter = new PythonAdapter('test.py');
    const ast = adapter.parseAST();
    expect(ast).toHaveProperty('content');
    expect(ast).toHaveProperty('language');
    expect(ast).toHaveProperty('filePath');
    expect(ast.language).toBe('python');
  });

  it('should extract functions from Python AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('def test_fn(): pass\nclass TestClass:');
    const adapter = new PythonAdapter('test.py');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as any).name === 'test_fn')).toBe(true);
  });

  it('should extract classes from Python AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('def test_fn(): pass\nclass TestClass:');
    const adapter = new PythonAdapter('test.py');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'TestClass')).toBe(true);
  });

  it('should count Python file physical lines', () => {
    (readFileSync as vi.Mock).mockReturnValue('def test_fn(): pass\ndef test_fn2(): pass');
    const adapter = new PythonAdapter('test.py');
    const lineCount = adapter.countLines();
    expect(lineCount).toBe(2);
  });

  it('should handle async functions in Python', () => {
    (readFileSync as vi.Mock).mockReturnValue('async def async_fn(): pass');
    const adapter = new PythonAdapter('test.py');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
  });
});