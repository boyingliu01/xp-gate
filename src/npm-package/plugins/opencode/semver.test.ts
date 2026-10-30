/**
 * @test REQ-562 插件版本比较必须正确，否则升级提示会撒谎
 * @intent `plugins/opencode/index.ts` 有 4 个 export，函数覆盖率 50%，且**没有任何
 *         测试文件**。它不是可选的样板：`semverLt` 决定"要不要提示用户升级"，
 *         在 3 处被调用（第 143/249/289 行）。
 *
 *         一个错的 `semverLt` 不会崩溃，只会让提示永远说"已是最新"或永远提示升级——
 *         两种都是"看起来在工作"。这类函数正是最该被钉住的：纯、无副作用、
 *         影响用户可见的行为。
 *
 *         这里只测导出的纯函数，不碰网络和文件系统——测试不该依赖 npm registry
 *         是否在线（那会让 CI 在断网时红，而问题不在代码里）。
 * @covers AC-562-03
 */
'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

const PLUGIN_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.ts');

describe('opencode 插件版本比较 (#562)', () => {
  let mod;

  beforeAll(async () => {
    // The plugin is TypeScript with an npm dependency on @opencode-ai/plugin, which
    // is only present in that workspace. Import through tsx so the test itself stays
    // runnable from the root suite.
    mod = await import(PLUGIN_ENTRY);
  });

  it('AC-562-03: 暴露了纯函数测试钩子', () => {
    expect(mod.__test).toBeDefined();
    expect(typeof mod.__test.semverLt).toBe('function');
  });

  it('AC-562-03: 主版本更高时判定为更小', () => {
    expect(mod.__test.semverLt('0.35.10', '0.36.0')).toBe(true);
    expect(mod.__test.semverLt('0.36.0', '0.35.10')).toBe(false);
  });

  it('AC-562-03: patch 与 minor 的位数差异不被误判', () => {
    // This is the case a naive string comparison gets wrong: "0.9.0" < "0.10.0"
    // lexicographically is 9 < 1 == false. Numeric segment compare must win.
    expect(mod.__test.semverLt('0.9.0', '0.10.0')).toBe(true);
    expect(mod.__test.semverLt('0.10.0', '0.9.0')).toBe(false);
  });

  it('AC-562-03: 前导 v 与缺失段被正确处理', () => {
    expect(mod.__test.semverLt('v0.35.10', '0.35.11')).toBe(true);
    // "0.35" is treated as 0.35.0, so it is LESS than 0.35.1 -- solid? No: it is
    // equal to 0.35.0, and 0.35 < 0.35.1. Asserting the documented behaviour keeps
    // a future refactor from silently changing missing-segment semantics.
    expect(mod.__test.semverLt('0.35', '0.35.1')).toBe(true);
    expect(mod.__test.semverLt('0.35.1', '0.35')).toBe(false);
  });

  it('AC-562-03: 相等版本不判定为更小', () => {
    // `upToDate = !semverLt(...)` -- if equal versions compared as "less", every
    // run would tell the user an update is available when there is none.
    expect(mod.__test.semverLt('0.35.11', '0.35.11')).toBe(false);
    expect(mod.__test.semverLt('v0.35.11', '0.35.11')).toBe(false);
  });
});
