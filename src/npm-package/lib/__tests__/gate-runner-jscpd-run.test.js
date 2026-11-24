/**
 * @test REQ-GATE-RUNNER-JSCPD-RUN
 * @intent `runJscpd`（gate-runner.js 未覆盖的 75 条连续语句，全仓库最大单块）负责
 *         真正把 jscpd 跑起来。它的价值不在"调用工具"，而在**三层回退链**：
 *
 *           1. 找到 jscpd 的真实入口   -> node <entry>
 *           2. PATH 上直接有 jscpd     -> jscpd.cmd / jscpd
 *           3. 全局安装但不在 PATH     -> npx --no-install
 *
 *         每一层都是为一个实测过的失败形态存在（详见函数内注释：Windows 上
 *         `npx` ENOENT 却把装好的工具报成缺失）。
 *
 *         更关键的是它把输出 CAPTURE 下来再回放，而不是 `stdio: 'inherit'`：
 *         门禁要读 jscpd 说了什么才能区分"扫干净了"和"什么也没扫"（#855）。
 *
 * @covers AC-GATE-RUNNER-JSCPD-RUN-01
 * @covers AC-GATE-RUNNER-JSCPD-RUN-02
 */
'use strict';

const { runJscpd } = require('../gate-runner.js');

function captureWrites(run) {
  const out = [];
  const ow = process.stdout.write;
  const ew = process.stderr.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  process.stderr.write = (s) => { out.push(s); return true; };
  try { return { result: run(), out }; } finally {
    process.stdout.write = ow;
    process.stderr.write = ew;
  }
}

describe('runJscpd', () => {
  it('uses the resolved entry through node when one is found', () => {
    const calls = [];
    const { result } = captureWrites(() => runJscpd(['.run'], undefined, {
      findEntry: () => '/pkg/jscpd/bin/jscpd',
      spawn: (cmd, args) => {
        calls.push([cmd, args]);
        return { status: 0, stdout: 'Found 0 clones\n| Total: | 5 |', stderr: '' };
      },
    }));
    expect(result).toBe('clean');
    // argv goes to node untouched: no shell parses the ignore pattern's `|`.
    expect(calls[0][0]).toBe(process.execPath);
    expect(calls[0][1][0]).toBe('/pkg/jscpd/bin/jscpd');
  });

  it('falls back to a PATH lookup when no entry is found', () => {
    const calls = [];
    const { result } = captureWrites(() => runJscpd([], undefined, {
      findEntry: () => undefined,
      spawn: (cmd) => {
        calls.push(cmd);
        return { status: 0, stdout: 'Found 1 clone', stderr: '' };
      },
    }));
    expect(result).toBe('duplicates');
    expect(calls[0]).toMatch(/jscpd/);
  });

  it('tries the next attempt when one fails', () => {
    const tried = [];
    const { result } = captureWrites(() => runJscpd([], undefined, {
      findEntry: () => undefined,
      spawn: (cmd) => {
        tried.push(cmd);
        if (tried.length === 1) return { status: 1, stdout: '', stderr: 'boom' };
        return { status: 0, stdout: 'Found 0 clones\n| Total: | 3 |', stderr: '' };
      },
    }));
    // A first attempt failing is the normal case for the npx fallback.
    expect(tried.length).toBeGreaterThan(1);
    expect(result).toBe('clean');
  });

  it('replays captured output so the operator still sees it', () => {
    const { out } = captureWrites(() => runJscpd([], undefined, {
      findEntry: () => '/e',
      spawn: () => ({ status: 0, stdout: 'the jscpd report', stderr: '' }),
    }));
    // Capture-then-replay: the verdict needs the text, the operator needs it too.
    expect(out.join('')).toContain('the jscpd report');
  });

  it('throws when every attempt fails', () => {
    expect(() => captureWrites(() => runJscpd([], undefined, {
      findEntry: () => undefined,
      spawn: () => ({ status: 1, stdout: '', stderr: 'always fails' }),
    }))).toThrow(/jscpd/);
  });

  it('treats a spawn error as a failed attempt rather than a verdict', () => {
    let n = 0;
    const { result } = captureWrites(() => runJscpd([], undefined, {
      findEntry: () => undefined,
      spawn: () => {
        n += 1;
        if (n === 1) return { status: null, error: new Error('ENOENT') };
        return { status: 0, stdout: 'Found 2 clones', stderr: '' };
      },
    }));
    // "Could not launch" is not "found nothing" -- otherwise a missing binary
    // reads as a clean scan.
    expect(result).toBe('duplicates');
  });
});
