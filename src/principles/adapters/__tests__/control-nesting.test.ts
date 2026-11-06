/**
 * @test REQ-DSH-021
 * @intent 验证 `maxControlNesting` 计的是控制结构嵌套而非花括号深度。#749：
 *         原 maxNesting() 只做花括号配平，一个纯配置对象
 *         `{db:{pool:{retry:{max}}}}` 与 `if > try > for > if` 都得到 5，
 *         规则无法区分「配置字面量」与「需要人跟着读的控制流」。
 *         正确语义来自 lizard `-ENS`（cognitive_brace.py）：嵌套层级由拥有
 *         函数体的结构压栈，`case`/`default` 不是独立结构。
 * @covers AC-DSH-021-01
 *
 * 期望值基准：lizard 1.25.0 `-ENS --csv` 实测。
 */

import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { TypeScriptAdapter } from '../typescript';
import { maxControlNesting } from '../control-nesting';

/** Real control flow nesting 4 deep: if > try > for > if. */
const CONTROL_FLOW = `
if (items) {
  try {
    for (const item of items) {
      if (item) { return item; }
    }
  } catch (e) { return null; }
}
`;

/** A config literal: five brace levels, one control structure. */
const CONFIG_LITERAL = `
const config = { db: { pool: { retry: { max: 3 } } } };
if (enable) { return config; }
`;

describe('maxControlNesting counts control structures, not braces', () => {
  it('reports 4 for if > try > for > if', () => {
    expect(maxControlNesting(CONTROL_FLOW)).toBe(4);
  });

  it('reports 1 for a five-level config literal with one if', () => {
    expect(maxControlNesting(CONFIG_LITERAL)).toBe(1);
  });

  it('separates the two shapes the brace counter conflated', () => {
    expect(maxControlNesting(CONFIG_LITERAL))
      .toBeLessThan(maxControlNesting(CONTROL_FLOW));
  });

  it('treats sequential ifs as depth 1 each, not a growing chain', () => {
    expect(maxControlNesting(`
      if (a) { return 1; }
      if (b) { return 2; }
      if (c) { return 3; }
    `)).toBe(1);
  });

  it('treats brace-less guard clauses as depth 1, not swallowing later code', () => {
    expect(maxControlNesting(`
      if (a) return 1;
      if (b) return 2;
      if (c) return 3;
    `)).toBe(1);
  });

  it('counts else-if as one extra level', () => {
    expect(maxControlNesting(`
      if (a) { return 1; }
      else if (b) { return 2; }
    `)).toBe(2);
  });

  it('counts a finally block as a level, like catch', () => {
    // lizard -ENS reports NS=2 for each of these (verified against 1.25.0).
    expect(maxControlNesting(
      `try { x(); } catch (e) { y(); } finally { if (z) { w(); } }`,
    )).toBe(2);
    expect(maxControlNesting(
      `try { x(); } finally { if (z) { w(); } }`,
    )).toBe(2);
  });

  it('does not read keyword-shaped object keys as control structures', () => {
    // `{ for: 1, while: 2 }` is a flat config object. lizard -ENS reports NS=2
    // here because it matches keywords as tokens with no syntactic context;
    // this scanner is context-aware on purpose, which is what #749 asks for
    // ("do not penalise config literals").
    expect(maxControlNesting(`const o = { for: 1, while: 2 };`)).toBe(0);
    expect(maxControlNesting(`const o = { if: parseIf, while: parseWhile };`)).toBe(0);
    // A real structure after such a literal still counts.
    expect(maxControlNesting(`const o = { for: 1 }; if (a) { b(); }`)).toBe(1);
  });

  it('still counts labeled loops, which use a colon too', () => {
    expect(maxControlNesting(`outer: for (;;) { if (a) { break outer; } }`)).toBe(2);
  });

  it('skips an inline callback body in both arrow parameter forms', () => {
    // lizard -ENS attributes a callback's nesting to the callback, so the
    // enclosing function sees 0. The parenthesized and bare-parameter forms are
    // the same construct and must score identically.
    expect(maxControlNesting(`items.map((x) => { if (a) { b(); } });`)).toBe(0);
    expect(maxControlNesting(`items.map(x => { if (a) { b(); } });`)).toBe(0);
    expect(maxControlNesting(`items.map(async x => { if (a) { b(); } });`)).toBe(0);
  });

  it('counts a switch as one level and its case labels as none', () => {
    expect(maxControlNesting(`
      switch (kind) {
        case 'a': return 1;
        case 'b': return 2;
        default: return 0;
      }
    `)).toBe(1);
  });

  it('reports 0 for a flat function with no control structures', () => {
    expect(maxControlNesting(`const sum = a + b; return sum;`)).toBe(0);
  });

  it('ignores braces and arrow shapes inside string and template literals', () => {
    expect(maxControlNesting(`
      const text = "{ not a brace }";
      const tpl = \`\${v} { still not }\`;
      if (v) { return text + tpl; }
    `)).toBe(1);
  });

  it('does not skip the rest of the body after an expression-bodied arrow', () => {
    // A nested function with no braces has no body to skip. Treating the
    // "no brace found" sentinel as a brace position would scan to the end of
    // the enclosing function and drop everything after the arrow.
    expect(maxControlNesting(`
      const f = () => 1;
      if (a) { return 1; }
    `)).toBe(1);
    expect(maxControlNesting(`
      const f = () => 1;
      if (a) { if (b) { return 2; } }
    `)).toBe(2);
  });

  it('does not charge the enclosing body for a nested function definition', () => {
    // The inner `for` belongs to `process`, which is reported as its own
    // function; the outer level stays flat. Matches lizard `-ENS`.
    expect(maxControlNesting(`
      const process = async () => {
        for (const f of files) { await f; }
      };
      return process;
    `)).toBe(0);
  });

  it('ignores a keyword-shaped name in a member access position', () => {
    // `promise.catch(...)` / `obj.for` -- the word follows `.`, so it is a
    // property name, not a branch. (The previous fixture used `lib.interface`,
    // which is not in the keyword set, so it never exercised this guard.)
    expect(maxControlNesting(`promise.catch(handler);`)).toBe(0);
    expect(maxControlNesting(`const v = lib.for;`)).toBe(0);
  });

  it('recognises a method whose return type is an object literal', () => {
    // The return type's `{...}` is not the method body; treating it as the body
    // charged the real body's `if` to the enclosing function.
    expect(maxControlNesting(`const o = { m(): { a: number } { if (x) { y(); } } };`)).toBe(0);
    expect(maxControlNesting(`const o = { m(): Promise<void> { if (a) { b(); } } };`)).toBe(0);
  });

  it('rejects unmasked input instead of silently under-reporting', () => {
    // skipBalancedBrace returns the end of input when the brace never closes, so
    // an unmasked `}` inside a string would swallow every following structure and
    // report a lower score with no signal. Failing loudly is the only safe option
    // for a quality gate.
    expect(() => maxControlNesting(`if (a) { const s = "}"; if (b) { } }`)).toThrow(RangeError);
    // The masked form -- braces blanked out -- scores normally.
    expect(maxControlNesting(`if (a) { const s = ""; if (b) { } }`)).toBe(2);
  });

  it('treats `for await` as a loop with a condition', () => {
    // The `await` modifier sits between `for` and `(`, so without skipping it the
    // body looked brace-less and was cut at the newline, losing a level.
    expect(maxControlNesting(`for await (const x of xs) { if (a) { b(); } }`)).toBe(2);
  });

  it('skips a method shorthand body, as lizard scores it separately', () => {
    // lizard -ENS reports the method as its own function (NS=1) and the
    // enclosing body as 0, so the method's nesting must not be charged outward.
    expect(maxControlNesting(`const obj = { m() { if (a) { b(); } } };`)).toBe(0);
    expect(maxControlNesting(`class C { m() { if (a) { b(); } } }`)).toBe(0);
    expect(maxControlNesting(`class C { async m() { if (a) { b(); } } }`)).toBe(0);
  });

  it('counts a brace-less chain of nested controls at its real depth', () => {
    // lizard -ENS reports NS=3 here. Stopping the outer body at the first
    // newline would report 2 and understate exactly the deep nesting this rule
    // exists to catch.
    expect(maxControlNesting(`
if (a)
  if (b)
    if (c) { x(); }
`)).toBe(3);
    // Sequential guard clauses must stay flat.
    expect(maxControlNesting(`
if (a) return 1;
if (b) return 2;
`)).toBe(1);
  });

  it('scopes a multi-line brace-less body to its own statement', () => {
    // A brace-less body may span lines inside an open call. Its scope must still
    // end at the statement, so the following guard clause is not folded into it.
    expect(maxControlNesting(`
if (a)
  get({
    x: 1,
  });
if (b) { if (c) { d(); } }
`)).toBe(2);
  });

  it('documents the accepted maskLiterals gap for a regex inside an array', () => {
    // `maskLiterals` does not recognise a regex literal that starts an array
    // element, so an escaped `\(` survives masking as an opening paren. The guard
    // below checks braces only, deliberately: widening it to parens would turn
    // this pre-existing gap into a crash on valid code. Pinned here so the
    // accepted behaviour is explicit rather than discovered later.
    expect(maxControlNesting(`
const R = [ /\\(/g ];
if (a) { return R; }
return R;
`)).toBe(1);
  });
});

/**
 * Corpus guard: the masking assertion must never fire on real source.
 *
 * `maxControlNesting` throws rather than under-report, which is the right
 * trade-off for a gate — but it means a masking regression would turn into a
 * crash on codes that used to score fine. Running the whole tracked TypeScript
 * corpus makes that regression fail here, on the branch that causes it, instead
 * of surfacing later as a mysterious Gate 4 failure.
 */
describe('the masking assertion holds across the real corpus', () => {
  it('scans every tracked TypeScript file without throwing', () => {
    const repoRoot = new URL('../../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const files = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], {
      cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 28,
    }).split(/\r?\n/).filter(Boolean);
    expect(files.length).toBeGreaterThan(100);

    const failures: string[] = [];
    for (const rel of files) {
      try {
        const adapter = new TypeScriptAdapter(`${repoRoot}/${rel}`);
        for (const fn of adapter.extractFunctions() as Array<{ nestingDepth: number }>) {
          expect(typeof fn.nestingDepth).toBe('number');
        }
      } catch (error) {
        failures.push(`${rel}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
