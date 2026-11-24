/**
 * @test REQ-SPRINT-STATUS-HELPERS
 * @intent 这些是 `sprint-status` 的解析与显示层。三层各自都有一个"看起来对、
 *         其实是猜"的失败方式：
 *
 *         1. **时间解析**：无法解析的时间戳必须变成 0（"不知道"），不能变成 NaN
 *            向上传染，也不能变成"现在"。0 让 `isStale` 返回 false——宁可不说
 *            陈旧，也不要错误地宣称新鲜。
 *         2. **陈旧判定**：取的是**所有**时间戳的最大值，不只是 started_at。
 *            一个跑了很久的 sprint 必须靠最近的 phase 活动来判定。
 *         3. **时长显示**：`null` 和 `0` 都返回空串。"瞬时"和"没测到"不能长得
 *            一样；而 0 秒的 phase 在表格里应该是空白，不是一个显眼的 0。
 *
 * @covers AC-SPRINT-STATUS-HELPERS-01
 * @covers AC-SPRINT-STATUS-HELPERS-02
 * @covers AC-SPRINT-STATUS-HELPERS-03
 */
import { describe, expect, it } from 'vitest';

const s = require('../sprint-status.js');

describe('parseTime', () => {
  it('parses an ISO timestamp to milliseconds', () => {
    expect(s.parseTime('2026-11-24T10:00:00.000Z')).toBe(Date.parse('2026-11-24T10:00:00.000Z'));
  });

  it('maps anything unparseable to 0, never NaN', () => {
    // NaN would propagate into Math.max and make every comparison false, which reads
    // as "not stale" by accident rather than by decision.
    expect(s.parseTime('not a date')).toBe(0);
    expect(s.parseTime(undefined)).toBe(0);
    expect(s.parseTime('')).toBe(0);
    expect(Number.isNaN(s.parseTime('nope'))).toBe(false);
  });
});

describe('getLatestTimestamp', () => {
  it('returns 0 when there is no start time', () => {
    expect(s.getLatestTimestamp(null)).toBe(0);
    expect(s.getLatestTimestamp({})).toBe(0);
  });

  it('takes the MAX across phase history, not just started_at', () => {
    // A sprint that began long ago but moved recently is NOT stale; using only
    // started_at would call it stale forever.
    const state = {
      started_at: '2026-01-01T00:00:00.000Z',
      phase_history: [
        { started_at: '2026-01-01T00:00:00.000Z', completed_at: '2026-11-20T00:00:00.000Z' },
        { timestamp: '2026-11-22T00:00:00.000Z' },
      ],
    };
    expect(s.getLatestTimestamp(state)).toBe(Date.parse('2026-11-22T00:00:00.000Z'));
  });

  it('falls back to started_at when phase history is absent or not an array', () => {
    const started = Date.parse('2026-11-01T00:00:00.000Z');
    expect(s.getLatestTimestamp({ started_at: '2026-11-01T00:00:00.000Z' })).toBe(started);
    expect(s.getLatestTimestamp({ started_at: '2026-11-01T00:00:00.000Z', phase_history: {} })).toBe(started);
  });
});

describe('isStale', () => {
  it('is false without a start time — unknown is not stale', () => {
    // Claiming "stale" for a state we cannot read would send the reader after a
    // problem that may not exist.
    expect(s.isStale(null)).toBe(false);
    expect(s.isStale({})).toBe(false);
  });

  it('is false for a sprint with recent activity', () => {
    expect(s.isStale({ started_at: new Date().toISOString() })).toBe(false);
  });

  it('is true for a sprint silent for longer than the threshold', () => {
    const longAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    expect(s.isStale({ started_at: longAgo })).toBe(true);
  });
});

describe('statusIcon', () => {
  it('gives each lifecycle state its own glyph', () => {
    const seen = new Set([
      s.statusIcon('completed'), s.statusIcon('in_progress'), s.statusIcon('skipped'),
    ]);
    // A taxonomy that renders two states identically is not a taxonomy.
    expect(seen.size).toBe(3);
  });

  it('uses a neutral glyph for an unknown status rather than a success one', () => {
    expect(s.statusIcon('something-new')).toBe('⏳');
  });
});

describe('formatDuration', () => {
  it('renders an empty string for null AND for zero', () => {
    // "instantaneous" and "not measured" must not look alike, and neither should
    // take visual weight in a table.
    expect(s.formatDuration(null)).toBe('');
    expect(s.formatDuration(0)).toBe('');
  });

  it('picks the largest sensible unit', () => {
    expect(s.formatDuration(59)).toBe('59s');
    expect(s.formatDuration(60)).toBe('1m');
    expect(s.formatDuration(3599)).toBe('59m');
    expect(s.formatDuration(3600)).toBe('1h 0m');
    expect(s.formatDuration(5400)).toBe('1h 30m');
  });
});

describe('buildMetricsLine', () => {
  it('returns null (not an empty string) when there is nothing to show', () => {
    // The caller checks for null to decide whether to print the line at all; an
    // empty string would print a blank row.
    expect(s.buildMetricsLine({})).toBeNull();
  });

  it('renders tests and coverage when present', () => {
    const line = s.buildMetricsLine({ tests_passed: 42, coverage_pct: 88.5 });
    expect(line).toContain('42 passed');
    expect(line).toContain('88.5%');
  });

  it('mentions failures only when there are some', () => {
    expect(s.buildMetricsLine({ tests_passed: 10 })).not.toContain('failed');
    expect(s.buildMetricsLine({ tests_passed: 10, tests_failed: 2 })).toContain('2 failed');
  });

  it('treats a zero coverage percentage as present, not absent', () => {
    // `0` is a measurement; `!= null` is what distinguishes it from "not measured".
    expect(s.buildMetricsLine({ coverage_pct: 0 })).toContain('0%');
  });
});
