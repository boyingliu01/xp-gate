/**
 * @test REQ-603 Flaky 测试治理：首过率度量、重试上限、隔离台账
 * @intent 指南 §11「Flaky 测试治理」整章空白：无重试上限、无首过率/重跑率度量、
 *         无隔离台账与到期机制。`xp-gate retro` 只统计 rework rate 和 gate pass rate，
 *         回答不了「我们的测试稳不稳」。
 *
 *         这个缺口有一个具体的代价：**不稳定的测试会被当成产品缺陷去修**。
 *         一个失败-run 如果只是抖动，开发者花在"修"它上面的时间全是浪费；
 *         而如果它是真的，把它当抖动重跑就是漏网。两条路都错在同一个地方——
 *         我们没有任何数据区分这两者。
 *
 *         三个设计决定：
 *
 *         1. **重跑成功不计入首过率。** 这是整个度量的立身之本。如果 `passed: true`
 *            不管是不是重跑得来的都算通过，首过率永远是 100%，度量就没有意义。
 *            记录必须显式携带 `attempt`，否则"重跑后通过"和"一次通过"在数据上
 *            无法区分——而这两者正是要区分的全部。
 *
 *         2. **重试必须有上限，且默认极小（1 次）。** 无上限重试等于把门禁变成
 *            "多试几次总会有一次过"，那是退让而不是治理。上限的作用是让抖动
 *            暴露出来，而不是让它消失。
 *
 *         3. **隔离台账必须有到期。** 没有到期的隔离就是永久删除（只是看起来还在）。
 *            这条和 #608 的 escape valve 同一条教训：没有失效机制的安全阀，
 *            一年后就成了常态。
 * @covers AC-603-01, AC-603-02, AC-603-03, AC-603-04
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { computeFlakyStats, parseQuarantine, findExpiredQuarantine, MAX_RETRIES } = require('../flaky');

function rec(overrides) {
  return {
    commit_hash: 'deadbeef',
    duration_ms: 1000,
    gate_id: '5',
    gate_name: 'Tests + Coverage',
    issues_found: 0,
    passed: true,
    repo_path: '/repo',
    timestamp: '2026-10-30T00:00:00Z',
    trigger: 'pre-commit',
    ...overrides,
  };
}

describe('flaky 测试治理 (#603)', () => {
  it('AC-603-01: 重跑后通过不计入首过率', () => {
    const stats = computeFlakyStats([
      rec({ passed: true, attempt: 1 }),
      rec({ passed: false, attempt: 1 }),
      rec({ passed: true, attempt: 2, previously_failed: true }),
      rec({ passed: true, attempt: 1 }),
    ]);
    // 4 个 gate 运行，其中 3 个是首次尝试（1 过 1 失 1 过 —— 第 4 条也是首次）。
    // 首过率 = 首过数 / 首次尝试数。重跑成功那一条既不算首过，也不算首次尝试。
    expect(stats.firstAttempts).toBe(3);
    expect(stats.firstPasses).toBe(2);
    expect(stats.firstPassRate).toBeCloseTo(66.7, 1);
    // 重跑成功被单独计量——这正是需要被看见的那一类。
    // 分母是全部运行（3 次首次 + 1 次重跑 = 4），所以 1/4 = 25%。
    expect(stats.flakyRecoveries).toBe(1);
    expect(stats.flakyRate).toBeCloseTo(25, 1);
  });

  it('AC-603-02: 没有重跑记录时 flakyRate 为 null 而非 0（不可测量≠零抖动）', () => {
    // 一个从没记录过重跑的 journal 说明不了"测试很稳"，只能说明"没度量"。
    // 报 0 会让读者以为已经量过而且是好的——和 #651 的 NOT MEASURABLE 同一条教训。
    const stats = computeFlakyStats([rec({ passed: true, attempt: 1 })]);
    expect(stats.flakyRate).toBeNull();
    expect(stats.measurable).toBe(false);
    expect(stats.reason).toBeTruthy();
  });

  it('AC-603-03: 重试上限有硬上限，配置不能无限放大', () => {
    // 无上限重试等于把门禁变成"多试几次总会有一次过"。
    expect(MAX_RETRIES).toBeGreaterThan(0);
    expect(MAX_RETRIES).toBeLessThanOrEqual(5);
    const { resolveMaxRetries } = require('../flaky');
    expect(resolveMaxRetries(undefined)).toBe(1);
    expect(resolveMaxRetries('0')).toBe(0);
    expect(resolveMaxRetries('99')).toBe(MAX_RETRIES);
    expect(resolveMaxRetries('-3')).toBe(0);
  });

  it('AC-603-04: 隔离台账解析出到期项，逾期必须被查出且核心链路不得长期隔离', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flaky-'));
    const file = path.join(dir, '.flaky-quarantine.yaml');
    fs.writeFileSync(file, [
      'quarantined:',
      '  - test: "src/a.test.ts > flaky one"',
      '    owner: alice',
      '    issue: 601',
      '    expiry: 2026-01-01',
      '    reason: "timing-dependent assertion"',
      '  - test: "src/b.test.ts > ok one"',
      '    owner: bob',
      '    issue: 602',
      '    expiry: 2099-01-01',
      '    reason: "upstream bug"',
      '  - test: "src/c.test.ts > critical"',
      '    owner: carol',
      '    issue: 603',
      '    expiry: 2099-01-01',
      '    reason: "known"',
      '    critical_path: true',
      '',
    ].join('\n'));
    const entries = parseQuarantine(file);
    expect(entries).toHaveLength(3);
    expect(entries[0].owner).toBe('alice');

    const expired = findExpiredQuarantine(entries, new Date('2026-06-01T00:00:00Z'));
    expect(expired.map((e) => e.owner)).toEqual(['alice']);

    const { findPolicyViolations } = require('../flaky');
    // A critical-path test may not sit in quarantine past its expiry either --
    // that is the whole point of marking it critical.
    const violations = findPolicyViolations(entries, new Date('2026-06-01T00:00:00Z'));
    const owners = violations.map((v) => v.entry.owner);
    expect(owners).toContain('alice');
    expect(owners).toContain('carol');
    expect(owners).not.toContain('bob');
  });
});
