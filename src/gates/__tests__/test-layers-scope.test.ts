/**
 * @test REQ-642 Test layering must see every test suite, not just src/*.test.ts
 * @intent `test-layers` 只扫描 `<repo>/src`，于是 166 个 BATS 套件（githooks/__tests__、
 *         scripts/__tests__ 等 shell 测试树）完全不参与统计。
 *
 *         后果不是"数字不好看"，而是**度量在说谎**：报告说 "Unit: 281, Integration: 0,
 *         E2E: 0"，读者据此得出"我们只有单元测试"。实际上这个仓库有 166 个 BATS 套件
 *         在跑真实的 git 钩子、真实的 shell 适配器、真实的进程——那是典型的集成测试。
 *         一个把 37% 的测试套件算作不存在的度量，不能用来判断测试策略对不对。
 *
 *         还有一个更隐蔽的失真：`pairRate` 的分母是**源文件**。BATS 测试测的是 shell
 *         脚本（`githooks/` 下的 .sh 文件），而那些文件不在 `src/` 下，所以它们永远配不上任何
 *         "源文件"——不是没配对，是根本没被纳入配对的计算范围。这两件事必须分开报：
 *         "没有对应测试" 和 "这类文件不参与配对" 是不同的问题。
 * @covers AC-642-01, AC-642-02, AC-642-03
 */
'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeTestLayers, discoverShellSuites } from '../test-layers.js';

/** Write `body` to `rel` under `root`, creating parent directories. */
function seedFile(root: string, rel: string, body = ''): void {
  const full = path.join(root, rel);
  try {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  } catch (err) {
    // Fail loudly: a silent fixture would make every assertion below pass
    // vacuously against an empty directory.
    throw new Error(`fixture setup failed for ${rel}: ${(err as Error).message}`);
  }
}

/** Build a fixture repo with both a TS tree and shell test trees. */
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'layers-'));
  // A paired TS source+test, and an unpaired one.
  seedFile(root, 'src/alpha/thing.ts', 'export const a = 1;\n');
  seedFile(root, 'src/alpha/__tests__/thing.test.ts', 'test("a", () => {});\n');
  seedFile(root, 'src/alpha/orphan.ts', 'export const b = 2;\n');
  // Shell suites outside src/.
  seedFile(root, 'githooks/__tests__/gate-one.test.bats', '@test "x" { true; }\n');
  seedFile(root, 'githooks/__tests__/gate-two.test.bats', '@test "y" { true; }\n');
  seedFile(root, 'scripts/__tests__/guard.test.cjs', 'test("z", () => {});\n');
  // A shell script that the BATS suites exercise.
  seedFile(root, 'githooks/pre-commit', '#!/bin/bash\necho hi\n');
  return root;
}

describe('test-layers 覆盖全仓套件 (#642)', () => {
  it('AC-642-01: BATS 套件被计入，不再报 0', () => {
    const root = makeFixture();
    const report = analyzeTestLayers(root);
    const shell = report.shellSuites;
    expect(shell).toBeDefined();
    // Two .test.bats files + one .test.cjs outside src/.
    expect(shell.total).toBe(3);
    expect(shell.bats).toBe(2);
    expect(report.summary.totalTests).toBe(4); // 1 TS + 3 outside src
  });

  it('AC-642-02: "未配对" 与 "不参与配对" 分开报，不混为一谈', () => {
    const root = makeFixture();
    const report = analyzeTestLayers(root);
    // src/alpha/orphan.ts genuinely has no test. unpairedSources are stored
    // relative to src/ with forward slashes, so compare against that exact form.
    expect(report.layer1.unpairedSources).toContain('alpha/orphan.ts');
    // githooks/pre-commit is exercised by BATS, not by a .test.ts pair. It must be
    // reported in its own bucket rather than inflating the unpaired count -- the
    // two imply different actions (write a test vs. exempt the pairing convention).
    expect(report.layer1.outOfScopeSources).toBeDefined();
    // The fixture's shell script lives outside src/, so it lands in the shell
    // bucket rather than the unpaired list.
    expect(report.shellSuites.files.some(f => f.includes('pre-commit') || f.includes('gate-one'))).toBe(true);
    expect(report.layer1.unpairedSources.some(f => f.includes('pre-commit'))).toBe(false);
  });

  it('AC-642-03: 没有 shell 套件时 shellSuites 全为 0 而非崩溃或 undefined', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'layers-empty-'));
    seedFile(root, 'src/.keep');
    const report = analyzeTestLayers(root);
    expect(report.shellSuites.total).toBe(0);
    expect(report.shellSuites.bats).toBe(0);
    expect(discoverShellSuites(root)).toEqual([]);
  });
});
