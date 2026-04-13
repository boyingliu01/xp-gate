import { describe, it, expect, vi } from 'vitest';
import { JavaAdapter } from '../java';
import type { Adapter } from '../../types';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

describe('JavaAdapter', () => {
  it('should implement the Adapter interface', () => {
    (readFileSync as vi.Mock).mockReturnValue('public class Test {\n  public void testFn() {}\n}');
    const adapter = new JavaAdapter('Test.java');
    
    expect(adapter).toHaveProperty('detectLanguage');
    expect(adapter).toHaveProperty('parseAST');
    expect(adapter).toHaveProperty('extractFunctions');
    expect(adapter).toHaveProperty('extractClasses');
    expect(adapter).toHaveProperty('countLines');
  });

  it('should detect language as java for .java files', () => {
    (readFileSync as vi.Mock).mockReturnValue('public class Test {}');
    const adapter = new JavaAdapter('Test.java');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('java');
  });

  it('should parse Java file AST correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue('public class Test {\n  public void testFn() {}\n}');
    const adapter = new JavaAdapter('Test.java');
    const ast = adapter.parseAST();
    expect(ast).toHaveProperty('content');
    expect(ast).toHaveProperty('language');
    expect(ast).toHaveProperty('filePath');
    expect(ast.language).toBe('java');
  });

  it('should extract methods from Java AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('public class Test {\n  public void testFn() {}\n}');
    const adapter = new JavaAdapter('Test.java');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as any).name === 'testFn')).toBe(true);
  });

  it('should extract classes from Java AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('public class Test {\n  public void testFn() {}\n}');
    const adapter = new JavaAdapter('Test.java');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'Test')).toBe(true);
  });

  it('should count Java file physical lines', () => {
    (readFileSync as vi.Mock).mockReturnValue('public class Test {\n}\nclass Test2 {}');
    const adapter = new JavaAdapter('Test.java');
    const lineCount = adapter.countLines();
    expect(lineCount).toBe(3);
  });
});