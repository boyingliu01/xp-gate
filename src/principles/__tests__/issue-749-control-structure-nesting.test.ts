/**
 * @test REQ-DSH-021
 * @intent 验证 `clean-code.deep-nesting` 度量的是「控制结构嵌套」而不是「花括号深度」。
 *         修复 #749 之前，TypeScriptAdapter 的 maxNesting() 只做花括号配平计数：
 *         一个纯配置对象（`{db:{pool:{retry:{max}}}}`）与一段真实的
 *         `if > try > for > if` 代码得到**同一个分数 5**——规则想表达「控制结构太深
 *         让人读不懂」，量的却是花括号，属于构念错误（construct validity）。
 *         lizard 的 `-ENS` 扩展对同一 fixture 分别给出 1 与 4，是正确的语义基准。
 * @covers AC-DSH-021-01
 *
 * Mock-first per src/principles/AGENTS.md: inline fixture, no separate files.
 *
 * 参照值来源：lizard 1.25.0 `-ENS --csv` 实测
 *   纯配置对象 fixture   → NS=1
 *   if>try>for>if fixture → NS=4
 */

import { describe, it, expect, vi } from 'vitest';
import { TypeScriptAdapter } from '../adapters/typescript';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

/**
 * 纯配置对象：控制结构只有 1 层 `if`，但花括号深达 5 层。
 * 正确的 nestingDepth 是 1（lizard -ENS 实测）。旧实现返回 5。
 */
const CONFIG_OBJECT_SOURCE = `
function configure(enable) {
  const config = {
    db: { pool: { retry: { max: 3 } } }
  };
  if (enable) { return config; }
  return config;
}
`;

/**
 * 真实控制流：if > try > for > if，控制结构嵌套 4 层。
 * 正确的 nestingDepth 是 4（lizard -ENS 实测）。旧实现同样返回 5。
 */
const CONTROL_FLOW_SOURCE = `
function process(items) {
  if (items) {
    try {
      for (const item of items) {
        if (item) { return item; }
      }
    } catch (e) { return null; }
  }
  return null;
}
`;

/** Extract the single top-level function fact from a mocked file. */
function functionFactOf(source: string, name: string) {
  (readFileSync as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue(source);
  const adapter = new TypeScriptAdapter('/repo/sample.ts');
  const facts = adapter.extractFunctions() as Array<{ name?: string; nestingDepth?: number }>;
  const found = facts.find((f) => f.name === name);
  expect(found, `function ${name} should be extracted`).toBeDefined();
  return found as { name?: string; nestingDepth?: number };
}

describe('#749 deep-nesting measures control structures, not brace depth', () => {
  it('reports 1 for a nested config object that contains a single if', () => {
    const fact = functionFactOf(CONFIG_OBJECT_SOURCE, 'configure');
    // Old brace-counting implementation returned 5 here.
    expect(fact.nestingDepth).toBe(1);
  });

  it('reports 4 for real control flow: if > try > for > if', () => {
    const fact = functionFactOf(CONTROL_FLOW_SOURCE, 'process');
    // Old brace-counting implementation also returned 5 here.
    expect(fact.nestingDepth).toBe(4);
  });

  it('distinguishes the two shapes that the old implementation conflated', () => {
    const config = functionFactOf(CONFIG_OBJECT_SOURCE, 'configure');
    const flow = functionFactOf(CONTROL_FLOW_SOURCE, 'process');
    // This is the construct-validity assertion: depth must track control
    // structures, so a deeply-braced config object must NOT score like nested
    // control flow.
    expect(config.nestingDepth).toBeLessThan(flow.nestingDepth as number);
  });

  it('does not count braces inside string and template literals', () => {
    const source = `
function render(value) {
  const text = "{ not a brace }";
  const tpl = \`\${value} { still not }\`;
  if (value) { return text + tpl; }
  return '';
}
`;
    const fact = functionFactOf(source, 'render');
    expect(fact.nestingDepth).toBe(1);
  });

  it('counts nesting inside an arrow body even when a string holds a brace', () => {
    // The arrow path used to hand `maxControlNesting` raw source while the
    // named-function path handed it masked source. A `}` inside a string
    // unbalances the brace pairing, so the arrow scored 1 where lizard -ENS
    // reports NS=2.
    const source = `
export const arrow = (a, b) => {
  if (a) { const s = "}"; if (b) { return 1; } }
  return 0;
};
`;
    const fact = functionFactOf(source, 'arrow');
    expect(fact.nestingDepth).toBe(2);
  });

  it('keeps a flat function at 0 (no control structures)', () => {
    const source = `
function plain(a, b) {
  const sum = a + b;
  return sum;
}
`;
    const fact = functionFactOf(source, 'plain');
    expect(fact.nestingDepth).toBe(0);
  });

  it('counts a switch case body as nested but not the case label itself', () => {
    const source = `
function dispatch(kind) {
  switch (kind) {
    case 'a': return 1;
    case 'b': return 2;
    default: return 0;
  }
}
`;
    const fact = functionFactOf(source, 'dispatch');
    // switch is one control structure; case labels add no nesting of their own.
    expect(fact.nestingDepth).toBe(1);
  });

  it('counts sequential ifs as depth 1, not depth N', () => {
    const source = `
function sequential(a, b, c) {
  if (a) { return 1; }
  if (b) { return 2; }
  if (c) { return 3; }
  return 0;
}
`;
    const fact = functionFactOf(source, 'sequential');
    expect(fact.nestingDepth).toBe(1);
  });
});
