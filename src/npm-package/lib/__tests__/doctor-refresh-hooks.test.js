/**
 * @test REQ-DOCTOR-REFRESH-HOOKS
 * @intent `--fix` 刷新陈旧 hook 的最后一步有两条不能松的规则：
 *
 *         1. **一个文件失败不能拖垮其余**。单个目标不可写不该让其它陈旧 hook
 *            留在旧版本上，因为它们本该在这一次一起修好。
 *         2. **被拒绝的文件必须警告"没有回滚"**。拒绝的理由是安装副本可能含有
 *            别处不存在的工作，所以操作者必须拿**自己留的副本**去判断，
 *            而不是指望撤销一次从未发生的覆盖。
 *
 * @covers AC-DOCTOR-REFRESH-01
 * @covers AC-DOCTOR-REFRESH-02
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshSafeHooks, reportBlockedHookSync } = require('../doctor.js');

let root;
let out;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xp-gate-refresh-'));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function text() {
  return out.join('\n');
}

function write(rel, body) {
  const target = join(root, rel);
  try {
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, body);
  } catch (e) {
    throw new Error(`cannot write fixture ${target}: ${e.message}`);
  }
  return target;
}

describe('refreshSafeHooks', () => {
  it('copies each safe entry and reports whether anything was refreshed', () => {
    const source = write('src/gate-4.sh', '#!/bin/bash\nv2\n');
    const target = join(root, 'installed/gate-4.sh');
    expect(refreshSafeHooks([{ name: 'gate-4.sh', source, target }])).toBe(true);
    expect(readFileSync(target, 'utf8')).toContain('v2');
  });

  it('makes the copied file executable', () => {
    // A hook without the execute bit is one git silently ignores, which looks exactly
    // like "the fix did nothing".
    const source = write('src/pre-commit', '#!/bin/bash\n');
    const target = join(root, 'installed/pre-commit');
    refreshSafeHooks([{ name: 'pre-commit', source, target }]);
    const mode = statSync(target).mode & 0o777;
    expect(mode & 0o111).not.toBe(0);
  });

  it('continues past a failing entry and reports it', () => {
    // One unwritable target must not strand the other outdated hooks.
    const okSource = write('src/good.sh', 'ok\n');
    const okTarget = join(root, 'installed/good.sh');
    const refreshed = refreshSafeHooks([
      { name: 'bad.sh', source: join(root, 'src/missing.sh'), target: join(root, 'x/bad.sh') },
      { name: 'good.sh', source: okSource, target: okTarget },
    ]);
    expect(refreshed).toBe(true);
    expect(readFileSync(okTarget, 'utf8')).toBe('ok\n');
  });

  it('returns false when nothing was refreshed', () => {
    expect(refreshSafeHooks([])).toBe(false);
  });

  it('skips an entry whose source disappeared since planning', () => {
    // Between planning and copying the file may be gone; skipping keeps the run going
    // instead of throwing out of a repair.
    expect(refreshSafeHooks([{ name: 'gone', source: join(root, 'nope'), target: join(root, 't') }])).toBe(false);
  });
});

describe('reportBlockedHookSync', () => {
  it('says nothing when the plan blocks nothing', () => {
    reportBlockedHookSync({ hasBlocking: false, diverged: [], unknown: [] });
    expect(text()).toBe('');
  });

  it('explains divergence with both line counts', () => {
    reportBlockedHookSync({
      hasBlocking: true,
      diverged: [{ name: 'gate-4.sh', installedOnly: 3, repoOnly: 1 }],
      unknown: [],
    });
    expect(text()).toContain('NOT refreshed');
    expect(text()).toContain('3 unique line(s)');
  });

  it('reports an unreadable copy separately from a divergent one', () => {
    // "could not be read" is not drift; it is an unknown, and the reader needs to
    // know which one they are looking at.
    reportBlockedHookSync({
      hasBlocking: true, diverged: [], unknown: [{ name: 'gate-8.sh' }],
    });
    expect(text()).toContain('could not be read');
  });

  it('states plainly that there is no rollback', () => {
    // The whole point of the refusal: judge against a copy YOU kept.
    reportBlockedHookSync({
      hasBlocking: true, diverged: [{ name: 'x', installedOnly: 1, repoOnly: 0 }], unknown: [],
    });
    expect(text()).toContain('no automatic backup');
    expect(text()).toContain('nothing');
    expect(text()).toContain('undo');
  });
});
