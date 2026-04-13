import { describe, it, expect, vi } from 'vitest';
import { SwiftAdapter } from '../swift';
import type { Adapter } from '../../types';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

describe('SwiftAdapter', () => {
  it('should implement the Adapter interface', () => {
    (readFileSync as vi.Mock).mockReturnValue('func testFn() {}\nclass TestClass {}');
    const adapter = new SwiftAdapter('test.swift');
    
    expect(adapter).toHaveProperty('detectLanguage');
    expect(adapter).toHaveProperty('parseAST');
    expect(adapter).toHaveProperty('extractFunctions');
    expect(adapter).toHaveProperty('extractClasses');
    expect(adapter).toHaveProperty('countLines');
  });

  it('should detect language as swift for .swift files', () => {
    (readFileSync as vi.Mock).mockReturnValue('func testFn() {}');
    const adapter = new SwiftAdapter('test.swift');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('swift');
  });

  it('should parse Swift file AST correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue('func testFn() {}\nclass TestClass {}');
    const adapter = new SwiftAdapter('test.swift');
    const ast = adapter.parseAST();
    expect(ast).toHaveProperty('content');
    expect(ast).toHaveProperty('language');
    expect(ast).toHaveProperty('filePath');
    expect(ast.language).toBe('swift');
  });

  it('should extract functions from Swift AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('func testFn() {}\nclass TestClass {}');
    const adapter = new SwiftAdapter('test.swift');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as any).name === 'testFn')).toBe(true);
  });

  it('should extract classes from Swift AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('func testFn() {}\nclass TestClass {}');
    const adapter = new SwiftAdapter('test.swift');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'TestClass')).toBe(true);
  });

  it('should count Swift file physical lines', () => {
    (readFileSync as vi.Mock).mockReturnValue('func testFn() {}\nfunc testFn2() {}');
    const adapter = new SwiftAdapter('test.swift');
    const lineCount = adapter.countLines();
    expect(lineCount).toBe(2);
  });
});