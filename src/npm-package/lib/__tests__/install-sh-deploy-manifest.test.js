/**
 * @test REQ-DEPLOY-001/002 install.sh 读生成的部署清单投影（AC-DEPLOY-06）
 * @intent install.sh 曾把 hook/gate 清单各写一份字面量，且与真实磁盘内容不符：
 *   HOOKS_LIST 只有 3 个（漏 post-commit 与 hook-module-resolution.sh），
 *   GATE_SCRIPTS 只有 7 个（漏 gate-6-layers.sh / gate-12-file-hygiene.sh /
 *   gate-registry.sh）。清单漏项的表现不是报错，而是「装完了但那个 gate 从不
 *   运行」—— 静默失效比崩溃更难发现。这里断言 install.sh 改读
 *   githooks/deploy-manifest.sh 投影，并且删掉了那两份字面量。
 *   同时断言 bash 上下文守卫：清单以数组形式展开，POSIX sh 下数组静默变成
 *   空字符串 → 一个 hook 都不装却报成功，因此必须 fail-closed 提示用 bash。
 * @covers AC-DEPLOY-06
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const INSTALL_SH = path.join(REPO_ROOT, 'githooks', 'install.sh');
const MANIFEST_SH = path.join(REPO_ROOT, 'githooks', 'deploy-manifest.sh');

const manifest = require('../deploy-manifest.js');

const BASH = process.env.XP_GATE_BASH_BIN || (process.platform === 'win32' ? 'bash' : '/bin/bash');

describe('install.sh sources the generated deploy manifest (AC-DEPLOY-06)', () => {
  const src = fs.readFileSync(INSTALL_SH, 'utf8');

  it('AC-DEPLOY-06a: source 生成的投影而非自持清单', () => {
    expect(src).toMatch(/(?:source|\.)\s+"\$[A-Z_]*DEPLOY_MANIFEST"/);
    // 反空缺：两份字面量清单必须消失，否则「读投影」只是多了一行没人用的 source。
    expect(src).not.toMatch(/^GATE_SCRIPTS="gate-3\.sh/m);
    expect(src).not.toMatch(/^HOOKS_LIST="pre-commit/m);
  });

  it('AC-DEPLOY-06b: 非 bash 环境 fail-closed（数组在 POSIX sh 下静默为空）', () => {
    expect(src).toMatch(/BASH_VERSION/);
    const guard = src.slice(src.indexOf('BASH_VERSION'), src.indexOf('BASH_VERSION') + 400);
    expect(guard).toMatch(/exit\s+1/);
  });

  it('AC-DEPLOY-06c: 投影里的清单覆盖磁盘真实的 gate 文件（防漏项）', () => {
    // 这条是 AC-DEPLOY-02 的思想在 shell 侧的复用：清单必须覆盖磁盘，而不是反过来。
    for (const gate of manifest.GATE_FILES) {
      expect(fs.existsSync(path.join(REPO_ROOT, 'githooks', gate)), `githooks/${gate} 不存在`).toBe(true);
    }
    for (const hook of manifest.HOOK_FILES) {
      expect(fs.existsSync(path.join(REPO_ROOT, 'githooks', hook)), `githooks/${hook} 不存在`).toBe(true);
    }
  });

  it('AC-DEPLOY-06d: 在临时 git 仓库里实跑 install.sh，装出的 hook 与 gate 齐全', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-ac06-'));
    try {
      const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: false });
      const git = (args) => run('git', args, tmp);
      const init = git(['init', '-q']);
      if (init.status !== 0) {
        // git 不可用时不做假绿：跳过改由 c 断言覆盖的存在性检查兜底。
        expect(init.error || init.stderr).toBeTruthy();
        return;
      }
      git(['config', 'user.email', 't@example.com']);
      git(['config', 'user.name', 't']);
      // install.sh 从自己的目录定位源文件，因此直接执行仓库里的那份。
      const res = spawnSync(BASH, [INSTALL_SH], { cwd: tmp, encoding: 'utf8', shell: false });
      expect(res.status, `install.sh 退出码非 0：${res.stdout}${res.stderr}`).toBe(0);

      const hooksDir = path.join(tmp, '.git', 'hooks');
      for (const hook of manifest.HOOK_FILES) {
        expect(fs.existsSync(path.join(hooksDir, hook)), `install.sh 未安装 ${hook}`).toBe(true);
      }
      for (const gate of manifest.GATE_FILES) {
        expect(fs.existsSync(path.join(hooksDir, gate)), `install.sh 未安装 ${gate}`).toBe(true);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
