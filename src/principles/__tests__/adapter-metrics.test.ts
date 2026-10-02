/**
 * @test REQ-DSH-015
 * @intent 验证 TypeScriptAdapter 为各规则提供其所需度量字段：fix #446 之前，
 *         createCodeMatch() 只返回 {name,type,line,code}，而规则读取
 *         length / paramCount / nestingDepth / methodCount / hasTryCatch，
 *         导致 14 条规则里 12 条在 TypeScript 上结构性无法触发（Gate 4 形同虚设）
 * @covers AC-DSH-015-01
 *
 * Mock-first per src/principles/AGENTS.md: inline fixture, no separate files.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import { TypeScriptAdapter } from '../adapters/typescript';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

const LONG_BODY = Array.from({ length: 60 }, (_, i) => `  const v${i} = ${i};`).join('\n');

const SAMPLE = `
import { helper } from './helper';

export function eightParams(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) {
  return a + b + c + d + e + f + g + h;
}

export function longOne() {
${LONG_BODY}
  return 0;
}

export function deeplyNested(a: number) {
  if (a > 0) {
    if (a > 1) {
      if (a > 2) {
        if (a > 3) {
          if (a > 4) {
            return 'deep';
          }
        }
      }
    }
  }
  return 'shallow';
}

export function rawIo() {
  return readFileSync('/tmp/x', 'utf-8');
}

export function guardedIo() {
  try {
    return readFileSync('/tmp/x', 'utf-8');
  } catch (e) {
    return '';
  }
}

export const arrowFn = (x: number, y: number) => x + y;

export class MegaService {
  aMethod() { return 1; }
  m1() { return 1; } m2() { return 1; } m3() { return 1; } m4() { return 1; }
  m5() { return 1; } m6() { return 1; } m7() { return 1; } m8() { return 1; }
  m9() { return 1; } m10() { return 1; } m11() { return 1; } m12() { return 1; }
  m13() { return 1; } m14() { return 1; } m15() { return 1; }
}
`;

interface FnInfo {
  name: string;
  startLine?: number;
  line?: number;
  length?: number;
  paramCount?: number;
  nestingDepth?: number;
  hasTryCatch?: boolean;
  ioOperations?: string[];
}

interface ClsInfo {
  name: string;
  methodCount?: number;
  line?: number;
}

function adapterFor(content = SAMPLE): TypeScriptAdapter {
  (readFileSync as Mock).mockReturnValue(content);
  return new TypeScriptAdapter('sample.ts');
}

describe('TypeScriptAdapter metric extraction (#446)', () => {
  describe('extractFunctions', () => {
    it('reports paramCount for every function', () => {
      const fns = adapterFor().extractFunctions() as FnInfo[];
      const eight = fns.find(f => f.name === 'eightParams');
      expect(eight).toBeDefined();
      expect(eight?.paramCount).toBe(8);
    });

    it('reports length (body span) for every function', () => {
      const fns = adapterFor().extractFunctions() as FnInfo[];
      const long = fns.find(f => f.name === 'longOne');
      expect(long).toBeDefined();
      // > 50 lines is the long-function threshold; assert it is measured at all.
      expect(long?.length).toBeGreaterThan(50);
    });

    it('reports nestingDepth for every function', () => {
      const fns = adapterFor().extractFunctions() as FnInfo[];
      const deep = fns.find(f => f.name === 'deeplyNested');
      expect(deep).toBeDefined();
      expect(deep?.nestingDepth).toBeGreaterThanOrEqual(5);
    });

    it('reports hasTryCatch for unguarded and guarded IO', () => {
      const fns = adapterFor().extractFunctions() as FnInfo[];
      const io = fns.find(f => f.name === 'rawIo');
      expect(io).toBeDefined();
      expect(io?.hasTryCatch).toBe(false);

      const guarded = fns.find(f => f.name === 'guardedIo');
      expect(guarded).toBeDefined();
      expect(guarded?.hasTryCatch).toBe(true);
    });

    it('reports ioOperations for IO-performing functions', () => {
      const fns = adapterFor().extractFunctions() as FnInfo[];
      const io = fns.find(f => f.name === 'rawIo');
      expect(io?.ioOperations?.length ?? 0).toBeGreaterThan(0);
    });

    it('still reports name / line for every function', () => {
      const fns = adapterFor().extractFunctions() as FnInfo[];
      expect(fns.length).toBeGreaterThan(0);
      for (const f of fns) {
        expect(f.name).toBeTruthy();
        expect(f.line).toBeGreaterThan(0);
      }
    });

    it('finds arrow functions and class methods, not only `function` declarations', () => {
      const fns = adapterFor().extractFunctions() as FnInfo[];
      const names = fns.map(f => f.name);
      // Arrow consts and class methods are the dominant modern TS forms; the old
      // regex only matched the literal `function` keyword.
      expect(names).toContain('arrowFn');
      expect(names).toContain('aMethod');
    });
  });

  describe('extractClasses', () => {
    it('reports methodCount per class', () => {
      const classes = adapterFor().extractClasses() as ClsInfo[];
      const mega = classes.find(c => c.name === 'MegaService');
      expect(mega).toBeDefined();
      expect(mega?.methodCount).toBeGreaterThanOrEqual(15);
    });
  });

  describe('imports', () => {
    interface ImportInfo {
      name?: string;
      line?: number;
      used?: boolean;
      type?: string;
    }

    it('returns objects, not bare strings (the rule reads .name/.used)', () => {
      const imports = (adapterFor() as unknown as { imports: ImportInfo[] }).imports;
      expect(Array.isArray(imports)).toBe(true);
      expect(imports.length).toBeGreaterThan(0);
      for (const imp of imports) {
        expect(typeof imp).toBe('object');
        // Never leak `undefined` as a name -- it renders straight into the message.
        expect(imp.name).toBeTruthy();
        expect(imp.name).not.toBe('undefined');
        expect(imp.line).toBeGreaterThan(0);
      }
    });

    it('marks a genuinely unused import as unused', () => {
      const imports = (adapterFor() as unknown as { imports: ImportInfo[] }).imports;
      const helper = imports.find(i => i.name === 'helper');
      expect(helper).toBeDefined();
      // `helper` is imported but never referenced in SAMPLE.
      expect(helper?.used).toBe(false);
    });

    it('marks a referenced import as used', () => {
      const content = `
import { readFileSync } from 'fs';
export function go() { return readFileSync('/tmp/x', 'utf-8'); }
`;
      const imports = (adapterFor(content) as unknown as { imports: ImportInfo[] }).imports;
      const rfs = imports.find(i => i.name === 'readFileSync');
      expect(rfs).toBeDefined();
      expect(rfs?.used).toBe(true);
    });
  });

  describe('extract (magic numbers, #446)', () => {
    it('returns {value,line} objects and ignores comments/strings', () => {
      const content = `
// 999 should not count (comment)
const s = "1234 should not count (string)";
export function f() { return 12345; }
`;
      const nums = (adapterFor(content) as unknown as {
        extract: () => Array<{ value: number; line: number }>;
      }).extract();
      const values = nums.map(n => n.value);
      expect(values).toContain(12345);
      expect(values).not.toContain(999);
      expect(values).not.toContain(1234);
      for (const n of nums) expect(n.line).toBeGreaterThan(0);
    });

    /**
     * @test REQ-DSH-018
     * @intent 验证「命名常量的初始化值」不被当作 magic number：规则的修复建议
     *         就是「改用命名常量」，若常量本身仍被标记，该违规永远无法消除
     * @covers AC-DSH-018-01
     */
    it('skips the initializer of a named constant but still reports bare literals', () => {
      // Fixtures are bare fragments: no `export`, so this file does not itself
      // trip the many-exports rule that the adapter under test is meant to flag.
      const content = `
const RENAME_PARTS = 3;
const BUDGET: number = 5;
function f(): number {
  return 137;
}
`;
      const nums = (adapterFor(content) as unknown as {
        extract: () => Array<{ value: number; line: number }>;
      }).extract();
      const values = nums.map(n => n.value);

      // The rule asks for named constants, so the constants must not be flagged.
      expect(values).not.toContain(3);
      expect(values).not.toContain(5);
      // A bare literal in a body is the actual target and must still be reported.
      expect(values).toContain(137);
    });

    it('still reports a number assigned to a non-constant binding', () => {
      // Only `const`/`readonly` declarations are exempt; `let x = 99` is not.
      const content = `
function f(): number {
  let x = 99;
  return x;
}
`;
      const nums = (adapterFor(content) as unknown as {
        extract: () => Array<{ value: number; line: number }>;
      }).extract();
      expect(nums.map(n => n.value)).toContain(99);
    });
  });

  describe('extractInterfaces (ISP, #446)', () => {
    it('reports interface names and methodCount', () => {
      const content = `
export interface Worker {
  run(): void;
  stop(): void;
}
`;
      const ifaces = (adapterFor(content) as unknown as {
        extractInterfaces: () => Array<{ name: string; methodCount: number }>;
      }).extractInterfaces();
      const worker = ifaces.find(i => i.name === 'Worker');
      expect(worker).toBeDefined();
      expect(worker?.methodCount).toBe(2);
    });
  });

  describe('no control-flow false positives', () => {
    it('does not report `if` / `for` / `while` as functions', () => {
      const fns = adapterFor().extractFunctions() as FnInfo[];
      const names = fns.map(f => f.name);
      for (const kw of ['if', 'for', 'while', 'switch', 'catch', 'return']) {
        expect(names).not.toContain(kw);
      }
    });
  });
});
