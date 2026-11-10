/**
 * @test REQ-DEPLOY-001 adapter-common 与 uninstall 枚举接线（AC-DEPLOY-05）
 * @intent copyAdapters 部署的 adapter-common.sh 文件名取自 deploy-manifest 的
 *   ADAPTER_COMMON 字段，uninstall 的"我拥有哪些 hook"枚举取自 HOOK_FILES——
 *   而不是各自再抄一份字面量。清单一旦是唯一事实源，安装方与卸载方就不可能
 *   对"装了什么"有分歧（uninstall 漏认领 post-commit 即会让它残留在用户仓库，
 *   装得进去、卸不干净）。
 * @covers AC-DEPLOY-05
 */
const fs = require('node:fs');
const path = require('node:path');

const manifest = require('../deploy-manifest.js');

const LIB_DIR = path.resolve(__dirname, '..');
const SHARED_UTILS = path.join(LIB_DIR, 'shared-utils.js');
const UNINSTALL = path.join(LIB_DIR, 'uninstall.js');

describe('adapter-common + uninstall enumeration wire to deploy-manifest (REQ-DEPLOY-001)', () => {
  it('AC-DEPLOY-05a: copyAdapters 的 adapter-common 名取自 ADAPTER_COMMON', () => {
    const src = fs.readFileSync(SHARED_UTILS, 'utf8');
    expect(src).toMatch(/require\(['"]\.\/deploy-manifest\.js['"]\)/);
    // 反空缺：部署目标路径里不能再出现字面量文件名。
    expect(src).not.toMatch(/path\.join\(destDir,\s*['"]adapter-common\.sh['"]\)/);
  });

  it('AC-DEPLOY-05b: uninstall 的 owned hook 枚举取自 HOOK_FILES', () => {
    const src = fs.readFileSync(UNINSTALL, 'utf8');
    expect(src).toMatch(/require\(['"]\.\/deploy-manifest\.js['"]\)/);
    expect(src).not.toMatch(/OWNED_HOOK_NAMES\s*=\s*\[\s*'pre-commit'/);
  });

  it('AC-DEPLOY-05c: 清单字段与磁盘实际文件名一致（adapter-common 确实叫这个名字）', () => {
    // 反空缺：若 ADAPTER_COMMON 与真实文件名不符，接线后 copyAdapters 会静默
    // 拷不到文件（existsSync 守卫把它变成一次无声跳过）。
    const pkgRoot = path.resolve(LIB_DIR, '..');
    expect(fs.existsSync(path.join(pkgRoot, manifest.ADAPTER_COMMON))).toBe(true);
    expect(fs.existsSync(path.join(pkgRoot, 'hooks', manifest.HOOKS_LIB))).toBe(true);
  });
});
