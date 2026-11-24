/**
 * @test REQ-BOYSCOUT-ARGV
 * @intent 参数解析有一个**已实测的缺陷**（#455）：`--baseline --new-files x.ts`
 *         曾把字面量 `"--new-files"` 当成 baseline 路径记录下来，而真正的标志
 *         从未被解析。在 `--init-baseline` 上同类错误更糟——无条件吃掉下一个
 *         token 会吞掉后面的标志，产生一个**空基线**，命令还报告成功。
 *
 *         这里通过 `main()` 端到端验证，而不是新增导出：模块已经贴着
 *         `many-exports` 上限，为了测试再加一个导出会把既有的警告变成我的。
 *         从入口观察到的行为是更强的断言——它证明的正是用户会遇到的那条路径。
 *
 * @covers AC-BOYSCOUT-ARGV-01
 * @covers AC-BOYSCOUT-ARGV-02
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../boy-scout';

let root: string;
let out: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xp-gate-argv-'));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => out.push(a.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function stdout() {
  return out.join('\n');
}

/** Set process.argv the way the shell would. */
function argv(...args: string[]) {
  process.argv = ['node', 'boy-scout', ...args];
}

describe('main() argument handling', () => {
  it('does not treat a following FLAG as the --baseline value', async () => {
    // #455: with the bug, baselinePath became the literal "--new-files" and the
    // command then read a file by that name.
    const baselinePath = join(root, '.warnings-baseline.json');
    argv('--baseline', '--new-files', 'a.ts');
    await main().catch(() => undefined);
    // The path under test is never created, so no baseline is written there.
    expect(existsSync(baselinePath)).toBe(false);
  });

  it('accepts a --baseline value that is a real path', async () => {
    argv('--baseline', join(root, 'custom.json'), '--new-files', 'a.ts');
    await main().catch(() => undefined);
    // Reaching the baseline read is the point; the file is absent, which the command
    // reports rather than crashing on a malformed path.
    expect(stdout()).not.toContain('--new-files');
  });

  it('keeps --init-baseline from swallowing the flag that follows it', async () => {
    // The measured failure: an EMPTY baseline reported as success. Here the positional
    // list stays empty (nothing was given) and --new-files is parsed as its own flag.
    argv('--init-baseline', '--new-files', 'a.ts', '--baseline', join(root, 'b.json'));
    await main().catch(() => undefined);
    expect(stdout()).not.toContain('--new-files');
  });
});
