/**
 * @test REQ-480
 * @intent "测试基础设施" 的定义在 githooks/pre-push（bash）与 src/mutation/gate-m.ts
 *         （TypeScript）各写了一遍，没有共享常量的自然机制；一侧演化后 Gate M 与
 *         pre-push 会对同一变更集给出不一致裁决（Round 2 架构 MA-02 / 可行性 FC-03）。
 *         跨语言无法共用函数，退而求其次：把两处文本钉成同一份定义。
 * @covers AC-480-04
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const prePush = fs.readFileSync(path.join(repoRoot, 'githooks', 'pre-push'), 'utf8');
const gateM = fs.readFileSync(path.join(repoRoot, 'src', 'mutation', 'gate-m.ts'), 'utf8');

const prePushFilter =
  prePush.split('\n').find((line) => line.includes('CHANGED_SOURCE_FILES=')) || '';

describe('test-path filter parity between pre-push and gate-m (#480)', () => {
  it('compares a real filter line, not an empty string', () => {
    expect(prePushFilter).toContain('grep -v');
    expect(gateM).toContain('export function filterSourceFiles');
  });

  it('both sides exclude the same test-tree segments', () => {
    expect(prePushFilter).toContain('(tests?|__tests__)/');
    expect(gateM).toContain(String.raw`(^|\/)(tests?|__tests__)\/`);
  });

  it('both sides exclude declaration files and spec-named tests', () => {
    expect(prePushFilter).toContain(String.raw`\.d\.ts$`);
    expect(prePushFilter).toContain(String.raw`\.spec\.`);
    expect(gateM).toContain("endsWith('.d.ts')");
    expect(gateM).toContain("includes('.spec.')");
  });
});
