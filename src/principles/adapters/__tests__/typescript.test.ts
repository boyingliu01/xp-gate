import { describe, it, expect, vi } from 'vitest';
import { TypeScriptAdapter } from '../typescript';
import type { Adapter } from '../../types';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

describe('TypeScriptAdapter', () => {
  
  it('should implement the Adapter interface', () => {
    (readFileSync as vi.Mock).mockReturnValue('export function testFn() {}\nclass TestClass {}');
    const adapter = new TypeScriptAdapter('test.ts');
    
    expect(adapter).toHaveProperty('detectLanguage');
    expect(adapter).toHaveProperty('parseAST');
    expect(adapter).toHaveProperty('extractFunctions');
    expect(adapter).toHaveProperty('extractClasses');
    expect(adapter).toHaveProperty('countLines');
  });

  it('should detect language as typescript for .ts files', () => {
    (readFileSync as vi.Mock).mockReturnValue('export function testFn() {}\nclass TestClass {}');
    const adapter = new TypeScriptAdapter('test.ts');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('typescript');
  });

  it('should detect language as typescript for .tsx files', () => {
    (readFileSync as vi.Mock).mockReturnValue('export function testFn() {}\nclass TestClass {}');
    const adapter = new TypeScriptAdapter('test.tsx');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('typescript');
  });

  it('should parse TypeScript file AST correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue('export function testFn() {}\nclass TestClass {}');
    const adapter = new TypeScriptAdapter('test.ts');
    const ast = adapter.parseAST();
    expect(ast).toHaveProperty('content');
    expect(ast).toHaveProperty('language');
    expect(ast).toHaveProperty('filePath');
    expect(ast.language).toBe('typescript');
  });

  it('should extract functions from TypeScript AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('export function testFn() {}\nclass TestClass {}');
    const adapter = new TypeScriptAdapter('test.ts');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as any).name === 'testFn')).toBe(true);
  });

  it('should extract classes from TypeScript AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('export function testFn() {}\nclass TestClass {}');
    const adapter = new TypeScriptAdapter('test.ts');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as any).name === 'TestClass')).toBe(true);
  });

  it('should count TypeScript file physical lines', () => {
    (readFileSync as vi.Mock).mockReturnValue('export function testFn() {}\nexport function testFn2() {}');
    const adapter = new TypeScriptAdapter('test.ts');
    const lineCount = adapter.countLines();
    expect(lineCount).toBe(2);
  });

  it('should handle TypeScript-specific syntax correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue(`
      export async function asyncFn() {}
      export function* generatorFn() {}
      class MyClass {
        method() {}
      }
      interface MyInterface {}
      type MyType = string;
    `);
    
    const adapter = new TypeScriptAdapter('test.ts');
    
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    
    expect(adapter.detectLanguage()).toBe('typescript');
  });
  
  it('should throw error when file cannot be read', () => {
    (readFileSync as vi.Mock).mockImplementation(() => {
      throw new Error('Could not read file');
    });
    
    expect(() => {
      new TypeScriptAdapter('nonexistent-file.ts');
    }).toThrow('Could not read file:');
  });
});