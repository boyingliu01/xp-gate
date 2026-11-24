/**
 * @test REQ-DOCTOR-SYNC-REPORT
 * @intent 同步报告是操作者判断"我的 githooks/ 到底装上没有"的唯一依据。三条规则：
 *
 *         1. **错误优先**：有错误就报错误并返回 1，不能同时说"已同步"——否则
 *            一半成功一半失败会读成全成功。
 *         2. **被拒绝的文件必须说清原因**：安装副本带有 githooks/ 没有的行，
 *            覆盖会删掉只存在于本机的工作。只写"未同步"会让人去 --force，
 *            而那正是会丢东西的操作。
 *         3. **空同步也要回话**：没有变化时明确说"已经一致"，而不是沉默。
 *            沉默与"没跑"无法区分。
 *
 * @covers AC-DOCTOR-SYNC-REPORT-01
 * @covers AC-DOCTOR-SYNC-REPORT-02
 * @covers AC-DOCTOR-SYNC-REPORT-03
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reportSyncResult } = require('../doctor.js');

let out;

beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function text() {
  return out.join('\n');
}

function base(overrides = {}) {
  return { synced: [], skipped: [], refused: [], errors: [], target: '/h', ...overrides };
}

describe('reportSyncResult', () => {
  it('returns 0 and reports nothing-to-do when everything already matches', () => {
    // Silence here would be indistinguishable from "the command never ran".
    expect(reportSyncResult(base({ skipped: ['pre-commit'] }))).toBe(0);
    expect(text()).toContain('already match');
    expect(text()).toContain('pre-commit');
  });

  it('reports a sync and says when it takes effect', () => {
    expect(reportSyncResult(base({ synced: ['pre-commit', 'pre-push'] }))).toBe(0);
    expect(text()).toContain('Synced pre-commit, pre-push');
    expect(text()).toContain('next commit');
  });

  it('fails on errors and does NOT also claim a successful sync', () => {
    // A half-successful run reported as success is the failure mode this ordering
    // prevents: errors are checked FIRST and short-circuit.
    const code = reportSyncResult(base({ synced: ['pre-commit'], errors: ['pre-push: EACCES'] }));
    expect(code).toBe(1);
    expect(text()).toContain('pre-push: EACCES');
    expect(text()).not.toContain('✓ Synced');
  });

  it('explains why a divergent file was refused, with both line counts', () => {
    // "not synced" alone invites --force, which is the operation that deletes work.
    const code = reportSyncResult(base({
      refused: [{ name: 'gate-4.sh', installedOnly: 3, repoOnly: 0 }],
      refusedLabel: 'module(s)',
    }));
    expect(code).toBe(0);
    expect(text()).toContain('gate-4.sh');
    expect(text()).toContain('3 unique line(s)');
    expect(text()).toContain('githooks/');
  });

  it('names the escape hatch and says the previous version is backed up', () => {
    // The operator needs to know that --force is possible AND that it is recoverable,
    // or they will either not use it or use it blindly.
    reportSyncResult(base({
      refused: [{ name: 'x.sh', installedOnly: 1, repoOnly: 0 }],
      refusedLabel: 'shared library file(s)',
    }));
    expect(text()).toContain('--sync-hooks --force');
    expect(text()).toContain('backups/');
  });

  it('uses the caller-supplied noun so the two sync groups read correctly', () => {
    reportSyncResult(base({
      refused: [{ name: 'a', installedOnly: 1, repoOnly: 0 }],
      refusedLabel: 'shared library file(s)',
    }));
    expect(text()).toContain('shared library file(s) NOT synced');
  });

  it('says "nothing to sync" when the skipped list is empty but skip was signalled', () => {
    // `skipped: []` with a truthy field still means "we compared and found nothing",
    // which is a different statement from "we did not compare".
    reportSyncResult({ ...base(), skipped: [] });
    expect(text()).toMatch(/already match|nothing to sync/);
  });
});
