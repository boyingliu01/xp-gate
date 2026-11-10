#!/bin/bash
# GENERATED FILE — DO NOT EDIT.
# Source of truth: src/npm-package/lib/deploy-manifest.js
# Regenerate: node scripts/generate-deploy-manifest.cjs
#
# 部署文件清单的 shell 投影（REQ-DEPLOY-001，#789 根因②）。install.sh
# 无法 require JS，只能 source 本投影。JS 模块是唯一事实源；手改本文件
# 会让 install.sh 与 doctor/Node 消费方（直接读 JS 模块）不一致——
# 正是 #495/#500 的双投影漂移教训。
#
# 每个 DEPLOY_* 常量被 sourcing 父进程（install.sh）消费，非本文件。
# A linter checking this file alone cannot see that consumer, so each
# declaration carries a scoped directive (#548). Generated, not hand-added.

# 随 hook 部署到 hooks 目标目录的脚本（平铺，无子目录）。
# Consumed by the sourcing parent, not here.
# shellcheck disable=SC2034
DEPLOY_HOOK_FILES=(
  'pre-commit'
  'pre-push'
  'post-commit'
  'post-merge'
  'hook-module-resolution.sh'
)

# 门禁脚本全集（10 个 gate-*.sh + sprint-gate.sh）。部署目标依链路而异：
# 全局 copyAdapters → adapters/；项目内 install.sh → .git/hooks/。
# Consumed by the sourcing parent, not here.
# shellcheck disable=SC2034
DEPLOY_GATE_FILES=(
  'gate-3.sh'
  'gate-4.sh'
  'gate-6-layers.sh'
  'gate-7.sh'
  'gate-8.sh'
  'gate-9.sh'
  'gate-10.sh'
  'gate-12-file-hygiene.sh'
  'gate-13-compiler-strictness.sh'
  'gate-registry.sh'
  'sprint-gate.sh'
)

# 适配器基础设施与 hooks/lib（单独字段，部署目标不同）。
# Consumed by the sourcing parent, not here.
# shellcheck disable=SC2034
DEPLOY_ADAPTER_COMMON='adapter-common.sh'
DEPLOY_HOOKS_LIB='lib'

# 非 hook 模块全集（lib/* 逐个列出，加 adapter-common.sh、deploy-manifest.sh、
# install.sh）——REQ-DEPLOY-002。
#
# 这里刻意逐文件列出，而不是给一个 `lib` 目录名让安装器自己 glob。目录名形态
# 让「清单是否完整」无法通过读清单来回答：装到用户磁盘上的文件可能没有任何
# 清单条目，于是「都在清单里」永远为真。逐文件列出使清单成为真正的安装计划。
# Consumed by the sourcing parent, not here.
# shellcheck disable=SC2034
DEPLOY_MODULE_FILES=(
  'adapter-common.sh'
  'deploy-manifest.sh'
  'install.sh'
  'lib/Measure-PowerShellComplexity.ps1'
  'lib/assertion-quality.sh'
  'lib/audit-sanitize.sh'
  'lib/ccn-ratchet.sh'
  'lib/coverage-total.sh'
  'lib/diff-coverage.sh'
  'lib/docs-only.sh'
  'lib/gate-5c-alignment.sh'
  'lib/java-test-selection.sh'
  'lib/jscpd-run.sh'
  'lib/layer-baseline.cjs'
  'lib/native-path.sh'
  'lib/now-ms.sh'
  'lib/prepush-score.py'
  'lib/python-incremental-typecheck.sh'
  'lib/python-test-selection.sh'
  'lib/sprint-gate-report.sh'
  'lib/test-failure.sh'
  'lib/toolchain-path.sh'
  'lib/typecheck.sh'
  'lib/validate-code-walkthrough.cjs'
)
