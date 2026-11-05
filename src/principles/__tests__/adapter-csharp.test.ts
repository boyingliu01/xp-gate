/**
 * @test REQ-717-019
 * @intent Gate 4 (Principles) had no C# adapter: getAdapterForFile('.cs') returned
 *         null, so a .cs file that PASSED gate-4.sh's extension filter was then
 *         silently dropped by the analyzer. The filter looked like coverage while
 *         nothing was ever checked. These assertions pin that .cs now resolves to a
 *         real adapter and that the adapter extracts the metrics the 14 rules read.
 * @covers AC-717-23
 *
 * Mock-first per src/principles/AGENTS.md: inline fixture, no separate files.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';
import { CSharpAdapter } from '../adapters/csharp';
import { getAdapterForFile } from '../analyzer';

/** Build the adapter over an inline source string. */
function adapterFor(source: string, filePath = 'Probe.cs'): CSharpAdapter {
  (readFileSync as Mock).mockReturnValue(source);
  return new CSharpAdapter(filePath);
}

describe('CSharpAdapter', () => {
  it('is reachable from the analyzer for .cs and .csx', () => {
    (readFileSync as Mock).mockReturnValue('class A {}');
    expect(getAdapterForFile('A.cs')).toBeInstanceOf(CSharpAdapter);
    expect(getAdapterForFile('A.csx')).toBeInstanceOf(CSharpAdapter);
  });

  it('reports its language as csharp', () => {
    const a = adapterFor('class A {}');
    expect(a.detectLanguage()).toBe('csharp');
  });

  it('extracts classes, interfaces, structs and records', () => {
    const a = adapterFor(`
namespace N;
public class Alpha {}
public interface IBeta {}
public struct Gamma {}
public record Delta(int X);
internal sealed class Epsilon {}
`);
    const names = a.extractClasses().map((c: any) => c.name);
    expect(names).toEqual(['Alpha', 'IBeta', 'Gamma', 'Delta', 'Epsilon']);
  });

  it('extracts methods including async and expression-bodied forms', () => {
    const a = adapterFor(`
public class A {
  public void Simple() {}
  public async Task<int> AsyncWork() { return 1; }
  public int Expr() => 42;
  private static string Named(string s) { return s; }
}
`);
    const names = a.extractFunctions().map((f: any) => f.name);
    expect(names).toContain('Simple');
    expect(names).toContain('AsyncWork');
    expect(names).toContain('Expr');
    expect(names).toContain('Named');
  });

  it('counts method parameters for the too-many-params rule', () => {
    const a = adapterFor(`
public class A {
  public void Many(int one, int two, int three, int four, int five) {}
}
`);
    const many = a.extractFunctions().find((f: any) => f.name === 'Many') as any;
    expect(many.paramCount).toBe(5);
  });

  it('measures function length and nesting depth for the long-function and deep-nesting rules', () => {
    const a = adapterFor(`
public class A {
  public int F(int x) {
    if (x > 0) {
      if (x > 1) {
        return 2;
      }
    }
    return 0;
  }
}
`);
    const f = a.extractFunctions().find((m: any) => m.name === 'F') as any;
    expect(f.nestingDepth).toBeGreaterThanOrEqual(2);
    expect(f.length).toBeGreaterThan(3);
  });

  it('counts classes for the god-class rule', () => {
    const a = adapterFor(`
public class Big {
  public void A() {}
  public void B() {}
  public void C() {}
}
public class Small {
  public void D() {}
}
`);
    const big = a.extractClasses().find((c: any) => c.name === 'Big') as any;
    expect(big.methodCount).toBe(3);
  });

  it('does not let a brace inside a string end the method body', () => {
    // The same defect class cpp.ts documents: counting a `}` inside a literal
    // truncates the body and under-measures length/nesting for every rule after.
    const a = adapterFor(`
public class A {
  public string F() {
    var s = "}.}}";
    if (true) { return s; }
    return "";
  }
}
`);
    const f = a.extractFunctions().find((m: any) => m.name === 'F') as any;
    expect(f.nestingDepth).toBeGreaterThanOrEqual(1);
  });

  it('does not let a brace inside a comment affect the body scan', () => {
    const a = adapterFor(`
public class A {
  public int F() {
    // a stray } in a comment
    /* another } here */
    return 1;
  }
}
`);
    const f = a.extractFunctions().find((m: any) => m.name === 'F') as any;
    expect(f.length).toBeGreaterThan(1);
  });

  it('detects try/catch for the missing-error-handling rule', () => {
    const a = adapterFor(`
public class A {
  public void Guarded() {
    try { Work(); } catch (Exception) { return; }
  }
}
`);
    const g = a.extractFunctions().find((m: any) => m.name === 'Guarded') as any;
    expect(g.hasTryCatch).toBe(true);
  });

  it('does not report try/catch on a method without one', () => {
    const a = adapterFor(`
public class A {
  public void Plain() { Work(); }
}
`);
    const p = a.extractFunctions().find((m: any) => m.name === 'Plain') as any;
    expect(p.hasTryCatch).toBe(false);
  });
});
