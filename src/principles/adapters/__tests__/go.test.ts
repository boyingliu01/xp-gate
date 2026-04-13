import { describe, it, expect, vi } from 'vitest';
import { GoAdapter } from '../go';
import type { Adapter } from '../../types';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

describe('GoAdapter', () => {
  it('should implement the Adapter interface', () => {
    (readFileSync as vi.Mock).mockReturnValue('func testFn() {}\ntype TestClass struct {}');
    const adapter = new GoAdapter('test.go');
    
    expect(adapter).toHaveProperty('detectLanguage');
    expect(adapter).toHaveProperty('parseAST');
    expect(adapter).toHaveProperty('extractFunctions');
    expect(adapter).toHaveProperty('extractClasses');
    expect(adapter).toHaveProperty('countLines');
  });

  it('should detect language as go for .go files', () => {
    (readFileSync as vi.Mock).mockReturnValue('func testFn() {}');
    const adapter = new GoAdapter('test.go');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('go');
  });

  it('should parse Go file AST correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue('func testFn() {}\ntype TestClass struct {}');
    const adapter = new GoAdapter('test.go');
    const ast = adapter.parseAST();
    expect(ast).toHaveProperty('content');
    expect(ast).toHaveProperty('language');
    expect(ast).toHaveProperty('filePath');
    expect(ast.language).toBe('go');
  });

  it('should extract functions from Go AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('func testFn() {}\nfunc (t *TestClass) method() {}');
    const adapter = new GoAdapter('test.go');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as any).name === 'testFn')).toBe(true);
  });

  it('should extract structs from Go AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('func testFn() {}\ntype TestClass struct {}');
    const adapter = new GoAdapter('test.go');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'TestClass')).toBe(true);
  });

  it('should count Go file physical lines', () => {
    (readFileSync as vi.Mock).mockReturnValue('func testFn() {}\nfunc testFn2() {}');
    const adapter = new GoAdapter('test.go');
    const lineCount = adapter.countLines();
    expect(lineCount).toBe(2);
  });
});