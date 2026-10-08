/**
 * @test REQ-502 the repair surface of doctor must not mutate the machine unasked
 * @intent Delphi code-walkthrough Round 1 给出两条修复面越界：(1) --fix 在
 *         langIssues>0 时直接 execSync 包管理器安装，#468 扩大检出语言后触发面变宽，
 *         一次 doctor --fix（或 xp-gate install 末尾自动跑的 doctor --fix）就会给
 *         机器装上新语言的工具；(2) install-cmd 把 doctor 的诊断退出码原样当作安装
 *         结果，#495 的 Module drift FAIL 会让"装成功却 exit 1"，训练脚本误判失败。
 *         另外 bin 的 usage 行没同步 --force/--install-tools，未知 flag 已被严格拒绝，
 *         帮助文本比实现更旧就会把人引向失败命令。
 * @covers AC-502-01, AC-502-02, AC-502-03
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOCTOR = readFileSync(join(__dirname, '..', 'doctor.js'), 'utf8');
const INSTALL_CMD = readFileSync(join(__dirname, '..', 'install-cmd.js'), 'utf8');
const BIN = readFileSync(join(__dirname, '..', '..', 'bin', 'xp-gate.js'), 'utf8');

describe('doctor/install repair boundary (#502)', () => {
  it('AC-502-01: language tool auto-install requires an explicit opt-in flag', () => {
    expect(DOCTOR).toMatch(/KNOWN_FLAGS\s*=\s*\[[^\]]*'--install-tools'/);
    // The execSync-backed installer must be gated by the flag, not just by --fix.
    expect(DOCTOR).toMatch(/if \(fixMode && installToolsFlag && langIssues > 0\)/);
    expect(DOCTOR).not.toMatch(/if \(fixMode && langIssues > 0\)\s*\{/);
  });

  it('AC-502-02: xp-gate install reports doctor findings without adopting its exit code', () => {
    expect(INSTALL_CMD).not.toMatch(/return doctorCode/);
    // The install action's own failure still has to fail the command.
    expect(INSTALL_CMD).toMatch(/return code/);
  });

  it('AC-502-03: the doctor usage line advertises every flag the parser accepts', () => {
    const usage = BIN.match(/usage: 'xp-gate doctor[^']*'/);
    expect(usage, 'bin/xp-gate.js has no doctor usage line').not.toBeNull();
    for (const flag of ['--fix', '--sync-hooks', '--force', '--install-tools']) {
      expect(usage[0], `usage line does not mention ${flag}`).toContain(flag);
    }
  });
});
