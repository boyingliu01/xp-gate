/**
 * @test REQ-DEPLOY-001 deploy-manifest 单一事实源
 * @intent 验证 deploy-manifest.js 是"包内部署文件→安装目标"清单的唯一事实源，
 *   防漏改断言遍历 canonical githooks/ 比对清单，拦截新增 hook/gate 脚本时漏改
 *   清单（#783 建议②：回归测试断言「包内该部署的每个文件都在清单里」）。
 * @covers AC-DEPLOY-01, AC-DEPLOY-02, AC-DEPLOY-03
 */
const fs = require('node:fs');
const path = require('node:path');

// TDD RED：deploy-manifest.js 尚未创建（本测试先提交，实现下一步）。
// require 抛 MODULE_NOT_FOUND → 整个套件红，是 RED 的合法起点。
const { HOOK_FILES, GATE_FILES, MODULE_FILES, ADAPTER_COMMON, HOOKS_LIB } = require('../deploy-manifest.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const GITHOOKS_DIR = path.join(REPO_ROOT, 'githooks');

describe('deploy-manifest (REQ-DEPLOY-001)', () => {
  describe('AC-DEPLOY-01 清单覆盖 canonical githooks/ 全集（防漏改）', () => {
    it('HOOK_FILES 覆盖 githooks/ 顶层每个普通 hook + hook-module-resolution.sh', () => {
      const topLevel = fs.readdirSync(GITHOOKS_DIR);
      // 普通 hook = 顶层无扩展名普通文件（pre-commit/pre-push/post-commit/post-merge）。
      // .sh 脚本单独分类（gate-*/sprint-gate/adapter-common/hook-module-resolution）；
      // install.sh/verify.sh 是安装器与开发工具，非部署到用户 hooks 的 hook，排除。
      const plainHooks = topLevel.filter(f => {
        const p = path.join(GITHOOKS_DIR, f);
        if (!fs.statSync(p).isFile()) return false;
        // 普通 hook 无扩展名（pre-commit/pre-push/post-commit/post-merge）。
        // 带扩展名的全部排除：.sh（gate-*/sprint-gate/adapter-common/
        // hook-module-resolution/install/verify 单独分类）、.md（文档）。
        if (f.includes('.')) return false;
        return true;
      });
      expect(plainHooks.sort()).toEqual(
        ['post-commit', 'post-merge', 'pre-commit', 'pre-push'],
      );
      for (const h of plainHooks) {
        expect(HOOK_FILES).toContain(h);
      }
      // hook-module-resolution.sh 是 #505 生成的解析表，随 hook 一起部署
      // （pre-commit 顶部 source 它，缺失则 fail-closed FATAL）。
      expect(HOOK_FILES).toContain('hook-module-resolution.sh');
    });

    it('GATE_FILES 覆盖 githooks/ 每个 gate-*.sh + sprint-gate.sh（11 个）', () => {
      const topLevel = fs.readdirSync(GITHOOKS_DIR);
      const gateFiles = topLevel.filter(f =>
        f.startsWith('gate-') && f.endsWith('.sh') &&
        fs.statSync(path.join(GITHOOKS_DIR, f)).isFile(),
      );
      // #798: `gate-driver.sh` matches the gate-*.sh NAME pattern but is not a
      // gate -- it is the driver that loads gate-entries/ and runs them in
      // XP_GATE_ORDER. It ships from MODULE_FILES. The assertion below still
      // requires it to be deployed SOMEWHERE, so a new file cannot slip through
      // by simply not matching the gate category: it must be in one of the two
      // lists, or this test fails.
      const DRIVER = 'gate-driver.sh';
      for (const g of gateFiles) {
        if (g === DRIVER) {
          expect(GATE_FILES).not.toContain(DRIVER);
          expect(MODULE_FILES).toContain(DRIVER);
          continue;
        }
        expect(GATE_FILES).toContain(g);
      }
      // ...and the driver must actually exist in the package, or the exemption
      // above would silently cover a file that was never shipped.
      expect(topLevel).toContain(DRIVER);
      // sprint-gate.sh（Gate S）与 gate 套件一起部署（copyAdapters/update-hooks 都拷它）
      expect(GATE_FILES).toContain('sprint-gate.sh');
      // v1 手抄漏 gate-12-file-hygiene.sh 的教训：显式钉死最易漏的成员
      expect(GATE_FILES).toContain('gate-12-file-hygiene.sh');
      expect(GATE_FILES).toContain('gate-registry.sh');
      expect(GATE_FILES).toContain('gate-6-layers.sh');
      // 11 -> 10 after githooks/gate-9.sh was deleted (#738/#717). That file was
      // never sourced by any hook: the SAST gate is gate-10.sh. Shipping it to
      // consumer repos advertised a gate script that could not run, and it let
      // a SAST fix be written into a file nothing executes. If this count grows
      // again, the new member must be a script some hook actually sources.
      expect(GATE_FILES).toHaveLength(10);
    });
  });

  describe('AC-DEPLOY-02 hooks 与 gates 无交集（两类部署目标）', () => {
    it('HOOK_FILES ∩ GATE_FILES = ∅', () => {
      const overlap = HOOK_FILES.filter(f => GATE_FILES.includes(f));
      expect(overlap).toEqual([]);
    });
  });

  describe('AC-DEPLOY-03 adapter-common 与 lib 独立字段', () => {
    it('ADAPTER_COMMON=adapter-common.sh，HOOKS_LIB=lib', () => {
      expect(ADAPTER_COMMON).toBe('adapter-common.sh');
      expect(HOOKS_LIB).toBe('lib');
    });
  });
});
