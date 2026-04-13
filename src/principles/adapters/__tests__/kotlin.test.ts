import { describe, it, expect, vi } from 'vitest';
import { KotlinAdapter } from '../kotlin';
import type { Adapter } from '../../types';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

describe('KotlinAdapter', () => {
  it('should implement the Adapter interface', () => {
    (readFileSync as vi.Mock).mockReturnValue('fun testFn() {}\nclass TestClass');
    const adapter = new KotlinAdapter('test.kt');
    
    expect(adapter).toHaveProperty('detectLanguage');
    expect(adapter).toHaveProperty('parseAST');
    expect(adapter).toHaveProperty('extractFunctions');
    expect(adapter).toHaveProperty('extractClasses');
    expect(adapter).toHaveProperty('countLines');
  });

  it('should detect language as kotlin for .kt files', () => {
    (readFileSync as vi.Mock).mockReturnValue('fun testFn() {}');
    const adapter = new KotlinAdapter('test.kt');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('kotlin');
  });

  it('should parse Kotlin file AST correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue('fun testFn() {}\nclass TestClass');
    const adapter = new KotlinAdapter('test.kt');
    const ast = adapter.parseAST();
    expect(ast).toHaveProperty('content');
    expect(ast).toHaveProperty('language');
    expect(ast).toHaveProperty('filePath');
    expect(ast.language).toBe('kotlin');
  });

  it('should extract functions from Kotlin AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('fun testFn() {}\nclass TestClass');
    const adapter = new KotlinAdapter('test.kt');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as any).name === 'testFn')).toBe(true);
  });

  it('should extract classes from Kotlin AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('fun testFn() {}\nclass TestClass');
    const adapter = new KotlinAdapter('test.kt');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'TestClass')).toBe(true);
  });

  it('should count Kotlin file physical lines', () => {
    (readFileSync as vi.Mock).mockReturnValue('fun testFn() {}\nfun testFn2() {}');
    const adapter = new KotlinAdapter('test.kt');
    const lineCount = adapter.countLines();
    expect(lineCount).toBe(2);
  });
});