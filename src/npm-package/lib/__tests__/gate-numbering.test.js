/**
 * @test REQ-686
 * @intent 验证 CLI 的门禁编号与钩子一致——钩子把 9 号门叫 Build integrity、
 *         10 号门叫 SAST，而 CLI 注册表把两者对调了；用户按报错提示单跑对应门
 *         会跑到另一道门上去（#677）
 * @covers AC-686-01, AC-686-02, AC-686-03
 *
 * 为什么必须直接断言注册表：这个错误的表现是「跑起来了、报告绿了」。
 * `xp-gate check --gates 9` 在编号错位时不会报错，它跑的是 semgrep 并如实报告
 * semgrep 的结果——只有拿它和钩子里的门名对照才能看出跑错了门。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { GATE_REGISTRY, resolveAlias } = require('../gate-runner');

const REPO_ROOT = path.join(__dirname, '../../../..');

/**
 * Concatenate every file that participates in the pre-commit gate chain: the
 * entry point, the ordered driver, and one body per gate.
 *
 * #798 moved each gate's banner and logic out of pre-commit into
 * gate-entries/. Assertions about gate NAMES must therefore read the whole
 * chain, or they pass while the names moved to a file nothing sources.
 * @returns {string} the chain's source text, newline-joined
 */
function readGateChain() {
  const parts = [fs.readFileSync(path.join(REPO_ROOT, 'githooks/pre-commit'), 'utf8')];
  const driver = path.join(REPO_ROOT, 'githooks/gate-driver.sh');
  if (fs.existsSync(driver)) parts.push(fs.readFileSync(driver, 'utf8'));
  const entriesDir = path.join(REPO_ROOT, 'githooks/gate-entries');
  if (fs.existsSync(entriesDir)) {
    for (const f of fs.readdirSync(entriesDir).sort()) {
      if (f.endsWith('.sh')) parts.push(fs.readFileSync(path.join(entriesDir, f), 'utf8'));
    }
  }
  return parts.join('\n');
}

describe('gate numbering matches the hook (#677)', () => {
  it('AC-686-01: gate 9 is Build Integrity and gate 10 is SAST Security', () => {
    expect(GATE_REGISTRY['9'].name).toBe('Build Integrity');
    expect(GATE_REGISTRY['10'].name).toBe('SAST Security');
  });

  it('AC-686-02: the hook agrees — its own output names 9 as Build integrity', () => {
    // Reads the hook rather than restating the constant: if the hook ever
    // renumbers again, this fails and points at which side moved.
    //
    // #798 moved each gate's banner into its own gate-entries/ file, so the
    // assertion reads the whole chain. It deliberately does NOT assert on
    // pre-commit alone: that would pass while every banner sat in a file no
    // hook sources -- the exact failure #677 was filed about.
    const hook = readGateChain();
    expect(hook).toMatch(/→ Gate 9: Build integrity/);
    expect(hook).toMatch(/GATE 10: Semgrep SAST/);
  });

  it('AC-686-03: aliases resolve to the gate the user meant', () => {
    expect(resolveAlias('sast')).toBe('10');
    expect(resolveAlias('semgrep')).toBe('10');
    expect(resolveAlias('build')).toBe('9');
  });

  it('AC-686-03: gates 12 and 13 are registered instead of "Unknown gate(s)"', () => {
    // Both block commits in the hook. Answering "Unknown gate" for a gate that just
    // blocked the user is the same category of wrong as running the wrong one.
    expect(GATE_REGISTRY['12'].name).toBe('File Hygiene');
    expect(GATE_REGISTRY['13'].name).toBe('Compiler Strictness');
    // They are registered as hook-only, with a stated reason -- not as runnable
    // stubs that would answer PASS without doing the work.
    expect(GATE_REGISTRY['12'].preCommitOnly).toBe(true);
    expect(GATE_REGISTRY['13'].preCommitOnly).toBe(true);
    expect(GATE_REGISTRY['12'].reason).toBeTruthy();
    expect(GATE_REGISTRY['13'].reason).toBeTruthy();
  });
});
