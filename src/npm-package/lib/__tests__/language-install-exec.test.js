/**
 * @test REQ-LANG-INSTALL-EXEC
 * @intent `install-tools` 会真的改动机器，所以它有两道必须守住的闸：
 *
 *         1. **自相矛盾的计划必须拒绝执行**。实测缺陷（2026-11-23）：hadolint 同时
 *            重复且过时，计划先删掉 ~/.local/bin/hadolint，再跑一个写入同一路径的
 *            安装器——重复副本立刻回来，修复静默地什么都没做成。拒绝执行并指出
 *            冲突动作，才能让操作者去修安装器命令。
 *         2. **一个动作失败不能拖垮其余**。操作者想要一次看到全部结果，而不是
 *            每次重跑发现一个新问题。
 *
 * @covers AC-LANG-INSTALL-EXEC-01
 * @covers AC-LANG-INSTALL-EXEC-02
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tools = require('../language-tools.js');

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

describe('reportSelfCancellingPlan', () => {
  it('returns false for an ordinary plan', () => {
    const refused = tools.reportSelfCancellingPlan({
      actions: [{ kind: 'install', tool: 'ruff', command: 'pip install ruff' }],
    });
    expect(refused).toBe(false);
    expect(text()).not.toContain('CONFLICT');
  });

  it('refuses a plan whose installer writes to the path it removes', () => {
    // The measured hadolint case: running this plan achieves nothing and reports
    // success, which is worse than failing.
    const refused = tools.reportSelfCancellingPlan({
      actions: [
        { kind: 'remove-duplicate', tool: 'hadolint', path: '/home/u/.local/bin/hadolint' },
        {
          kind: 'upgrade',
          tool: 'hadolint',
          writesToRemovedPath: true,
          conflictsWith: ['/home/u/.local/bin/hadolint'],
        },
      ],
    });
    expect(refused).toBe(1);
  });

  it('names the conflicting tool and the path that would come back', () => {
    // "Refused" alone leaves the operator with no idea what to fix.
    tools.reportSelfCancellingPlan({
      actions: [{
        kind: 'upgrade', tool: 'hadolint', writesToRemovedPath: true,
        conflictsWith: ['/home/u/.local/bin/hadolint'],
      }],
    });
    expect(text()).toContain('CONFLICT hadolint');
    expect(text()).toContain('/home/u/.local/bin/hadolint');
    expect(text()).toContain('Fix the installer command');
  });
});

describe('applyPlanActions', () => {
  function io(overrides = {}) {
    return { run: () => ({ status: 0 }), removeFile: () => true, ...overrides };
  }

  it('reports a removal as removed on success', () => {
    const failed = tools.applyPlanActions(
      [{ kind: 'remove-duplicate', path: '/a/jq' }],
      io({ removeFile: () => true }),
    );
    expect(failed).toBe(0);
    expect(text()).toContain('removed /a/jq');
  });

  it('counts a failed removal and says FAILED rather than removed', () => {
    // Printing "removed" for a file still on disk is the residue problem this whole
    // command exists to end.
    const failed = tools.applyPlanActions(
      [{ kind: 'remove-duplicate', path: '/a/jq' }],
      io({ removeFile: () => false }),
    );
    expect(failed).toBe(1);
    expect(text()).toContain('FAILED to remove');
  });

  it('counts a missing installer command as a failure instead of skipping it', () => {
    // The tool stays broken either way; only one of those tells the reader.
    const failed = tools.applyPlanActions([{ kind: 'install', tool: 'ruff' }], io());
    expect(failed).toBe(1);
    expect(text()).toContain('no installer command for this platform');
  });

  it('continues after a failing action and reports every outcome in one pass', () => {
    const failed = tools.applyPlanActions(
      [
        { kind: 'install', tool: 'a', command: 'cmd-a' },
        { kind: 'install', tool: 'b', command: 'cmd-b' },
        { kind: 'install', tool: 'c', command: 'cmd-c' },
      ],
      io({ run: (cmd) => ({ status: cmd === 'cmd-b' ? 2 : 0 }) }),
    );
    expect(failed).toBe(1);
    // All three ran: b's failure did not strand c.
    expect(text()).toContain('cmd-a');
    expect(text()).toContain('cmd-c');
    expect(text()).toContain('FAILED b (exit 2)');
  });

  it('treats a runner that returns nothing as a failure', () => {
    // A runner returning undefined must not read as success=0.
    const failed = tools.applyPlanActions(
      [{ kind: 'install', tool: 'a', command: 'cmd-a' }],
      io({ run: () => undefined }),
    );
    expect(failed).toBe(1);
  });
});
