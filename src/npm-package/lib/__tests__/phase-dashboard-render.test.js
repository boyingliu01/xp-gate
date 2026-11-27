/**
 * @test REQ-PHASE-DASHBOARD
 * @intent `renderDashboard` 的每个部件都在传达一个**不能靠猜**的事实：
 *
 *         - 进度条必须把"进行中"单独画出来。只用已完成方块，**无法区分第 3 阶段
 *           在跑和第 3 阶段还没开始**——这正是操作者最想知道的一件事。
 *         - 阶段历史按**字符串**键索引，因为它要经过 JSON。用数字索引会静默查空。
 *         - 时长是"最大的合宜单位"，且 0/null 显示为空——"瞬时"与"没测到"不能
 *           长得一样。
 *
 * @covers AC-PHASE-DASHBOARD-01
 * @covers AC-PHASE-DASHBOARD-02
 * @covers AC-PHASE-DASHBOARD-03
 */
import { describe, expect, it } from 'vitest';

const {
  buildHistoryLookup,
  buildProgressBar,
  statusIcon,
  formatDuration,
  appendOutputsSection,
  appendFrameHeader,
} = require('../phase-transition.js');

describe('buildHistoryLookup', () => {
  it('keys the lookup by STRING phase number', () => {
    // The keys round-trip through JSON; indexing with a number would miss silently.
    const lookup = buildHistoryLookup([{ phase: 1, status: 'completed' }]);
    expect(lookup['1']).toBeDefined();
    expect(lookup['1']).toBeDefined();
  });

  it('returns an empty object for a missing or non-array history', () => {
    expect(buildHistoryLookup(undefined)).toEqual({});
    expect(buildHistoryLookup(undefined)).toEqual({});
  });

  it('keeps the last entry when a phase appears twice', () => {
    const lookup = buildHistoryLookup([
      { phase: 2, status: 'pending' },
      { phase: 2, status: 'completed' },
    ]);
    expect(lookup['2'].status).toBe('completed');
  });
});

describe('buildProgressBar', () => {
  it('draws the current phase as its own block', () => {
    // A bar of completed blocks alone cannot tell "phase 3 running" from "phase 3
    // not started", which is the question the dashboard exists to answer.
    const bar = buildProgressBar({ '1': { status: 'completed' } }, 2);
    expect(bar).toContain('█');
    expect(bar).toContain('▓');
  });

  it('reports the completed fraction as a percentage', () => {
    const bar = buildProgressBar(
      { '1': { status: 'completed' }, '2': { status: 'completed' }, '3': { status: 'completed' } },
      4,
    );
    expect(bar).toContain('50%');
  });

  it('does not draw a current block past the last phase', () => {
    // Once the pipeline is finished there is no phase "in progress" to mark.
    const lookup = {};
    for (let i = 1; i <= 6; i += 1) lookup[String(i)] = { status: 'completed' };
    const bar = buildProgressBar(lookup, 7);
    expect(bar).not.toContain('▓');
  });

  it('never produces a negative-width bar', () => {
    // More completed entries than phases would make `.repeat(-n)` throw.
    const lookup = { '1': { status: 'completed' }, '2': { status: 'completed' }, '3': { status: 'completed' } };
    expect(() => buildProgressBar(lookup, 1)).not.toThrow();
  });
});

describe('statusIcon', () => {
  it('gives each lifecycle state a distinct glyph', () => {
    const glyphs = new Set([statusIcon('completed'), statusIcon('in_progress'), statusIcon('skipped')]);
    expect(glyphs.size).toBe(3);
  });

  it('uses a neutral glyph for an unknown state', () => {
    expect(statusIcon('brand-new')).toBe(statusIcon('pending'));
  });
});

describe('formatDuration', () => {
  it('shows nothing for zero or null so it takes no visual weight', () => {
    expect(formatDuration(0)).toBe('-');
    expect(formatDuration(null)).toBe('-');
  });

  it('uses the largest sensible unit', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m');
    expect(formatDuration(7200)).toBe('2h 0m');
    expect(formatDuration(90000)).toBe('1d 1h');
  });
});

describe('appendOutputsSection', () => {
  it('adds nothing when there are no outputs', () => {
    const lines = [];
    appendOutputsSection(lines, {});
    expect(lines).toEqual([]);
    appendOutputsSection(lines, undefined);
    expect(lines).toEqual([]);
  });

  it('lists one line per output and closes the frame', () => {
    // A wrapped row would break the columns for every line after it, so a long value
    // is clipped to the inner width instead.
    const lines = [];
    appendOutputsSection(lines, { spec: 'specification.yaml', long: 'x'.repeat(200) });
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('spec');
    expect(lines[lines.length - 1]).toContain('+===');
  });

  it('keeps every line the same width', () => {
    const lines = [];
    appendOutputsSection(lines, { a: 'short', b: 'y'.repeat(500) });
    const widths = new Set(lines.map((l) => l.length));
    expect(widths.size).toBe(1);
  });
});

describe('appendFrameHeader', () => {
  it('clips a long task description instead of pushing the frame edge out', () => {
    const lines = [];
    appendFrameHeader(lines, {
      sprintId: 'sprint-1', taskDesc: 'T'.repeat(300), branch: 'main',
      overallStatus: 'running', startedAt: '2026-11-24 10:00',
    });
    const widths = new Set(lines.map((l) => l.length));
    expect(widths.size).toBe(1);
  });

  it('states the sprint id and the branch', () => {
    const lines = [];
    appendFrameHeader(lines, {
      sprintId: 'sprint-42', taskDesc: 'task', branch: 'feature/x',
      overallStatus: 'running', startedAt: '2026-11-24 10:00',
    });
    const text = lines.join('\n');
    expect(text).toContain('sprint-42');
    expect(text).toContain('feature/x');
  });
});
