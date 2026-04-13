import { describe, it, expect, vi } from 'vitest';
import { DartAdapter } from '../dart';
import type { Adapter } from '../../types';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

describe('DartAdapter', () => {
  it('should implement the Adapter interface', () => {
    (readFileSync as vi.Mock).mockReturnValue('void testFn() {}\nclass TestClass {}');
    const adapter = new DartAdapter('test.dart');
    
    expect(adapter).toHaveProperty('detectLanguage');
    expect(adapter).toHaveProperty('parseAST');
    expect(adapter).toHaveProperty('extractFunctions');
    expect(adapter).toHaveProperty('extractClasses');
    expect(adapter).toHaveProperty('countLines');
  });

  it('should detect language as dart for .dart files', () => {
    (readFileSync as vi.Mock).mockReturnValue('void testFn() {}');
    const adapter = new DartAdapter('test.dart');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('dart');
  });

  it('should parse Dart file AST correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue('void testFn() {}\nclass TestClass {}');
    const adapter = new DartAdapter('test.dart');
    const ast = adapter.parseAST();
    expect(ast).toHaveProperty('content');
    expect(ast).toHaveProperty('language');
    expect(ast).toHaveProperty('filePath');
    expect(ast.language).toBe('dart');
  });

  it('should extract functions from Dart AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('void testFn() {}\nclass TestClass {}');
    const adapter = new DartAdapter('test.dart');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as any).name === 'testFn')).toBe(true);
  });

  it('should extract classes from Dart AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('void testFn() {}\nclass TestClass {}');
    const adapter = new DartAdapter('test.dart');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'TestClass')).toBe(true);
  });

  it('should count Dart file physical lines', () => {
    (readFileSync as vi.Mock).mockReturnValue('void testFn() {}\nvoid testFn2() {}');
    const adapter = new DartAdapter('test.dart');
    const lineCount = adapter.countLines();
    expect(lineCount).toBe(2);
  });
});