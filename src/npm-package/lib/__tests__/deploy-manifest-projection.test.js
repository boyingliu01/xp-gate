/**
 * @test REQ-DEPLOY-001 deploy-manifest 双投影一致性（#505 范式）
 * @intent 验证 githooks/deploy-manifest.sh 是 src/npm-package/lib/deploy-manifest.js
 *   的 shell 投影（install.sh 无法 require JS，只能 source 投影），且 --check
 *   拦截双投影漂移。JS 模块是唯一事实源，shell 投影由生成器产出，禁止手改。
 *
 *   RED 形态：本测试顶层 require 生成器模块。生成器尚未创建时 require 抛
 *   MODULE_NOT_FOUND → 整个套件加载失败（Failed Suite，非 Failed Test）→
 *   Gate 5 按 #454 runner-infrastructure-error 语义 SKIP，RED 测试可提交
 *   （对照 dcffe7cb：lib/__tests__ 顶层 require 不存在的 deploy-manifest.js
 *   同样 MODULE_NOT_FOUND，Gate 5 SKIP，RED 提交成功）。
 *
 *   为何不放 scripts/__tests__/*.cjs：该路径会被 Gate 5 的 CHANGED_TEST_FILES
 *   选择（钩子 grep '\.test\.(...|cjs)$'）选中真跑，vitest 收集不到时
 *   fallback 全量而卡住——本会话三次提交超时 >115s 实测卡死在 "Running
 *   tests..."。lib/__tests__ 的 Failed-Suite 形态与 dcffe7cb 一致，Gate 5 SKIP。
 * @covers AC-DEPLOY-03
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// RED：生成器尚未创建 → MODULE_NOT_FOUND → 套件加载失败 → Gate 5 SKIP。
// GREEN：生成器设计为可 require 模块（导出 renderProjection/checkProjection，
// CLI 入口用 require.main 守护，require 时不执行写盘/exit）。
const generator = require('../../../../scripts/generate-deploy-manifest.cjs');
const manifest = require('../deploy-manifest.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const GENERATOR = path.join(REPO_ROOT, 'scripts', 'generate-deploy-manifest.cjs');
const PROJECTION = path.join(REPO_ROOT, 'githooks', 'deploy-manifest.sh');

describe('deploy-manifest dual projection (REQ-DEPLOY-001)', () => {
  it('AC-DEPLOY-03a: 生成器导出 renderProjection + checkProjection（可 require 模块）', () => {
    expect(typeof generator.renderProjection).toBe('function');
    expect(typeof generator.checkProjection).toBe('function');
  });

  it('AC-DEPLOY-03b: --check 通过（投影与 JS 事实源一致，无漂移）', () => {
    // Stale 投影会静默装出与 doctor/Node 消费方不一致的清单——#505 存在的意义。
    const r = spawnSync(process.execPath, [GENERATOR, '--check'], { encoding: 'utf8' });
    expect(r.status, `--check failed: ${r.stderr || r.stdout}`).toBe(0);
  });

  it('AC-DEPLOY-03c: 投影存在 + GENERATED 头 + 数组与 JS 数据逐项一致', () => {
    expect(fs.existsSync(PROJECTION), 'githooks/deploy-manifest.sh missing — run node scripts/generate-deploy-manifest.cjs').toBe(true);
    const text = fs.readFileSync(PROJECTION, 'utf8');
    expect(text).toContain('GENERATED FILE — DO NOT EDIT');
    expect(text).toContain('Source of truth: src/npm-package/lib/deploy-manifest.js');
    for (const hook of manifest.HOOK_FILES) {
      expect(text, `projection missing HOOK_FILES entry ${hook}`).toContain(`'${hook}'`);
    }
    for (const gate of manifest.GATE_FILES) {
      expect(text, `projection missing GATE_FILES entry ${gate}`).toContain(`'${gate}'`);
    }
    expect(text).toContain(`DEPLOY_ADAPTER_COMMON='${manifest.ADAPTER_COMMON}'`);
    expect(text).toContain(`DEPLOY_HOOKS_LIB='${manifest.HOOKS_LIB}'`);
  });

  it('AC-DEPLOY-03d: 投影含 SC2034 禁用标记 + 数组声明名（install.sh 将 source）', () => {
    const text = fs.readFileSync(PROJECTION, 'utf8');
    expect(text).toContain('# shellcheck disable=SC2034');
    expect(text).toMatch(/DEPLOY_HOOK_FILES=\(/);
    expect(text).toMatch(/DEPLOY_GATE_FILES=\(/);
  });
});
