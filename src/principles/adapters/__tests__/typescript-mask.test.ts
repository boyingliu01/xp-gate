/**
 * @test REQ-TYPESCRIPT-MASK
 * @intent 掩码把字符串、注释和正则体替换成空格，是**所有结构性扫描的前提**：
 *         花括号计数只在掩码后的源码上成立，否则模板字面量里的一个 `{` 会开启一个
 *         永远不闭合的块。
 *
 *         它必须遵守一条硬性约束：**保持长度不变**。调用方要把偏移映射回原文，长度
 *         一变，后面所有位置都会错位——而错位不会抛错，只会让结论静默指向别的地方。
 *
 * @covers AC-TS-MASK-01
 * @covers AC-TS-MASK-02
 * @covers AC-TS-MASK-03
 */
import { describe, expect, it } from 'vitest';
import { maskLiterals } from '../typescript-mask';

describe('maskLiterals', () => {
  it('preserves the source length', () => {
    // The load-bearing invariant: callers map offsets back onto the original text.
    const src = 'const a = "hello"; // note\nconst b = `tpl`;';
    expect(maskLiterals(src)).toHaveLength(src.length);
  });

  it('blanks a string body but keeps the surrounding code', () => {
    const masked = maskLiterals('const a = "secret";');
    expect(masked).not.toContain('secret');
    expect(masked).toContain('const a =');
  });

  it('blanks a line comment through the end of the line only', () => {
    // The newline itself survives, or the next line would join this one and the
    // statement-end scan would miss a terminator.
    const masked = maskLiterals('a(); // hidden\nb();');
    expect(masked).not.toContain('hidden');
    expect(masked).toContain('\n');
    expect(masked).toContain('b();');
  });

  it('blanks a block comment', () => {
    const masked = maskLiterals('a(); /* hidden */ b();');
    expect(masked).not.toContain('hidden');
    expect(masked).toContain('b();');
  });

  it('blanks a regex body, including a brace inside it', () => {
    // A regex such as /(?:interface)\s*\{/g contains a `{` that is part of its text.
    // Leaving it in made the brace scan believe a function opened a block it never
    // closed -- measured once as CCN 24 for a function that is 3.
    const masked = maskLiterals('const re = /(?:interface)\\s*\\{/g;');
    expect(masked).not.toContain('interface');
    expect(masked.match(/\{/g) ?? []).toHaveLength(0);
  });

  it('keeps a slash that is division from starting a regex', () => {
    // `a / b` is division: a slash after an identifier cannot open a literal, and
    // treating it as one would blank the rest of the line.
    const masked = maskLiterals('const r = a / b + c;');
    expect(masked).toContain('/');
  });

  it('leaves code with no literals untouched', () => {
    const src = 'function f(x) { return x + 1; }';
    expect(maskLiterals(src).trim()).toBe(src.trim());
  });
});
