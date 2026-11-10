/**
 * deploy-manifest.js — 部署文件清单的单一事实源（REQ-DEPLOY-001，#789 根因②）
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * 同一份"安装时要部署哪些文件"的清单曾手写四处且互不一致：
 *   - shared-utils.copyHooks      枚举 5 个 hook（缺 adapter-common.sh）
 *   - update-hooks.copyHooks      枚举 3 个 hook（缺 post-commit + hook-module-resolution.sh）
 *   - install.sh HOOKS_LIST       枚举 3 个 hook（缺 post-commit）+ GATE_SCRIPTS 枚举 7 个
 *                                gate（漏 gate-6-layers/gate-registry/gate-12-file-hygiene）
 *   - doctor EXPECTED_GATE_SCRIPTS 枚举 6 个 gate（漏 registry + gate-6-layers）
 * 每加一个文件都要记得同步改这四处，忘了就是静默不部署（post-commit 与
 * hook-module-resolution.sh 都曾这样漏过，#783 的 gate-6-layers.sh 是第三次重演）。
 *
 * 本模块是唯一事实源：所有安装/更新/卸载/诊断链路都从这里取文件列表，禁止持有
 * 私有字面量清单（AC-DEPLOY-07 的 AST+标记块静态断言在测试中强制这一点）。
 * 新增一个待部署文件时只需改这里 + 同步生成的 githooks/deploy-manifest.sh 投影
 * （scripts/generate-deploy-manifest.cjs --check 在 CI 拦截双投影漂移）。
 *
 * 与 hook-module-resolution.js 正交：后者管"运行时解析顺序"（哪个目录的副本优先），
 * 本模块管"部署哪些文件"（安装时拷什么）。两者无共享状态。
 *
 * 数据契约 v1（冻结；破坏性变更需升版本并同步 specification.yaml）：
 *   HOOK_FILES     随 hook 部署到 hooks 目标目录的脚本（平铺，无子目录）
 *   GATE_FILES     门禁脚本（10 个 gate-*.sh + sprint-gate.sh）。部署目标依链路而异：
 *                  全局 copyAdapters → ~/.config/xp-gate/adapters/（pre-commit GATE_DIR
 *                  的 gate_adapter_dir tier 搜 adapters/）；项目内 install.sh →
 *                  .git/hooks/（gate_script_dir tier）。copyHooks 不拷 gate 是正确的
 *                  ——GATE_DIR 不搜 hooks/。
 *   ADAPTER_COMMON adapter-common.sh（适配器基础设施，单独字段，部署到 adapters/）
 *   HOOKS_LIB      hooks/lib/（now-ms.sh 等，被 pre-commit 运行时 source）
 *
 * 防漏改：deploy-manifest.test.js 遍历 canonical githooks/ 比对 HOOK_FILES/GATE_FILES，
 * 新增 hook/gate 脚本忘改本清单 → 测试红（#783 建议②的回归测试）。
 */
'use strict';

/**
 * 随 hook 部署到 hooks 目标目录的脚本（平铺，无子目录）。
 * hook-module-resolution.sh 是 #505 生成的解析表，pre-commit 顶部 source 它
 * （缺失则 fail-closed FATAL），必须随 hook 一起部署。
 */
const HOOK_FILES = Object.freeze([
  'pre-commit',
  'pre-push',
  'post-commit',
  'post-merge',
  'hook-module-resolution.sh',
]);

/**
 * 门禁脚本全集（11 个 = 10 个 gate-*.sh + sprint-gate.sh）。
 * sprint-gate.sh（Gate S）与 gate 套件一起部署（copyAdapters/update-hooks 都拷它，
 * pre-push Gate S 搜 4 个 tier 兼容 hooks/ 与 adapters/ 两种落点）。
 */
const GATE_FILES = Object.freeze([
  'gate-3.sh',
  'gate-4.sh',
  'gate-6-layers.sh',
  'gate-7.sh',
  'gate-8.sh',
  'gate-9.sh',
  'gate-10.sh',
  'gate-12-file-hygiene.sh',
  'gate-13-compiler-strictness.sh',
  'gate-registry.sh',
  'sprint-gate.sh',
]);

/** 适配器基础设施（detect_project_lang/route_to_adapter），部署到 adapters/。 */
const ADAPTER_COMMON = 'adapter-common.sh';

/** hooks/lib/（now-ms.sh 等，被 pre-commit 运行时 source），整目录部署。 */
const HOOKS_LIB = 'lib';

module.exports = Object.freeze({
  HOOK_FILES,
  GATE_FILES,
  ADAPTER_COMMON,
  HOOKS_LIB,
});
