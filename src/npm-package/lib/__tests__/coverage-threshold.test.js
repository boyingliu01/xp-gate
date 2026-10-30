/**
 * @test REQ-605 覆盖率阈值必须只有一个真相源，且"未声明"与"声明为默认"可区分
 * @intent #605 指出阈值散落在 4+ 处。实测这里的问题比"散落"严重：同一个覆盖率
 *         概念有**两条独立的闸门，读同样的数字，却给出不同的门槛**。
 *
 *           githooks/pre-commit      ${COVERAGE_THRESHOLD:-80}   —— 平面 80%
 *           vitest.config.ts         lines 60 / statements 60
 *                                    functions 81 / branches 79
 *
 *         而 vitest 侧那条的注释自己写着"这些数字是实测下限，不是 80% 目标"。
 *         也就是说两条闸门对"这个仓库的覆盖率该是多少"给出了互相矛盾的答案，
 *         而谁都没错——它们各自是本地合理决定的总和。
 *
 *         **"散落"本身不是问题，"同一问题有多个互相矛盾的答案"才是。** 所以这里
 *         不追求"把所有阈值塞进一个文件"，而是保证：给定一个阈值概念，解析结果的
 *         (值, 来源) 是唯一确定且可解释的。
 *
 *         第二条要求是 #561 的教训：``COVERAGE_THRESHOLD:-80`` 让"没声明"和"声明
 *         为 80"在行为上完全相同，于是文档说 80%、实际生效 60% 时没有任何东西会报警。
 *         来源必须能让调用方区分这两种情况，否则"有效画像"还是一句空话。
 * @covers AC-605-01, AC-605-02, AC-605-03
 */
'use strict';

const { resolveCoverageThreshold, describeThreshold } = require('../coverage-threshold');

describe('覆盖率阈值单一真相源 (#605)', () => {
  it('AC-605-01: 未声明时标注为 implicit，并给出实际生效值', () => {
    const r = resolveCoverageThreshold({});
    expect(r.value).toBe(80);
    expect(r.source).toBe('implicit');
    expect(r.declared).toBe(false);
  });

  it('AC-605-02: 显式声明为同一个值时必须能与未声明区分', () => {
    // The #561 failure shape: `:-80` made "nobody said" and "someone said 80"
    // identical, so a doc claiming 80% while the live config said 60% raised no
    // alarm anywhere. Same number, different meaning, must stay distinguishable.
    const impl = resolveCoverageThreshold({});
    const expl = resolveCoverageThreshold({ vitest: { lines: 80 } });
    expect(impl.value).toBe(expl.value);
    expect(impl.source).not.toBe(expl.source);
    expect(expl.declared).toBe(true);
    expect(expl.source).toBe('vitest.config.ts');
  });

  it('AC-605-03: 两条闸门矛盾时必须报告冲突，而不是静默取一个', () => {
    // Measured state: vitest declares lines 60 while pre-commit defaults to 80.
    // Picking either silently is how a repo ends up "enforcing 80%" in a doc and
    // 60% in reality. Reporting the conflict is the only honest answer.
    const r = resolveCoverageThreshold({
      vitest: { lines: 60, statements: 60, functions: 81, branches: 79 },
      preCommit: 80,
    });
    expect(r.conflict).toBeTruthy();
    expect(r.conflict.hook).toBe(80);
    expect(r.conflict.vitest).toBe(60);
  });

  it('AC-605-03: 两条闸门一致时不算冲突', () => {
    const r = resolveCoverageThreshold({ vitest: { lines: 80 }, preCommit: 80 });
    expect(r.conflict).toBeFalsy();
  });

  it('AC-605-02: 冲突时两端数值都可单独查询，便于决定改哪边', () => {
    // The live state: `npx vitest run` goes green at 60% locally, then the commit
    // is blocked at 80%. That ordering is the worst one -- it reads as "my change
    // is fine" right up until it is rejected. Reporting both numbers lets the
    // reader see which declaration to move.
    const r = resolveCoverageThreshold({ vitest: { lines: 60 }, preCommit: 80 });
    expect(r.conflict.hook).toBe(80);
    expect(r.conflict.vitest).toBe(60);
    expect(describeThreshold(r)).toContain('CONFLICT');
  });

  it('AC-605-01: describeThreshold 让来源可被人类核对', () => {
    expect(describeThreshold(resolveCoverageThreshold({}))).toContain('implicit');
    expect(describeThreshold(resolveCoverageThreshold({ vitest: { lines: 75 } }))).toContain('vitest.config.ts');
  });
});
