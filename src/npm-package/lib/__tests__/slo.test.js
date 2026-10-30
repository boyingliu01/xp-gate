/**
 * @test REQ-609 SLO 三态判定：PASS / MISS / UNKNOWN 必须互不可替代
 * @intent 六项 SLO 的价值不在数字本身，而在"能不能行动"。
 *
 *         这里断言的是**状态机**，不是阈值算术：
 *
 *           - 没数据 -> UNKNOWN，既不报通过也不报失败
 *           - 有数据但越界 -> MISS（唯一需要行动的状态）
 *           - 文件丢失目标为 0 时，"没跑过守卫" 不得算成 PASS
 *
 *         最后一条是本模块最容易被写错的地方：`0 <= 0` 恒真，所以任何按
 *         数值比较的实现都会在没有观测时报告"零文件丢失"——那是对**没有发生
 *         观测**和**观测到零**的混淆，与 #554 门禁没跑却报通过同源。
 * @covers AC-609-01, AC-609-02, AC-609-03
 */
'use strict';

const { evaluateSlo, evaluateAll, summariseStates, SLO_DEFINITIONS, STATES } = require('../slo');

describe('SLO 三态判定 (#609)', () => {
  it('AC-609-01: 无数据返回 UNKNOWN 而不是 PASS 或 MISS', () => {
    for (const id of ['first_build_pass', 'flaky_rate', 'file_loss']) {
      const r = evaluateSlo(id, null);
      expect(r.state).toBe(STATES.UNKNOWN);
      expect(r.value).toBeNull();
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('AC-609-01: 有价值的 0 与无数据必须可区分', () => {
    // flaky_rate = 0 is a real, excellent measurement; null is not a measurement.
    const zero = evaluateSlo('flaky_rate', 0);
    const absent = evaluateSlo('flaky_rate', null);
    expect(zero.state).toBe(STATES.PASS);
    expect(absent.state).toBe(STATES.UNKNOWN);
    expect(zero.state).not.toBe(absent.state);
  });

  it('AC-609-02: min 方向越界是 MISS，达标是 PASS', () => {
    expect(evaluateSlo('first_build_pass', 90).state).toBe(STATES.PASS);
    expect(evaluateSlo('first_build_pass', 89.9).state).toBe(STATES.MISS);
  });

  it('AC-609-02: max 方向越界是 MISS，零违规是 PASS', () => {
    expect(evaluateSlo('ci_wasted_trigger', 20).state).toBe(STATES.PASS);
    expect(evaluateSlo('ci_wasted_trigger', 20.1).state).toBe(STATES.MISS);
  });

  it('AC-609-03: file_loss 目标为 0 时，没有样本不算 PASS', () => {
    // `0 <= 0` passes a naive comparison. Without an observation, the honest
    // answer is UNKNOWN -- same defect class as a gate that reports success
    // without running.
    const noSamples = evaluateSlo('file_loss', 0);
    expect(noSamples.state).toBe(STATES.UNKNOWN);
  });

  it('AC-609-03: file_loss 有样本且为 0 才算 PASS', () => {
    const observed = evaluateSlo('file_loss', 0, { samples: 12 });
    expect(observed.state).toBe(STATES.PASS);
    expect(observed.sampleCount).toBe(12);
  });

  it('AC-609-03: file_loss 有样本且非 0 是 MISS', () => {
    expect(evaluateSlo('file_loss', 3, { samples: 12 }).state).toBe(STATES.MISS);
  });

  it('AC-609-01: 每项 SLO 都声明了数据来源', () => {
    // A metric whose provenance is unstated cannot be verified, so it cannot be
    // trusted -- and an untrusted SLO panel is worse than no panel.
    for (const def of SLO_DEFINITIONS) {
      expect(def.source).toBeTruthy();
      expect(def.describe).toBeTruthy();
    }
  });

  it('AC-609-01: evaluateAll 覆盖全部六项且计数自洽', () => {
    const rows = evaluateAll({ first_build_pass: 95, flaky_rate: null });
    expect(rows).toHaveLength(SLO_DEFINITIONS.length);
    const counts = summariseStates(rows);
    expect(counts.total).toBe(SLO_DEFINITIONS.length);
    expect(counts.PASS + counts.MISS + counts.UNKNOWN).toBe(counts.total);
    expect(counts.PASS).toBe(1);
    expect(counts.UNKNOWN).toBe(SLO_DEFINITIONS.length - 1);
  });

  it('AC-609-02: 未知 SLO id 抛错而不是静默返回', () => {
    expect(() => evaluateSlo('no_such_slo', 1)).toThrow(/unknown SLO id/);
  });
});
