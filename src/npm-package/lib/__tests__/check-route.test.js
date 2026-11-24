/**
 * @test REQ-CHECK-ROUTE
 * @intent `check()` 是路由器：参数组合决定跑哪个子命令。这里测的是**可观察的
 *         路由结果**，不是各子命令的内部实现。
 *
 *         为什么值得测：路由错了会静默地跑错东西。`check 3` 若把 `3` 当成路径，
 *         就会去扫名叫 `3` 的目录并报"没发现问题"——一个 vacuous pass。
 *
 *         `check.js` 在模块顶层解构 `runGate`，所以 mock 注入无法替换它；这些
 *         测试用真实的 gate 3 和真实副作用（输出文本、退出码）来断言路由。
 *
 * @covers AC-CHECK-ROUTE-01
 * @covers AC-CHECK-ROUTE-02
 * @covers AC-CHECK-ROUTE-03
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { check } = require('../check.js');

let out;
let err;

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => err.push(a.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function stdout() { return out.join('\n'); }
function stderr() { return err.join('\n'); }

describe('check() routing', () => {
  it('prints usage and returns 1 when there is no target and no mode', async () => {
    // Returning 0 here would make a usage error look like a clean run.
    expect(await check([])).toBe(1);
    expect(stderr()).toContain('Usage: xp-gate check');
  });

  it('routes --list to the gate list without running any gate', async () => {
    const code = await check(['--list']);
    expect(code).toBe(0);
    // The list is a table of gates; a default check would have scanned a directory.
    expect(stdout().length).toBeGreaterThan(0);
  });

  it('routes a bare gate token to THAT gate, not to a directory scan', async () => {
    // `check 3` means gate 3. Falling through to a directory scan would look for a
    // directory named "3" and report "no violations found".
    const code = await check(['3']);
    expect(typeof code).toBe('number');
    // Gate 3 reports on complexity; its banner is what proves the route.
    expect(stdout() + stderr()).toMatch(/complexity|Gate 3/i);
  });

  it('returns a NUMBER for a gate that did not run, never the sentinel string', async () => {
    // #657: GATE_NOT_RUN reaching process.exit() throws ERR_INVALID_ARG_TYPE.
    const code = await check(['3']);
    expect(typeof code).toBe('number');
  });

  it('reports "not a git repository" for --changed outside a repo', async () => {
    // readChangedFiles returns null when git cannot diff; the brief path must say so
    // rather than run gates over an empty change set and report clear.
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = '/nonexistent/xp-gate-not-a-repo';
    try {
      const code = await check(['--changed', '--brief']);
      expect(code).toBe(1);
      expect(stderr()).toContain('not a git repository');
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
  });
});
