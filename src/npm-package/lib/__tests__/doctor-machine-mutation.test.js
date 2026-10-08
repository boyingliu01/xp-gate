/**
 * @test REQ-502 Round 3: --fix must be the only way anything mutates the machine
 * @intent Round 2 的两位专家各自命中一条"修复面越界"的残留路径：
 *         (1) F7 只把 langIssues 那条分支挂上 --install-tools，而 fixIssues() 里的
 *             fixMissingCliTools() 仍然无条件 require('./bootstrap.js') 并 execSync
 *             安装缺失的门禁 CLI（gitleaks/semgrep/lizard…），`xp-gate install` 末尾
 *             又自动跑 doctor --fix —— 与 #502 立项时同一类、且被 F7 自己的注释否定；
 *         (2) fixStaleHooks() 用 updateHooks({force:true, noBackup:true, scope:'all'})
 *             覆盖 hooks/adapters/gate 脚本，而同一次发布里 syncModulesFromRepo 对
 *             同类风险显式拒绝并保留字节 —— 同一命令面内两套销毁标准，且 force 让
 *             update-hooks 的本地改动守卫直接返回 0，无备份地抹掉机器独有内容。
 * @covers AC-502-04, AC-502-05, AC-495-20
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOCTOR = readFileSync(join(__dirname, '..', 'doctor.js'), 'utf8');

function tempRoot(prefix) {
  return mkdtempSync(join(tmpdir(), `xp-gate-${prefix}-`));
}

function write(file, text) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}

describe('doctor machine-mutation boundary (#502/#495 Round 3)', () => {
  it('AC-502-04: the CLI-tool bootstrap is reachable only behind --install-tools', () => {
    // fixIssues must take the flag and gate the installer on it, exactly like the
    // language-tool branch already does.
    expect(DOCTOR).toMatch(/function fixIssues\([^)]*installToolsFlag/);
    expect(DOCTOR).toMatch(/if \(installToolsFlag\) \{\s*\n\s*fixed = fixMissingCliTools\(\) \|\| fixed;/);
    expect(DOCTOR).not.toMatch(/fixed = fixMissingCliTools\(\) \|\| fixed;\n\s*fixed = fixTuiRegistration/);
    // The call site has to hand it the flag; --fix alone must not.
    expect(DOCTOR).toMatch(/fixIssues\([^)]*installToolsFlag[^)]*\)/);
    // Guidance stays ungated: reporting is not a machine mutation.
    expect(DOCTOR).toMatch(/fixed = printCliToolGuidance\(\)/);
    // No second route into the installer.
    expect((DOCTOR.match(/require\('\.\/bootstrap\.js'\)/g) || []).length).toBe(1);
    expect(INSTALL_CMD_NEVER_OPTED_IN()).toEqual([]);
  });

  function INSTALL_CMD_NEVER_OPTED_IN() {
    const src = readFileSync(join(__dirname, '..', 'install-cmd.js'), 'utf8');
    const offenders = [];
    for (const call of src.match(/doctor\(\[[^\]]*\]\)/g) || []) {
      if (call.includes('--install-tools')) offenders.push(call);
    }
    return offenders;
  }

  it('AC-502-05: the stale-hook refresh writes only what the plan judged safe', () => {
    // A blanket forced updateHooks() overwrites exactly the files the plan just
    // refused, and the backup-less variant of it is what destroyed the machine-only
    // content in the first place. The repair surface is now a per-file copy of the
    // judged-safe entries; nothing in doctor forces, and nothing leaves .bak litter
    // in the user's work tree (#428's guard would reject that too).
    expect(DOCTOR).not.toMatch(/updateHooks\(\s*\{[^}]*force:\s*true/);
    expect(DOCTOR).toMatch(/for \(const entry of plan\.safe\)/);
    expect(DOCTOR).not.toMatch(/noBackup:/);
  });

  it('AC-495-20: planStaleHookSync splits stale files (safe to sync) from diverged ones (must be judged)', () => {
    const { planStaleHookSync } = require('../doctor');
    const root = tempRoot('stale-plan');
    const srcDir = join(root, 'pkg', 'githooks');
    const destDir = join(root, 'installed', 'adapters');

    write(join(srcDir, 'gate-4.sh'), '#!/bin/bash\nline_a\nline_b\n');
    write(join(destDir, 'gate-4.sh'), '#!/bin/bash\nline_a\n'); // stale: repo ahead
    write(join(srcDir, 'gate-8.sh'), '#!/bin/bash\nline_a\nline_b\n');
    write(join(destDir, 'gate-8.sh'), '#!/bin/bash\nline_a\nmachine_only_hardening\n'); // diverged
    write(join(srcDir, 'typescript.sh'), '#!/bin/bash\nline_a\nline_b\n');
    write(join(destDir, 'typescript.sh'), '#!/bin/bash\nline_a\nline_b\n'); // identical

    const plan = planStaleHookSync(
      ['gate-4.sh', 'gate-8.sh', 'typescript.sh'].map((name) => ({
        name,
        source: join(srcDir, name),
        target: join(destDir, name),
      })),
    );

    expect(plan.safe.map((e) => e.name)).toContain('gate-4.sh');
    expect(plan.diverged.map((e) => e.name)).toContain('gate-8.sh');
    expect(plan.diverged[0].installedOnly).toBe(1);
    expect(plan.unknown.map((e) => e.name)).toEqual([]);
    // A plan that is entirely safe is what allows the sync; one diverged file is not.
    expect(plan.hasBlocking).toBe(true);

    const unreadable = planStaleHookSync([{
      name: 'gate-9.sh',
      source: join(srcDir, 'gate-9.sh'),
      target: destDir, // directory where a file is expected
    }]);
    expect(unreadable.unknown.map((e) => e.name)).toContain('gate-9.sh');
    expect(unreadable.hasBlocking).toBe(true);

    // fixStaleHooks has to consult the plan instead of forcing over it.
    expect(DOCTOR).toMatch(/planStaleHookSync\(/);
    expect(DOCTOR).toMatch(/function fixStaleHooks[\s\S]{0,2000}plan\.hasBlocking/);
    expect(readFileSync(join(destDir, 'gate-8.sh'), 'utf8')).toContain('machine_only_hardening');
  });
});
