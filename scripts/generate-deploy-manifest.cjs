#!/usr/bin/env node
/**
 * Generate githooks/deploy-manifest.sh from src/npm-package/lib/deploy-manifest.js
 * (REQ-DEPLOY-001, #789 根因②).
 *
 * The JS module is the single source of truth for the deployment file manifest
 * (which hooks/gates/adapters get installed where). install.sh is bash and
 * cannot require() a JS file at install time, so the manifest is emitted as
 * shell arrays instead of being typed a second time by hand. `--check` exits
 * non-zero when the generated projection is stale, which is what the parity
 * test (lib/__tests__/deploy-manifest-projection.test.js) asserts.
 *
 * This file is a requireable module (exports renderProjection/checkProjection)
 * so the parity test can import it directly; the CLI write/exit path is guarded
 * by require.main so requiring it has no side effects.
 *
 * Usage:
 *   node scripts/generate-deploy-manifest.cjs          # write the projection
 *   node scripts/generate-deploy-manifest.cjs --check  # verify it is current
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src/npm-package/lib/deploy-manifest.js');
const TARGET = path.join(ROOT, 'githooks/deploy-manifest.sh');

// Fresh require each call so --check and write always agree with the source.
function loadManifest() {
  delete require.cache[require.resolve(SOURCE)];
  return require(SOURCE);
}

/** Render the shell projection text from the JS manifest (pure, no I/O). */
function renderProjection() {
  const { HOOK_FILES, GATE_FILES, MODULE_FILES, ADAPTER_COMMON, HOOKS_LIB } = loadManifest();
  const lines = [];
  lines.push('#!/bin/bash');
  lines.push('# GENERATED FILE — DO NOT EDIT.');
  lines.push('# Source of truth: src/npm-package/lib/deploy-manifest.js');
  lines.push('# Regenerate: node scripts/generate-deploy-manifest.cjs');
  lines.push('#');
  lines.push('# 部署文件清单的 shell 投影（REQ-DEPLOY-001，#789 根因②）。install.sh');
  lines.push('# 无法 require JS，只能 source 本投影。JS 模块是唯一事实源；手改本文件');
  lines.push('# 会让 install.sh 与 doctor/Node 消费方（直接读 JS 模块）不一致——');
  lines.push('# 正是 #495/#500 的双投影漂移教训。');
  lines.push('#');
  lines.push('# 每个 DEPLOY_* 常量被 sourcing 父进程（install.sh）消费，非本文件。');
  lines.push('# A linter checking this file alone cannot see that consumer, so each');
  lines.push('# declaration carries a scoped directive (#548). Generated, not hand-added.');
  lines.push('');
  lines.push('# 随 hook 部署到 hooks 目标目录的脚本（平铺，无子目录）。');
  lines.push('# Consumed by the sourcing parent, not here.');
  lines.push('# shellcheck disable=SC2034');
  lines.push('DEPLOY_HOOK_FILES=(');
  for (const h of HOOK_FILES) {
    lines.push(`  '${h}'`);
  }
  lines.push(')');
  lines.push('');
  lines.push('# 门禁脚本全集（10 个 gate-*.sh + sprint-gate.sh）。部署目标依链路而异：');
  lines.push('# 全局 copyAdapters → adapters/；项目内 install.sh → .git/hooks/。');
  lines.push('# Consumed by the sourcing parent, not here.');
  lines.push('# shellcheck disable=SC2034');
  lines.push('DEPLOY_GATE_FILES=(');
  for (const g of GATE_FILES) {
    lines.push(`  '${g}'`);
  }
  lines.push(')');
  lines.push('');
  lines.push('# 适配器基础设施与 hooks/lib（单独字段，部署目标不同）。');
  lines.push('# Consumed by the sourcing parent, not here.');
  lines.push('# shellcheck disable=SC2034');
  lines.push(`DEPLOY_ADAPTER_COMMON='${ADAPTER_COMMON}'`);
  lines.push(`DEPLOY_HOOKS_LIB='${HOOKS_LIB}'`);
  lines.push('');
  lines.push('# 非 hook 模块全集（lib/* 逐个列出，加 adapter-common.sh、deploy-manifest.sh、');
  lines.push('# install.sh）——REQ-DEPLOY-002。');
  lines.push('#');
  lines.push('# 这里刻意逐文件列出，而不是给一个 `lib` 目录名让安装器自己 glob。目录名形态');
  lines.push('# 让「清单是否完整」无法通过读清单来回答：装到用户磁盘上的文件可能没有任何');
  lines.push('# 清单条目，于是「都在清单里」永远为真。逐文件列出使清单成为真正的安装计划。');
  lines.push('# Consumed by the sourcing parent, not here.');
  lines.push('# shellcheck disable=SC2034');
  lines.push('DEPLOY_MODULE_FILES=(');
  for (const m of MODULE_FILES) {
    lines.push(`  '${m}'`);
  }
  lines.push(')');
  lines.push('');
  return lines.join('\n');
}

/** exit(1) with a stale message when the projection disagrees with the source. */
function checkProjection() {
  const expected = renderProjection();
  const actual = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (actual !== expected) {
    console.error('deploy-manifest.sh is STALE.');
    console.error('Run: node scripts/generate-deploy-manifest.cjs');
    process.exit(1);
  }
  console.log('deploy-manifest.sh is current.');
  process.exit(0);
}

// CLI entry — guarded so requiring this module (as the parity test does) has
// no write/exit side effects.
if (require.main === module) {
  if (process.argv.includes('--check')) {
    checkProjection();
  } else {
    const expected = renderProjection();
    fs.writeFileSync(TARGET, expected);
    console.log(`wrote ${path.relative(ROOT, TARGET)}`);
  }
}

module.exports = { renderProjection, checkProjection };
