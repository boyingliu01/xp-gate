/**
 * @test REQ-LANG-DESCRIBE
 * @intent `install-tools` 在执行前打印计划，用户据这一屏决定要不要加 `--yes`。
 *         所以每一行都必须**同时说清动作和对象**：
 *
 *         - 删除重复副本时必须说明**保留哪一个**——否则用户看到"移除"却不知道
 *           留下的是不是自己在用的那个；
 *         - 安装/升级必须显示**实际会执行的命令**，以及在不知道命令时**明说**
 *           不知道，而不是留空。
 *
 *         标签列的对齐不是装饰：一屏几十行，动作列对齐才扫得出来哪几行是移除。
 *
 * @covers AC-LANG-DESCRIBE-01
 * @covers AC-LANG-DESCRIBE-02
 */
import { describe, expect, it } from 'vitest';

const { describeAction } = require('../language-tools.js');

describe('describeAction', () => {
  it('names the copy being KEPT when removing a duplicate', () => {
    // The comma matters: without it the reader cannot tell whether the path after
    // the colon is being removed or kept.
    const line = describeAction({
      kind: 'remove-duplicate',
      tool: 'jq',
      path: '/home/u/.local/bin/jq',
      keepPath: '/usr/bin/jq',
    });
    expect(line).toContain('/home/u/.local/bin/jq');
    expect(line).toContain('keeping /usr/bin/jq');
  });

  it('shows the exact command for an install', () => {
    const line = describeAction({ kind: 'install', tool: 'ruff', command: 'pip install ruff' });
    expect(line).toContain('pip install ruff');
  });

  it('says the installer is unknown rather than leaving the field blank', () => {
    // A blank after the arrow reads as "this line is fine". It is not: the tool is
    // missing and nothing will install it.
    const line = describeAction({ kind: 'install', tool: 'ruff', command: null });
    expect(line).toContain('no installer known');
  });

  it('shows both versions on an upgrade', () => {
    const line = describeAction({
      kind: 'upgrade',
      tool: 'hadolint',
      from: '2.10.0',
      to: '2.12.0',
      command: 'brew upgrade hadolint',
    });
    expect(line).toContain('2.10.0');
    expect(line).toContain('2.12.0');
    expect(line).toContain('brew upgrade hadolint');
  });

  it('distinguishes a user copy from a system copy that is kept', () => {
    expect(describeAction({ kind: 'keep', tool: 'jq', path: '/usr/bin/jq' }))
      .toContain('keep  ');
    expect(describeAction({ kind: 'keep-system', tool: 'jq', path: '/usr/bin/jq' }))
      .toContain('keep (system)');
  });

  it('marks an optional tool as skipped so it is not chased', () => {
    const line = describeAction({ kind: 'skip-optional', tool: 'konsist' });
    expect(line).toContain('skip (optional)');
    expect(line).toContain('konsist');
  });

  it('falls back to the raw kind for an unknown action', () => {
    // Forward compatibility: a new kind added by a newer planner must still print
    // something identifiable rather than throwing inside a plan preview.
    const line = describeAction({ kind: 'frobnicate', tool: 'x' });
    expect(line).toContain('frobnicate');
    expect(line).toContain('x');
  });

  it('aligns the action column so the kinds line up on screen', () => {
    const TOOL_COLUMN = 18; // the widest padded action label ('skip (optional)   ')
    const install = describeAction({ kind: 'install', tool: 'TOOL', command: 'c' });
    const keep = describeAction({ kind: 'keep', tool: 'TOOL', path: '/p' });
    // The tool name must start at the same column in both lines, or a plan preview
    // cannot be scanned for "which lines remove something".
    expect(install.indexOf('TOOL')).toBe(TOOL_COLUMN);
    expect(keep.indexOf('TOOL')).toBe(TOOL_COLUMN);
  });
});
