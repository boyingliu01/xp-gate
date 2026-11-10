/**
 * @test REQ-RESOLVE-003 生成器单一来源（schema 版本 + 契约自检）
 * @intent 生成器必须同时产出「数据」与「消费数据的函数」，且两者带 schema 版本号。
 *   现状只产出数据（4 个 HOOK_* 常量、零个函数），每个消费者各自手写解析循环
 *   ——pre-push 就是这样手写出了 global-first 的级联，与 project-first 的
 *   ADAPTER_DIR_ORDER 相反。让生成器产出函数，消费者才没有机会写第二份顺序。
 * @covers AC-RESOLVE-003-01, AC-RESOLVE-003-02, AC-RESOLVE-003-03,
 *          AC-RESOLVE-003-04, AC-RESOLVE-003-08
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// scripts/__tests__/ -> scripts/ -> <repo root>  :: two '..', not four.
// Four levels resolves to the MAIN checkout instead of the active worktree, so
// the assertions would read a different copy of the file than the one just
// generated — passing or failing against the wrong object.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TARGET = path.join(REPO_ROOT, 'githooks', 'hook-module-resolution.sh');
const GENERATOR = path.join(REPO_ROOT, 'scripts', 'generate-hook-resolution.cjs');
const JS_SOURCE = path.join(REPO_ROOT, 'src', 'npm-package', 'lib', 'hook-module-resolution.js');

function readTarget() {
  return fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
}

describe('REQ-RESOLVE-003 生成器单一来源', () => {
  describe('AC-RESOLVE-003-01: 生成物带 schema 版本号', () => {
    it('生成物声明 HOOK_RESOLUTION_SCHEMA 且值为 2', () => {
      const content = readTarget();
      expect(content).toMatch(/^\s*HOOK_RESOLUTION_SCHEMA=2\s*$/m);
    });

    it('JS 侧也导出 schema 版本，且与 shell 投影一致（防两处各写一个数）', () => {
      const mod = require(JS_SOURCE);
      expect(mod.HOOK_RESOLUTION_SCHEMA).toBe(2);
      const content = readTarget();
      expect(content).toContain(`HOOK_RESOLUTION_SCHEMA=${mod.HOOK_RESOLUTION_SCHEMA}`);
    });
  });

  describe('AC-RESOLVE-003-02: 生成物提供 _hook_resolve 函数（消费者不再手写顺序）', () => {
    it('生成物定义 _hook_resolve 函数', () => {
      const content = readTarget();
      expect(content).toMatch(/_hook_resolve\s*\(\s*\)\s*\{/);
    });

    it('_hook_resolve 接受 tier_id 与 base 变量名两个参数', () => {
      // 签名必须是 2 个参数：('project', 'PROJECT_GITHOOKS')。
      // 旧的手写级联是"先 if 全局、再 elif 项目"——顺序被写死在控制流里，
      // 无法从数据推导，也就无法与 ADAPTER_DIR_ORDER 保持一致。
      const content = readTarget();
      const fnMatch = content.match(/_hook_resolve\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
      expect(fnMatch).not.toBeNull();
      const body = fnMatch[0];
      expect(body).toMatch(/\$1/);
      expect(body).toMatch(/\$2/);
    });
  });

  describe('AC-RESOLVE-003-03: 生成物的 tier 顺序与 JS 数据一致（真正的一致断言）', () => {
    it('shell 投影里的每个 tier_id 都出现在 JS 的 ADAPTER_DIR_ORDER 中且顺序相同', () => {
      const mod = require(JS_SOURCE);
      const jsOrder = mod.ADAPTER_DIR_ORDER.map((t) => t.tier_id);
      const content = readTarget();

      const block = content.match(/HOOK_ADAPTER_DIR_TIERS=\(([\s\S]*?)\)/);
      expect(block).not.toBeNull();
      const shellOrder = [...block[1].matchAll(/'([a-z_]+)\|/g)].map((m) => m[1]);

      expect(shellOrder).toEqual(jsOrder);
    });

    it('project 优先于 global（project-first，PC-1 的原始缺陷就是反了）', () => {
      const mod = require(JS_SOURCE);
      const ids = mod.ADAPTER_DIR_ORDER.map((t) => t.tier_id);
      expect(ids.indexOf('project')).toBeLessThan(ids.indexOf('global'));
    });
  });

  describe('AC-RESOLVE-003-04: --check 能检测陈旧投影', () => {
    it('--check 在投影与生成器一致时 exit 0', () => {
      const out = execFileSync('node', [GENERATOR, '--check'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(out).toContain('is current');
    });
  });

  describe('AC-RESOLVE-003-08: 契约自检（加载期发现签名不符）', () => {
    it('生成物包含自检函数，且它在 source 后自动运行', () => {
      const content = readTarget();
      // case D（设计文档 §3.2）：文件语法正确、函数存在，但签名/返回契约不符时，
      // 必须在加载期确定性发现，而不是在 push 中途随机炸开。
      expect(content).toMatch(/_hook_resolve_selfcheck\s*\(\s*\)\s*\{/);
      expect(content).toMatch(/_hook_resolve_selfcheck\s*(?:\|\||&&|$)/m);
    });

    it('自检失败时设置 _HOOK_RESOLVE_BROKEN 标记供消费者读取', () => {
      const content = readTarget();
      expect(content).toContain('_HOOK_RESOLVE_BROKEN');
    });
  });
});
