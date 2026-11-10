/**
 * @test REQ-DEPLOY-002 shell/JS 清单一致性
 * @intent 部署清单存在两份实现：`src/npm-package/lib/deploy-manifest.js`（Node
 *   安装器读它）与 `src/npm-package/hooks/deploy-manifest.sh`（install.sh 读它）。
 *   两份各写一份清单，就是「同一事实有两个来源」——这正是本 REQ 要消灭的形态。
 *
 *   实测证据：`deploy-manifest.sh` 曾只有 DEPLOY_HOOK_FILES 与 DEPLOY_GATE_FILES，
 *   外加 `DEPLOY_HOOKS_LIB='lib'`（一个目录名，不是文件清单）。install.sh 因此
 *   glob 了 `hooks/lib/*`，而 adapter-common.sh / deploy-manifest.sh / install.sh
 *   （不在 lib/ 下）从未被安装。JS 侧补齐 MODULE_FILES 后，如果 shell 侧不同步，
 *   同一份清单就又分成两个事实来源。
 *
 *   这条测试的作用：让任何一侧的改动都必须同步另一侧，否则测试变红。
 * @covers AC-DEPLOY-002-01, AC-DEPLOY-002-02, AC-DEPLOY-002-03, AC-DEPLOY-002-04
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// src/npm-package/lib/__tests__/ -> lib/ -> npm-package/ -> src/ -> <repo root>
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const JS_MANIFEST = path.join(REPO_ROOT, 'src', 'npm-package', 'lib', 'deploy-manifest.js');
const SH_MANIFEST = path.join(REPO_ROOT, 'src', 'npm-package', 'hooks', 'deploy-manifest.sh');

/**
 * 在 bash 里 source shell 清单并把某个数组打印成一行一个元素。
 * 用真实 shell 求值，而不是正则解析——注释、引号风格、行序都不会造成误判。
 */
function readShellArray(name) {
  const script = `source "${SH_MANIFEST.replace(/\\/g, '/')}" && for x in "\${${name}[@]}"; do printf '%s\\n' "$x"; done`;
  const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
  return out.split('\n').filter((l) => l.length > 0);
}

describe('REQ-DEPLOY-002 shell/JS 清单一致性', () => {
  const js = require(JS_MANIFEST);

  describe('AC-DEPLOY-002-01: HOOK_FILES 两侧一致', () => {
    it('DEPLOY_HOOK_FILES 与 HOOK_FILES 逐项相等（顺序也一致）', () => {
      expect(readShellArray('DEPLOY_HOOK_FILES')).toEqual([...js.HOOK_FILES]);
    });
  });

  describe('AC-DEPLOY-002-02: GATE_FILES 两侧一致', () => {
    it('DEPLOY_GATE_FILES 与 GATE_FILES 逐项相等（顺序也一致）', () => {
      expect(readShellArray('DEPLOY_GATE_FILES')).toEqual([...js.GATE_FILES]);
    });
  });

  describe('AC-DEPLOY-002-03: MODULE_FILES 两侧一致', () => {
    it('DEPLOY_MODULE_FILES 与 MODULE_FILES 逐项相等（顺序也一致）', () => {
      expect(readShellArray('DEPLOY_MODULE_FILES')).toEqual([...js.MODULE_FILES]);
    });

    it('shell 侧确实有 DEPLOY_MODULE_FILES（而不是只剩一个 lib 目录名）', () => {
      const names = readShellArray('DEPLOY_MODULE_FILES');
      expect(names.length).toBeGreaterThan(0);
      // 旧形态的痕迹：DEPLOY_HOOKS_LIB 是一个目录名，不是文件清单
      expect(names).not.toContain('lib');
    });
  });

  describe('AC-DEPLOY-002-04: 三条清单互不重叠，且合起来覆盖 hooks/ 全部文件', () => {
    it('HOOK/GATE/MODULE 三份清单两两不相交', () => {
      const hook = new Set(js.HOOK_FILES);
      const gate = new Set(js.GATE_FILES);
      const mod = new Set(js.MODULE_FILES);

      const overlap = [
        [...hook].filter((f) => gate.has(f) || mod.has(f)),
        [...gate].filter((f) => mod.has(f)),
      ].flat();
      expect(overlap).toEqual([]);
    });

    it('枚举 hooks/ 得到的每个文件都被三条清单之一覆盖', () => {
      /**
       * 断言方式是**枚举目录**，不是比对一张手写清单。
       * 手写清单会随着目录变化而失效，而且失效时测试仍然为真——
       * 这正是本 REQ 要修的那类缺陷（清单"看起来"很全）。
       */
      const hooksDir = path.join(REPO_ROOT, 'src', 'npm-package', 'hooks');
      const declared = new Set([
        ...js.HOOK_FILES,
        ...js.GATE_FILES,
        ...js.MODULE_FILES,
        ...js.NON_DEPLOYABLE,
      ]);

      const missing = [];
      const walk = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walk(path.join(dir, entry.name), rel);
          } else if (!declared.has(rel)) {
            missing.push(rel);
          }
        }
      };
      walk(hooksDir, '');

      expect(missing).toEqual([]);
    });
  });
});
