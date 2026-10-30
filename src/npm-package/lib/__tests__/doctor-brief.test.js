/**
 * @test REQ-653 `doctor --brief` 必须一条命令给出全部环境事实
 * @intent 一个会话里 32.7% 的 shell 调用是纯探测（`where gcc`、`Test-Path`、
 *         逐文件 `Get-Content`、版本探测），每次 16s 上下。这类探测的共同点是
 *         **答案几乎不变**，却要为每个问题付一次往返。
 *
 *         `--brief` 的目标不是"少打印"，而是"一次问完"：模型拿到一屏结构化事实后
 *         不需要再探任何东西。所以验收标准是**覆盖率**，不是行数——90% 的常见
 *         探测问题必须能在这一屏里找到答案。
 *
 *         一个容易做错的地方：`--brief` 必须是**纯读取**。用户会因为"快"而频繁调用它，
 *         若它顺手修了什么（比如 `--fix` 的行为），频繁调用的代价就从延迟变成了状态。
 * @covers AC-653-01, AC-653-02, AC-653-03
 */
'use strict';

const { buildBriefReport, BRIEF_FACTS } = require('../doctor-brief');

describe('doctor --brief (#653)', () => {
  it('AC-653-01: 覆盖常见环境探测——语言工具链、hooks、门禁、覆盖率', () => {
    const report = buildBriefReport({ cwd: process.cwd() });
    const keys = Object.keys(report.facts);
    // Each of these replaces a class of exploratory probe that used to cost a
    // round trip. If one is missing, models go back to probing for it manually.
    for (const required of ['hooks', 'language', 'adapters', 'coverage', 'gateState']) {
      expect(keys).toContain(required);
    }
    expect(BRIEF_FACTS.length).toBeGreaterThanOrEqual(5);
  });

  it('AC-653-02: 输出必须是可直接消费的结构，不是需要再解析的散文', () => {
    const report = buildBriefReport({ cwd: process.cwd() });
    // A model that has to regex a sentence has not saved a round trip.
    expect(typeof report.facts.hooks.effectivePath).toBe('string');
    expect(Array.isArray(report.facts.language.detected)).toBe(true);
    expect(typeof report.facts.coverage.found).toBe('boolean');
    // One-line summary for humans, but the structure carries the facts.
    expect(typeof report.summary).toBe('string');
    expect(report.summary.split('\n').length).toBeLessThanOrEqual(3);
  });

  it('AC-653-03: --brief 纯读取，不修改任何状态', () => {
    const { execFileSync } = require('node:child_process');
    const fs = require('node:fs');
    const path = require('node:path');
    const before = fs.readdirSync(process.cwd()).sort().join('\n');
    try {
      execFileSync(process.execPath, [
        path.join(__dirname, '..', '..', 'bin', 'xp-gate.js'), 'doctor', '--brief', '--json',
      ], { cwd: process.cwd(), encoding: 'utf8', timeout: 120000 });
    } catch {
      // Exit code is not the assertion here; mutation is.
    }
    const after = fs.readdirSync(process.cwd()).sort().join('\n');
    // The real cost of a --fix sneaking in is not one bad run: users call --brief
    // often BECAUSE it is cheap, so an unintended write compounds every session.
    expect(after).toBe(before);
  });
});
