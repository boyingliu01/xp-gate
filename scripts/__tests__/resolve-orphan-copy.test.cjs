/**
 * @test REQ-RESOLVE-002 删除顶层死副本
 * @intent `src/npm-package/hook-module-resolution.sh` 是生成物的一份陈旧副本
 *   （2145 字节，2026-10-21，global/project 顺序与生成器相反，零个函数），
 *   且**没有任何消费者**。它的存在是「同一份顺序有两个版本」这一缺陷类的
 *   物理残余：即使没人 source 它，下一个人读代码时会以为它是权威。
 * @covers AC-RESOLVE-002-01, AC-RESOLVE-002-02, AC-RESOLVE-002-03
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// scripts/__tests__/ -> scripts/ -> <repo root> :: two '..'.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ORPHAN = path.join(REPO_ROOT, 'src', 'npm-package', 'hook-module-resolution.sh');
const CANONICAL = path.join(REPO_ROOT, 'githooks', 'hook-module-resolution.sh');
const MANIFEST = path.join(REPO_ROOT, 'src', 'npm-package', 'lib', 'deploy-manifest.js');

describe('REQ-RESOLVE-002 删除顶层死副本', () => {
  describe('AC-RESOLVE-002-01: 孤儿副本已删除', () => {
    it('src/npm-package/hook-module-resolution.sh 不存在', () => {
      expect(fs.existsSync(ORPHAN)).toBe(false);
    });

    it('唯一权威的生成物仍在 githooks/ 下', () => {
      expect(fs.existsSync(CANONICAL)).toBe(true);
    });
  });

  describe('AC-RESOLVE-002-02: 仓库中不再有第二份"解析顺序"文本', () => {
    it('除 githooks/ 生成物外，没有任何 .sh 文件声明 HOOK_ADAPTER_DIR_TIERS', () => {
      /**
       * 遍历仓库里所有 .sh，找出声明 HOOK_ADAPTER_DIR_TIERS 的文件。
       * 允许的只有两个：
       *   - githooks/hook-module-resolution.sh（生成物本身）
       *   - src/npm-package/hooks/hook-module-resolution.sh（部署镜像）
       * 任何第三处出现都意味着又有人抄了一份顺序。
       */
      const allowed = new Set([
        path.join('githooks', 'hook-module-resolution.sh'),
        path.join('src', 'npm-package', 'hooks', 'hook-module-resolution.sh'),
      ]);

      const found = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          // `.stryker-tmp` holds Stryker's sandbox copies of the whole tree. They
          // are byte-copies of files this test already checks at their real
          // path, so scanning them turns "is there a SECOND declaration" into
          // "how many sandboxes are lying around" — measured: a leftover run
          // contributed 6 phantom hits and failed the assertion with no defect
          // behind it. Same reason `dist`/`coverage` are excluded.
          if (['node_modules', '.git', '.worktrees', 'dist', 'coverage', '.stryker-tmp'].includes(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.name.endsWith('.sh')) {
            const rel = path.relative(REPO_ROOT, full);
            if (allowed.has(rel)) continue;
            const content = fs.readFileSync(full, 'utf8');
            if (/^\s*HOOK_ADAPTER_DIR_TIERS=/m.test(content)) found.push(rel);
          }
        }
      };
      walk(REPO_ROOT);

      expect(found).toEqual([]);
    });
  });

  describe('AC-RESOLVE-002-03: 部署清单没有收录孤儿路径', () => {
    it('deploy-manifest 的三份清单中不含顶层 hook-module-resolution.sh 路径', () => {
      const { HOOK_FILES, GATE_FILES, MODULE_FILES } = require(MANIFEST);
      const all = [...HOOK_FILES, ...GATE_FILES, ...MODULE_FILES];
      // 清单里的路径相对 hooks/，所以 'hook-module-resolution.sh' 是合法的；
      // 不合法的是一条带包根前缀的路径。
      const offending = all.filter(
        (f) => f.includes('npm-package/') || f.startsWith('../'),
      );
      expect(offending).toEqual([]);
    });

    it('生成器 --check 通过（删除孤儿没有影响投影）', () => {
      const out = execFileSync(
        'node',
        [path.join(REPO_ROOT, 'scripts', 'generate-hook-resolution.cjs'), '--check'],
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      expect(out).toContain('is current');
    });
  });
});
