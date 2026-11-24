/**
 * @test REQ-LANG-AUDIT-VIEW
 * @intent `check-tools` 的人类可读输出是运维看的那一屏。它的价值全在**区分**：
 *
 *         - 装了但**不在 PATH** 上，和**没装**，在"通过/失败"列里长得一模一样，
 *           而补救动作正好相反（加 PATH 或建软链 vs 去安装）。#843 存在的原因
 *           就是这个——所以定位必须写进那一行。
 *         - 重复安装和过时是两种不同的问题，图标必须都能报出来。
 *         - 版本"未知"不能显示成"最新"。
 *
 * @covers AC-LANG-AUDIT-VIEW-01
 * @covers AC-LANG-AUDIT-VIEW-02
 * @covers AC-LANG-AUDIT-VIEW-03
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tools = require('../language-tools.js');

describe('statusOfRow', () => {
  it('maps availability to the two words the JSON contract uses', () => {
    expect(tools.statusOfRow({ available: true })).toBe('available');
    expect(tools.statusOfRow({ available: false })).toBe('missing');
  });
});

describe('iconOfRow', () => {
  it('shows absent, flagged and clean distinctly', () => {
    expect(tools.iconOfRow({ available: false })).toBe('✗');
    // Present but needing attention must not look identical to clean.
    expect(tools.iconOfRow({ available: true, duplicated: true })).toBe('⚠');
    expect(tools.iconOfRow({ available: true, outdated: true })).toBe('⚠');
    expect(tools.iconOfRow({ available: true })).toBe('✓');
  });
});

describe('qualifiersOfRow', () => {
  it('reports how many copies exist, not just that a duplicate exists', () => {
    const q = tools.qualifiersOfRow({ duplicated: true, distinctRealPaths: ['/a', '/b', '/c'] });
    expect(q).toContain('DUPLICATE ×3');
  });

  it('shows both versions on an outdated tool', () => {
    const q = tools.qualifiersOfRow({
      outdated: true, installedVersion: '2.14.0', latestVersion: '2.15.1',
    });
    expect(q).toContain('2.14.0 → 2.15.1');
  });

  it('says currency is UNKNOWN rather than implying it is current', () => {
    // Absence of an update check is not evidence of being up to date.
    const q = tools.qualifiersOfRow({ currency: 'unknown' });
    expect(q).toContain('version currency unknown');
  });

  it('names where a fallback-resolved binary was found', () => {
    // #843: "installed but not on PATH" and "not installed" call for opposite
    // actions, and look identical without this.
    const q = tools.qualifiersOfRow({
      available: true, resolution: 'fallback', resolvedPath: '/home/u/.local/bin/ruff',
    });
    expect(q).toContain('/home/u/.local/bin/ruff');
    expect(q).toContain('not on PATH');
  });

  it('carries the validity reason for an unavailable tool', () => {
    const q = tools.qualifiersOfRow({ available: false, validityReason: 'not executable' });
    expect(q).toContain('not executable');
  });

  it('returns an empty string when there is nothing to say', () => {
    // A clean row must not print an empty bracket.
    expect(tools.qualifiersOfRow({ available: true })).toBe('');
  });
});

describe('printAuditReport', () => {
  let out;

  beforeEach(() => {
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports every counter in the summary line', () => {
    // A summary that omits a counter hides exactly the category the reader needs.
    tools.printAuditReport(
      [{ name: 'ruff', available: true, installedVersion: '0.1.0' }],
      { total: 1, missing: 0, duplicated: 0, outdated: 0, unknown: 0, complete: true },
    );
    const text = out.join('\n');
    expect(text).toContain('1 tools');
    expect(text).toContain('0 missing');
    expect(text).toContain('unknown');
  });

  it('offers install-tools only when something is incomplete', () => {
    tools.printAuditReport([{ name: 'a', available: true }],
      { total: 1, missing: 1, duplicated: 0, outdated: 0, unknown: 0, complete: false });
    expect(out.join('\n')).toContain('install-tools');

    out.length = 0;
    tools.printAuditReport([{ name: 'a', available: true }],
      { total: 1, missing: 0, duplicated: 0, outdated: 0, unknown: 0, complete: true });
    expect(out.join('\n')).not.toContain('install-tools');
  });

  it('marks an npx-invoked tool so its version is not read as a PATH install', () => {
    tools.printAuditReport([{ name: 'jscpd', available: true, installedVersion: '3.0.0', npxInvoked: true }],
      { total: 1, missing: 0, duplicated: 0, outdated: 0, unknown: 0, complete: true });
    expect(out.join('\n')).toContain('via npx');
  });

  it('shows N/A rather than a blank when no version was resolved', () => {
    tools.printAuditReport([{ name: 'a', available: true }],
      { total: 1, missing: 0, duplicated: 0, outdated: 0, unknown: 0, complete: true });
    expect(out.join('\n')).toContain('N/A');
  });
});
