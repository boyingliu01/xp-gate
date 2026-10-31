import { describe, it, expect, vi, type Mock } from 'vitest';;
import { TypeScriptAdapter } from '../typescript';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

describe('TypeScriptAdapter', () => {
  
  it('should implement the Adapter interface', () => {
    (readFileSync as Mock).mockReturnValue('export function testFn() {}\nclass TestClass {}');
    const adapter = new TypeScriptAdapter('test.ts');
    
    expect(adapter).toHaveProperty('detectLanguage');
    expect(adapter).toHaveProperty('parseAST');
    expect(adapter).toHaveProperty('extractFunctions');
    expect(adapter).toHaveProperty('extractClasses');
    expect(adapter).toHaveProperty('countLines');
  });

  it('should detect language as typescript for .ts files', () => {
    (readFileSync as Mock).mockReturnValue('export function testFn() {}\nclass TestClass {}');
    const adapter = new TypeScriptAdapter('test.ts');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('typescript');
  });

  it('should detect language as typescript for .tsx files', () => {
    (readFileSync as Mock).mockReturnValue('export function testFn() {}\nclass TestClass {}');
    const adapter = new TypeScriptAdapter('test.tsx');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('typescript');
  });

  it('should parse TypeScript file AST correctly', () => {
    (readFileSync as Mock).mockReturnValue('export function testFn() {}\nclass TestClass {}');
    const adapter = new TypeScriptAdapter('test.ts');
    const ast = adapter.parseAST();
    expect(ast).toHaveProperty('content');
    expect(ast).toHaveProperty('language');
    expect(ast).toHaveProperty('filePath');
    expect((ast as { language: unknown }).language).toBe('typescript');
  });

  it('should extract functions from TypeScript AST', () => {
    (readFileSync as Mock).mockReturnValue('export function testFn() {}\nclass TestClass {}');
    const adapter = new TypeScriptAdapter('test.ts');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as {name: string}).name === 'testFn')).toBe(true);
  });

  it('should extract classes from TypeScript AST', () => {
    (readFileSync as Mock).mockReturnValue('export function testFn() {}\nclass TestClass {}');
    const adapter = new TypeScriptAdapter('test.ts');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as {name: string}).name === 'TestClass')).toBe(true);
  });

  it('should count TypeScript file physical lines', () => {
    (readFileSync as Mock).mockReturnValue('export function testFn() {}\nexport function testFn2() {}');
    const adapter = new TypeScriptAdapter('test.ts');
    const lineCount = adapter.countLines();
    expect(lineCount).toBe(2);
  });

  it('should handle TypeScript-specific syntax correctly', () => {
    (readFileSync as Mock).mockReturnValue(`
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
    (readFileSync as Mock).mockImplementation(() => {
      throw new Error('Could not read file');
    });
    
    expect(() => {
      new TypeScriptAdapter('nonexistent-file.ts');
    }).toThrow('Could not read file:');
  });

  it('should fall back to super.detectLanguage for non-ts/non-tsx extensions', () => {
    (readFileSync as Mock).mockReturnValue('content');
    const adapter = new TypeScriptAdapter('test.py');
    expect(adapter.detectLanguage()).toBe('python');
  });

  it('should extract re-export declarations', () => {
    (readFileSync as Mock).mockReturnValue('export { Foo };\nexport { Bar };\nexport function baz() {}');
    const adapter = new TypeScriptAdapter('test.ts');
    const exports = adapter.extractExports();
    const reExports = exports.filter(ex => (ex as {type: string}).type === 're-export');
    expect(reExports.length).toBe(2);
  });
});
/**
 * @test TypeScriptAdapter — call expressions are not function declarations
 * @intent `existsSync(path)` inside a method body was reported as a function
 *         named `existsSync`, producing a phantom `missing-error-handling`
 *         warning that no edit to the calling code could ever clear. The
 *         adapter must not treat an identifier in CALL position as a declaration.
 * @covers AC-674-01
 */
describe('TypeScriptAdapter — call expressions are not declarations', () => {
  it('AC-674-01: does not invent a function named after a call inside a method body', () => {
    (readFileSync as Mock).mockReturnValue([
      'class Runner {',
      '  async run(): Promise<void> {',
      '    if (existsSync(path)) {',
      '      const body = readFileSync(path, "utf-8");',
      '      writeFileSync(other, body, { encoding: "utf-8" });',
      '    }',
      '  }',
      '}',
    ].join('\n'));
    const adapter = new TypeScriptAdapter('runner.ts');
    const names = (adapter.extractFunctions() as Array<{ name: string }>).map((f) => f.name);

    // `run` is a real method; the three fs calls are not.
    expect(names).toContain('run');
    expect(names).not.toContain('existsSync');
    expect(names).not.toContain('readFileSync');
    expect(names).not.toContain('writeFileSync');
  });

  it('AC-674-02: still finds genuine methods and functions (anti-vacuity)', () => {
    (readFileSync as Mock).mockReturnValue([
      'function standalone(a: number): number {',
      '  return a + 1;',
      '}',
      'class Thing {',
      '  method(flag: boolean): void {',
      '    if (flag) { standalone(1); }',
      '  }',
      '}',
    ].join('\n'));
    const adapter = new TypeScriptAdapter('thing.ts');
    const names = (adapter.extractFunctions() as Array<{ name: string }>).map((f) => f.name);

    expect(names).toContain('standalone');
    expect(names).toContain('method');
  });
});

/**
 * @test TypeScriptAdapter — extractClasses method counting
 * @intent `extractClasses().methodCount` drives BOTH `solid.srp` and
 *         `clean-code.god-class`. It was inflated by call sites inside method
 *         bodies: the member regex's lookbehind allowed `(` before the name, so
 *         every `if (existsSync(p))` added a phantom "method". On this repo's
 *         own adapter the count read 66 when the class declares 30 -- a
 *         threshold rule grading against a number it invented.
 * @covers AC-678-03
 */
describe('TypeScriptAdapter — methodCount counts declarations only', () => {
  it('AC-678-03: calls inside method bodies are not counted as methods', () => {
    (readFileSync as Mock).mockReturnValue([
      'class Counter {',
      '  a(): void { if (existsSync("p")) { helper(1); } }',
      '  b(): void { return this.c(); }',
      '  c(): void { }',
      '}',
    ].join('\n'));
    const adapter = new TypeScriptAdapter('counter.ts');
    const classes = (adapter as unknown as {
      extractClasses: () => Array<{ methodCount: number; methods: string[] }>;
    }).extractClasses();

    expect(classes).toHaveLength(1);
    // a, b, c are declared; existsSync / helper / this.c are call sites.
    expect(classes[0].methodCount).toBe(3);
    expect(classes[0].methods).toEqual(['a', 'b', 'c']);
  });

  it('AC-678-03: real methods are still counted (anti-vacuity)', () => {
    const names = ['one', 'two', 'three'];
    (readFileSync as Mock).mockReturnValue([
      'class Multi {',
      ...names.map((n) => `  ${n}(): void { }`),
      '}',
    ].join('\n'));
    const adapter = new TypeScriptAdapter('multi.ts');
    const classes = (adapter as unknown as {
      extractClasses: () => Array<{ methodCount: number; methods: string[] }>;
    }).extractClasses();

    expect(classes[0].methodCount).toBe(3);
    expect(classes[0].methods).toEqual(names);
  });
});
