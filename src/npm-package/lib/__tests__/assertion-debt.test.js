/**
 * @test REQ-668 `xp-gate audit assertions` 必须让存量断言债务可见
 * @intent Gate 5d 只检查 **diff 范围内** 的文件。这是有意的——全仓扫描每次提交都跑
 *         太慢——但它有个昂贵的副作用：存量债务会在 **无关改动** 时突然阻断，
 *         制造错误的因果归因。原作者改了 `writeReport()` 的错误处理，却被
 *         `test-alignment.test.ts` 里 4 处既有的 `expect(true).toBe(true)` 拦下。
 *
 *         这个副作用最坏的后果不是那一次误阻断，而是它改变修复者的行为：归因噪音
 *         让人以为"先绕过再说"，于是倾向加 `@assertion-justified` 而不是真修掉。
 *         一个让人更愿意豁免的门禁，比没有门禁更糟。
 *
 *         所以 `audit assertions` 的价值在于把"存量"变成可批处理的工作队列，
 *         而不是让人在无关提交里逐个撞见。
 * @covers AC-668-01, AC-668-02, AC-668-03
 */
'use strict';

const { scanForAssertionDebt, summarizeDebt } = require('../assertion-debt');

describe('xp-gate audit assertions (#668)', () => {
  it('AC-668-01: 列出全仓存量问题，按文件分组', () => {
    const results = scanForAssertionDebt({ cwd: process.cwd() });
    expect(Array.isArray(results)).toBe(true);
    // Grouped by file so a batch fixer can work one file at a time.
    for (const entry of results) {
      expect(typeof entry.file).toBe('string');
      expect(Array.isArray(entry.findings)).toBe(true);
      for (const f of entry.findings) {
        expect(typeof f.line).toBe('number');
        expect(['tautological', 'swallowed-error']).toContain(f.kind);
        expect(typeof f.text).toBe('string');
      }
    }
  });

  it('AC-668-02: 识别两类确定性 vacuous 形态', () => {
    // These are the two shapes Gate 5d blocks. Both are the ABSENCE of an assertion
    // wearing assertion syntax, which is why they are the ones worth a debt list.
    const fixture = [
      'test("a", () => {',
      '  expect(true).toBe(true);',
      '  try { go(); } catch {}',
      '});',
      'test("b", () => {',
      '  expect(x).toBe(1);',
      '});',
    ].join('\n');
    const findings = scanForAssertionDebt({ source: fixture, file: 'fixture.test.ts' });
    const flat = findings.flatMap((f) => f.findings);
    expect(flat.some((f) => f.kind === 'tautological')).toBe(true);
    expect(flat.some((f) => f.kind === 'swallowed-error')).toBe(true);
    // A real assertion must not be reported -- a debt list that flags `expect(x).toBe(1)`
    // is a list nobody finishes.
    const realLine = flat.find((f) => f.text.includes('expect(x).toBe(1)'));
    expect(realLine).toBeUndefined();
  });

  it('AC-668-03: 摘要给出可批次清零的数量，而非只是行数', () => {
    const fixture = ['expect(true).toBe(true);', 'expect(1).toBe(1);', 'try { x(); } catch {}'].join('\n');
    const results = scanForAssertionDebt({ source: fixture, file: 'a.test.ts' });
    const summary = summarizeDebt(results);
    expect(summary.files).toBe(1);
    expect(summary.total).toBe(3);
    // Two tautologies and one empty catch: the split matters because they are fixed
    // by different edits (rewrite the assertion vs. handle the error).
    expect(summary.byKind.tautological).toBe(2);
    expect(summary.byKind['swallowed-error']).toBe(1);
  });
});

/**
 * @test REQ-668 fixture 不能被当作存量债务
 * @intent 这条测试防的是一个**修债务反而删掉测试覆盖**的失败模式。
 *
 *         测试 Gate 5d 分类器的那批 .bats / .test.ts 文件必然包含
 *         `'expect(true).toBe(true);'` —— 那是被校验的**输入**，不是断言。
 *         若它们被列进"去修掉"的清单，执行清单的人会删掉钉住分类器行为的字符串，
 *         于是债务清单本身成了覆盖率的破坏者。
 *
 *         反例同样重要：真正的裸断言 `expect(true).toBe(true);` 必须仍然被报出来。
 *         只做"少报"很容易，难的是**同时**不误报也不漏报。
 * @covers AC-668-04
 */
describe('fixture 与真实断言的区分 (#668)', () => {
  it('AC-668-04: 带引号的 fixture 不报，裸断言照报', () => {
    const { classifyLine } = require('../assertion-debt');
    // Real code: must be reported.
    expect(classifyLine('expect(true).toBe(true);')).toBe('tautological');
    expect(classifyLine('    expect(1).toBe(1);')).toBe('tautological');
    expect(classifyLine('try { x(); } catch {}')).toBe('swallowed-error');
    // Fixture inputs: must not be reported.
    expect(classifyLine("'    expect(true).toBe(true);',")).toBeNull();
    expect(classifyLine('const s = "expect(true).toBe(true)";')).toBeNull();
    // Neither is debt.
    expect(classifyLine('// expect(true).toBe(true);')).toBeNull();
    expect(classifyLine('expect(x).toBe(1);')).toBeNull();
    expect(classifyLine('expect(value).toBeTruthy();')).toBeNull();
  });
});
