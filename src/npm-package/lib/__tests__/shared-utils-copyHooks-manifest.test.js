/**
 * @test REQ-DEPLOY-001 copyHooks 消费方接线（AC-DEPLOY-08/09）
 * @intent 验证 shared-utils.copyHooks 与 update-hooks.copyHooks 的 hook 文件列表
 *   来自 deploy-manifest.js 的单一事实源（HOOK_FILES），而非各自手写的字面量
 *   清单。update-hooks 原先只拷 3 个 hook（pre-commit/pre-push/post-merge），
 *   缺 post-commit 与 hook-module-resolution.sh——后者缺失会让 pre-commit 在
 *   任何 tier 决策前 fail-closed FATAL，即 AC-DEPLOY-09 记录的活 bug。
 *   接线后两者都从 HOOK_FILES 取，update-hooks 自动补齐 5 个。
 * @covers AC-DEPLOY-08, AC-DEPLOY-09
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const manifest = require('../deploy-manifest.js');
const updateHooks = require('../update-hooks.js');

const LIB_DIR = path.resolve(__dirname, '..');
const SHARED_UTILS = path.join(LIB_DIR, 'shared-utils.js');
const UPDATE_HOOKS = path.join(LIB_DIR, 'update-hooks.js');
const PKG_ROOT = path.resolve(LIB_DIR, '..');

describe('copyHooks consumers wire to deploy-manifest (REQ-DEPLOY-001)', () => {
  describe('AC-DEPLOY-08: 数据源统一，无私有清单', () => {
    it('shared-utils.js 从 deploy-manifest 取 hook 列表', () => {
      const src = fs.readFileSync(SHARED_UTILS, 'utf8');
      expect(src).toMatch(/require\(['"]\.\/deploy-manifest\.js['"]\)/);
      // 反空缺：硬编码字面量必须消失，否则"消费清单"只是注释里的一句话。
      expect(src).not.toMatch(/\['pre-commit'\s*,\s*'pre-push'/);
    });

    it('update-hooks.js 从 deploy-manifest 取 hook 列表', () => {
      const src = fs.readFileSync(UPDATE_HOOKS, 'utf8');
      expect(src).toMatch(/require\(['"]\.\/deploy-manifest\.js['"]\)/);
      expect(src).not.toMatch(/\['pre-commit'\s*,\s*'pre-push'\s*,\s*'post-merge'\]/);
    });

    it('init.js 已经由 shared-utils.copyHooks 间接消费（无需自持清单）', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, 'init.js'), 'utf8');
      expect(src).toMatch(/require\(['"]\.\/shared-utils\.js['"]\)/);
      expect(src).toMatch(/copyHooks/);
    });
  });

  describe('AC-DEPLOY-09: update-hooks 装出 HOOK_FILES 全集', () => {
    it('update-hooks.copyHooks 拷出 5 个 hook 与 lib/', () => {
      const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-ac09-'));
      try {
        updateHooks.copyHooks(PKG_ROOT, destDir, false, false);

        for (const hook of manifest.HOOK_FILES) {
          expect(
            fs.existsSync(path.join(destDir, hook)),
            `update-hooks 未部署 ${hook}——缺 hook-module-resolution.sh 会让 pre-commit FATAL`,
          ).toBe(true);
        }
        // 反空缺：hook 集必须恰好是 HOOK_FILES 的规模，不是"至少 3 个"。
        const shipped = fs
          .readdirSync(destDir, { withFileTypes: true })
          .filter(e => e.isFile() && manifest.HOOK_FILES.includes(e.name))
          .map(e => e.name);
        expect(shipped.sort()).toEqual([...manifest.HOOK_FILES].sort());
        expect(fs.existsSync(path.join(destDir, 'lib'))).toBe(true);
      } finally {
        fs.rmSync(destDir, { recursive: true, force: true });
      }
    });
  });
});
