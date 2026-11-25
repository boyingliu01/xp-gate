/**
 * @test REQ-588
 * @intent `compatibilityVerdict` 是三态的：`true` 兼容、`false` 违规、`null` **无法判定**。
 *
 *         第三态是这个函数存在的全部理由。#588 之前它对任何不认识的东西返回 `false`
 *         —— 把**解析失败**变成了裁决。Java 上几乎所有参数都解析失败，于是每个带
 *         `extends` 的类都被报告。
 *
 *         单文件的 regex 分析常常看不到基类，而"看不到"的诚实答案就是沉默。
 *
 * @covers AC-588-01
 * @covers AC-588-02
 */
import { describe, expect, it } from 'vitest';
import { compatibilityVerdict } from '../../solid/lsp';

describe('compatibilityVerdict', () => {
  it('treats a primitive as compatible', () => {
    // A primitive matches trivially: the contract is about object substitution.
    expect(compatibilityVerdict('int', 'Derived', ['Object'])).toBe(true);
  });

  it('treats the class itself, or a subtype of it, as compatible', () => {
    // `Derived` or `DerivedSub` satisfies the contract by construction.
    expect(compatibilityVerdict('DerivedChild', 'Derived', ['Other'])).toBe(true);
  });

  it('reports a type the base does not accept as a violation', () => {
    // Both sides come from declarations in the same file, so this is a real comparison
    // rather than a guess -- and it is the violation the rule exists to find.
    expect(compatibilityVerdict('FileChannel', 'Derived', ['DataSource'])).toBe(false);
  });

  it('accepts a type the base also declares', () => {
    expect(compatibilityVerdict('DataSource', 'Derived', ['DataSource'])).toBe(true);
  });

  it('returns null when the base declares no usable parameter type', () => {
    // THE load-bearing case: an empty base type list carries no information, so the
    // verdict must be "cannot tell". Returning false here is exactly the #588 defect.
    expect(compatibilityVerdict('DataSource', 'Derived', [])).toBeNull();
  });

  it('returns null when the base contract could not be resolved at all', () => {
    expect(compatibilityVerdict('DataSource', 'Derived', undefined)).toBeNull();
  });
});
