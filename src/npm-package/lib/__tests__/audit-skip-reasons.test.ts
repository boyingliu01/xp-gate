/**
 * @test REQ-AUDIT-SKIP-REASON
 * @intent 审计能回答"某个门禁为什么一次都没跑"，而不只是"它没跑"。
 *
 *         journal 本来就有原因：144 条 SKIP 里 142 条的 `detail` 有值。缺的是
 *         把它们**当成一个整体读出来**的能力——`audit --stats` 只给每个门禁的
 *         pass% 与平均耗时，所以"执行率 0%"可见，**原因不可见**。
 *
 *         而这个区别决定读者的行动：
 *           - `no_iac_files_changed` → 健康，没事可做
 *           - `checker_missing`      → 装错了，要修
 *         两者在旧视图里是同一个样子。
 *
 * @covers AC-AUDIT-SKIP-REASON-04 AC-AUDIT-SKIP-REASON-05
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeSkipReasons } from '../gate-audit';

/** Build a journal from minimal entries; only the fields the reducer reads. */
function journal(entries: Array<Record<string, unknown>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'audit-skipreasons-'));
  mkdirSync(join(dir, '.xp-gate'), { recursive: true });
  writeFileSync(
    join(dir, '.xp-gate', 'audit.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8',
  );
  return dir;
}

function entry(gate: string, status: string, detail?: string): Record<string, unknown> {
  return {
    timestamp: '2026-11-24T00:00:00.000Z',
    gate_id: gate,
    gate_name: gate,
    passed: status !== 'BLOCK',
    issues_found: 0,
    duration_ms: 10,
    trigger: 'commit',
    repo_path: '/repo',
    commit_hash: 'abc',
    gate_status: status,
    ...(detail === undefined ? {} : { detail }),
  };
}

describe('computeSkipReasons', () => {
  /**
   * @test REQ-AUDIT-SKIP-REASON
   * @intent 按原因分组并计数，且列出用该原因跳过的门禁
   * @covers AC-AUDIT-SKIP-REASON-04
   */
  it('groups SKIP rows by reason with their gates', () => {
    const dir = journal([
      entry('gate-7', 'SKIP', 'no_iac_files_changed'),
      entry('gate-7', 'SKIP', 'no_iac_files_changed'),
      entry('gate-12b', 'SKIP', 'checker_missing'),
      entry('gate-8', 'PASS'),
    ]);
    try {
      const buckets = computeSkipReasons(dir);
      expect(buckets).toHaveLength(2);
      expect(buckets[0].reason).toBe('no_iac_files_changed');
      expect(buckets[0].count).toBe(2);
      expect(buckets[0].gates).toEqual([{ gate_id: 'gate-7', count: 2 }]);
      expect(buckets[1].reason).toBe('checker_missing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * @test REQ-AUDIT-SKIP-REASON
   * @intent 没有原因的 SKIP 必须单独成桶，不能被丢掉或并进别的桶
   * @covers AC-AUDIT-SKIP-REASON-05
   */
  it('keeps reason-less SKIP rows visible in their own bucket', () => {
    const dir = journal([
      entry('gate-6', 'SKIP'),
      entry('gate-6', 'SKIP', '   '),
      entry('gate-3', 'SKIP', 'no_source_files_changed'),
    ]);
    try {
      const buckets = computeSkipReasons(dir);
      const none = buckets.find((b) => b.reason === '(no reason)');
      // An unnamed skip is a finding, not a rounding error: it must be counted.
      expect(none?.count).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * @test REQ-AUDIT-SKIP-REASON
   * @intent 非 SKIP 记录不得进入统计——否则"跳过原因"会被 PASS/WARN 的 detail 污染
   * @covers AC-AUDIT-SKIP-REASON-06
   */
  it('ignores detail from PASS and WARN rows', () => {
    const dir = journal([
      entry('gate-3', 'SKIP', 'ccn_threshold_exceeded'),
      entry('gate-3', 'PASS', 'ccn_threshold=5'),
      entry('gate-12', 'WARN', 'missing_eof_newline'),
    ]);
    try {
      const buckets = computeSkipReasons(dir);
      expect(buckets).toHaveLength(1);
      expect(buckets[0].reason).toBe('ccn_threshold_exceeded');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('computeSkipReasons: unexplained skips are named', () => {
  /**
   * @test REQ-AUDIT-SKIP-REASON
   * @intent 未记录原因的 SKIP 必须被单独标记，而不是与有原因的跳过分在一列里。
   *         门禁写了 `skip_reason=UNRECORDED` 表示"我跳过了但没记原因"——那是
   *         缺陷，不是解释。汇总若把它当普通字符串，读者无法区分
   *         "26 条跳过都解释了" 与 "26 条里有 3 条没解释"。
   * @covers AC-AUDIT-SKIP-REASON-07
   */
  it('flags UNRECORDED and reason-less rows as unexplained', () => {
    const dir = journal([
      entry('gate-3', 'SKIP', 'ccn_threshold=5; skip_reason=UNRECORDED'),
      entry('gate-5', 'SKIP', 'no_iac_files_changed'),
      entry('gate-6', 'SKIP'),
    ]);
    try {
      const buckets = computeSkipReasons(dir);
      const byReason = Object.fromEntries(buckets.map((b) => [b.reason, b]));
      expect(byReason['ccn_threshold=5; skip_reason=UNRECORDED'].unexplained).toBe(true);
      expect(byReason['no_iac_files_changed'].unexplained).toBe(false);
      expect(byReason['(no reason)'].unexplained).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
