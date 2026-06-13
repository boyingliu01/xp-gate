import { describe, it, expect, vi } from 'vitest';
import type { Adapter } from '../../types';
import { BaseAdapter } from '../base';

class MockAdapter extends BaseAdapter {
  parseAST(): unknown {
    return { content: this.fileContent, astType: 'mock' };
  }
  extractFunctions(): unknown[] {
    return [];
  }
  extractClasses(): unknown[] {
    return [];
  }
}

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

describe('BaseAdapter - Default Implementation', () => {

  it('should implement the Adapter interface', () => {
    (readFileSync as vi.Mock).mockReturnValue('mock file content\ntest line 2');
    const adapter = new MockAdapter('./test.ts');
    const implemented: Adapter = adapter as unknown as Adapter;
    
    expect(implemented).toBeDefined();
    expect(implemented.detectLanguage).toBeDefined();
    expect(implemented.parseAST).toBeDefined();
    expect(implemented.extractFunctions).toBeDefined();
    expect(implemented.extractClasses).toBeDefined();
    expect(implemented.countLines).toBeDefined();
  });

  it('should detect language based on file extension', () => {
    (readFileSync as vi.Mock).mockReturnValue('file content');
    
    const adapterTs = new MockAdapter('./test.ts');
    expect(adapterTs.detectLanguage()).toBe('typescript');
    
    const adapterTsx = new MockAdapter('./test.tsx');
    expect(adapterTsx.detectLanguage()).toBe('typescript');  
    
    const adapterJs = new MockAdapter('./test.js');
    expect(adapterJs.detectLanguage()).toBe('javascript');
    
    const adapterPy = new MockAdapter('./test.py');
    expect(adapterPy.detectLanguage()).toBe('python');
    
    const adapterUnknown = new MockAdapter('./test.unknown');
    expect(adapterUnknown.detectLanguage()).toBe('unknown');
  });

  it('should parse file AST correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue('mock file content\ntest line 2');
    const adapter = new MockAdapter('./test.ts');
    const ast = adapter.parseAST();
    expect(ast).toEqual({ content: 'mock file content\ntest line 2', astType: 'mock' });
  });

  it('should extract functions from AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('');
    const adapter = new MockAdapter('./test.ts');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
  });

  it('should extract classes from AST', () => {
    (readFileSync as vi.Mock).mockReturnValue('');
    const adapter = new MockAdapter('./test.ts');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
  });

  it('should count physical lines correctly', () => {
    (readFileSync as vi.Mock).mockReturnValue('line 1\nline 2\nline 3');
    const adapter = new MockAdapter('./test.ts');
    const lineCount = adapter.countLines();
    expect(lineCount).toBe(3);
  });

  it('should throw error for unsupported file operations', () => {
    (readFileSync as vi.Mock).mockImplementation(() => {
      throw new Error('Could not read file');
    });
    
    expect(() => {
      new MockAdapter('./nonexistent-file.txt');
    }).toThrow('Could not read file:');
  });
});