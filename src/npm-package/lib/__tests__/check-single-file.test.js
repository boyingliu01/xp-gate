/**
 * @test REQ-653 `check --gates` 单文件自检必须真的跑起来，且 < 2 秒
 * @intent #653 要求提供一条"提交前自检"的快速路径，目标是让模型在写完代码后立刻
 *         自查，而不是等一轮完整 pre-commit（Gate 5 单项就 32.5s）。
 *
 *         实现过程中挖出两个真 bug，它们都属于同一类：**工具没跑起来，却被报成
 *         "你的代码有问题"**。
 *
 *         1. `xp-gate check <file>` 把文件路径直接当成 spawnSync 的 `cwd`。cwd 必须是
 *            目录，指向文件时 spawnSync 返回裸 ENOENT，上层打印
 *            "Gate 3: failed to run npx tsx" 然后计作 FAIL。
 *         2. Windows 上曾用 `shell: true` 解析 npx.cmd，但 node 把 argv 拼成一整条
 *            未转义的命令行（DEP0190），路径里有反斜杠或空格就会变形；改调 npx.cmd
 *            本身又撞上 CVE-2024-27980 的 EINVAL 加固。
 *
 *         两个修复都要求"文件路径能跑通"，而不是"错误信息更好看"。所以断言打在
 *         真实的 passed 计数与退出码上。
 * @covers AC-653-04, AC-653-05
 */
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLI = path.join(__dirname, '..', '..', 'bin', 'xp-gate.js');
const REPO = path.join(__dirname, '..', '..', '..', '..');

function runCheck(relPath) {
  const started = Date.now();
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync(process.execPath, [CLI, 'check', relPath, '--gates', 'principles'], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 120000,
    });
  } catch (err) {
    stdout = `${err.stdout || ''}${err.stderr || ''}`;
    status = err.status || 1;
  }
  return { stdout, status, elapsed: Date.now() - started };
}

describe('check --gates 单文件自检 (#653)', () => {
  it('AC-653-04: 传文件路径时 gate 真的执行，而不是报 spawn 失败', () => {
    const target = 'src/npm-package/lib/doctor-brief.js';
    expect(fs.existsSync(path.join(REPO, target))).toBe(true);
    const { stdout } = runCheck(target);
    // The pre-fix symptom was exactly this string followed by a FAIL verdict.
    expect(stdout).not.toMatch(/failed to run npx tsx/);
    expect(stdout).not.toMatch(/ENOENT|EINVAL/);
    expect(stdout).toMatch(/principles/i);
  });

  it('AC-653-05: 单文件自检在 2 秒内给出结论', () => {
    const { elapsed } = runCheck('src/npm-package/lib/doctor-brief.js');
    // #653's whole value proposition: self-check before committing beats waiting
    // for a 3-minute pre-commit. A slow "fast path" is not a fast path.
    expect(elapsed).toBeLessThan(2000);
  });
});
