/**
 * @test REQ-DEPLOY-002 部署清单完整性（一个都不能漏）
 * @intent 证明「部署清单是完整集合」这件事本身必须是被断言的，而不是靠人记得
 *   同步四处清单。既有 REQ-DEPLOY-001 的断言按**类别**检查（普通 hook / gate-*.sh），
 *   于是 adapter-common.sh、deploy-manifest.sh、install.sh、lib/ 这四类落进了
 *   类别的缝里：它们既不是「无扩展名的普通 hook」，也不是「gate-*.sh」，
 *   于是从来没有一条断言问过「它们在哪份清单里」。
 *
 *   本测试换一种提法：**枚举 src/npm-package/hooks/ 下的每一个文件**（递归），
 *   要求每个文件要么出现在 HOOK_FILES ∪ GATE_FILES ∪ MODULE_FILES 中，
 *   要么出现在一份显式的 NON_DEPLOYABLE 名单里且该名单本身被断言最小化。
 *   枚举目录、不比对硬编码清单——这是关键：比对硬编码清单时「漏了」和
 *   「本来就不该有」看起来一样，永远不会红。
 * @covers AC-DEPLOY-002-01, AC-DEPLOY-002-02, AC-DEPLOY-002-03,
 *          AC-DEPLOY-002-04, AC-DEPLOY-002-05
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const HOOKS_SRC = path.join(REPO_ROOT, 'src', 'npm-package', 'hooks');

/**
 * RED 起点：MODULE_FILES 与 NON_DEPLOYABLE 尚未在 deploy-manifest.js 中导出。
 * 解构得到 undefined，因此下面涉及它们的断言会失败——这就是 RED。
 */
const manifest = require('../deploy-manifest.js');
const { HOOK_FILES, GATE_FILES } = manifest;
const MODULE_FILES = manifest.MODULE_FILES;
const NON_DEPLOYABLE = manifest.NON_DEPLOYABLE;

/**
 * 递归枚举目录下的每个**文件**（相对路径，正斜杠）。
 * 目录本身不返回，但目录下的文件全部返回——这样 hooks/lib/now-ms.sh
 * 会以 'lib/now-ms.sh' 的形式出现在结果里，不可能被"按目录名"糊弄过去。
 */
function enumerateFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...enumerateFiles(path.join(dir, entry.name), rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out.sort();
}

describe('REQ-DEPLOY-002 部署清单完整性', () => {
  describe('AC-DEPLOY-002-01: 每份清单都被导出且为只读', () => {
    it('deploy-manifest 导出 MODULE_FILES 与 NON_DEPLOYABLE', () => {
      expect(Array.isArray(MODULE_FILES)).toBe(true);
      expect(Array.isArray(NON_DEPLOYABLE)).toBe(true);
    });

    it('两份新清单与既有清单一样被冻结，防止运行时被改写', () => {
      expect(Object.isFrozen(MODULE_FILES)).toBe(true);
      expect(Object.isFrozen(NON_DEPLOYABLE)).toBe(true);
      expect(Object.isFrozen(HOOK_FILES)).toBe(true);
      expect(Object.isFrozen(GATE_FILES)).toBe(true);
    });
  });

  describe('AC-DEPLOY-002-02: hooks/ 下每个文件都被某份清单覆盖（核心断言）', () => {
    it('枚举 hooks/ 得到的每个文件都在三份清单之一的并集里，或在 NON_DEPLOYABLE 中', () => {
      const allFiles = enumerateFiles(HOOKS_SRC);
      expect(allFiles.length).toBeGreaterThan(0);

      const covered = new Set([...HOOK_FILES, ...GATE_FILES, ...MODULE_FILES]);
      const exempt = new Set(NON_DEPLOYABLE);

      const uncovered = allFiles.filter(
        (f) => !covered.has(f) && !exempt.has(f),
      );

      // 这条失败时的输出就是「哪些文件没有任何清单认领」，可直接照着补。
      expect(uncovered).toEqual([]);
    });

    it('被清单认领的文件都必须真实存在于 hooks/ 下（防清单写了不存在的文件）', () => {
      const allFiles = new Set(enumerateFiles(HOOKS_SRC));
      const declared = [...HOOK_FILES, ...GATE_FILES, ...MODULE_FILES];
      const missing = declared.filter((f) => !allFiles.has(f));
      expect(missing).toEqual([]);
    });
  });

  describe('AC-DEPLOY-002-03: NON_DEPLOYABLE 必须最小且逐项有理由', () => {
    it('NON_DEPLOYABLE 为空——hooks/ 下每个文件都应被部署', () => {
      // 实测：find src/npm-package/hooks -type f 得到 39 个文件，每一个都该部署。
      // 若将来确实出现不该部署的文件，这一条会红，迫使那次决策被显式记录在此，
      // 而不是悄悄往数组里加一行。
      expect([...NON_DEPLOYABLE]).toEqual([]);
    });

    it('NON_DEPLOYABLE 里不得出现任何 .sh 脚本或非点开头的文件', () => {
      const suspicious = NON_DEPLOYABLE.filter(
        (f) => f.endsWith('.sh') || !f.startsWith('.'),
      );
      expect(suspicious).toEqual([]);
    });

    it('NON_DEPLOYABLE 中的每一项都真实存在于 hooks/ 下（防豁免失效）', () => {
      // 豁免一个不存在的文件 = 豁免无效却看不出来。
      // 初版曾把 .DS_Store / .gitkeep 写进名单，而它们并不存在——这条断言当场抓出。
      const allFiles = new Set(enumerateFiles(HOOKS_SRC));
      const phantom = NON_DEPLOYABLE.filter((f) => !allFiles.has(f));
      expect(phantom).toEqual([]);
    });
  });

  describe('AC-DEPLOY-002-04: 三份清单两两不相交', () => {
    it('HOOK_FILES / GATE_FILES / MODULE_FILES 没有交集', () => {
      const overlap = (a, b) => a.filter((x) => b.includes(x));
      expect(overlap(HOOK_FILES, GATE_FILES)).toEqual([]);
      expect(overlap(HOOK_FILES, MODULE_FILES)).toEqual([]);
      expect(overlap(GATE_FILES, MODULE_FILES)).toEqual([]);
    });

    it('每份清单内部无重复项', () => {
      for (const [name, list] of Object.entries({ HOOK_FILES, GATE_FILES, MODULE_FILES })) {
        const dupes = list.filter((x, i) => list.indexOf(x) !== i);
        expect({ name, dupes }).toEqual({ name, dupes: [] });
      }
    });
  });

  describe('AC-DEPLOY-002-05: 反向断言——删掉清单中的一项必须让测试变红', () => {
    /**
     * 这是对测试本身的测试：如果这条断言写得太松（例如用 toContain 检查一个
     * 本来就不该覆盖的目录），清单漏项也不会被发现。这里模拟「清单少了一项」，
     * 确认 AC-002-02 的核心谓词真的会报告它。
     */
    it('构造一个缺失项的场景，确认检测谓词会报出来', () => {
      const allFiles = enumerateFiles(HOOKS_SRC);
      const fullCovered = new Set([...HOOK_FILES, ...GATE_FILES, ...MODULE_FILES]);
      // 故意漏掉一项，模拟"清单忘记收录"
      const victim = [...fullCovered].find((f) => allFiles.includes(f));
      expect(victim).toBeDefined();

      const simulated = new Set([...fullCovered].filter((f) => f !== victim));
      const exempt = new Set(NON_DEPLOYABLE);
      const uncovered = allFiles.filter((f) => !simulated.has(f) && !exempt.has(f));

      expect(uncovered).toEqual([victim]);
    });
  });
});
