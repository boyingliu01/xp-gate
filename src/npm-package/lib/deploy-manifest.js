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

/**
 * 既非「无扩展名的普通 hook」也非 `gate-*.sh` 的部署脚本（REQ-DEPLOY-002）。
 *
 * WHY A THIRD LIST IS NEEDED
 * --------------------------
 * 既有断言按类别检查：`HOOK_FILES` 覆盖「顶层无扩展名的普通文件」，
 * `GATE_FILES` 覆盖 `gate-*.sh` + `sprint-gate.sh`。于是下面这些文件落进了
 * 类别的缝里——它们既不是普通 hook，也不是 gate-*.sh，因此从来没有任何一条
 * 断言问过「它们在哪份清单里」，而它们确实在 `src/npm-package/hooks/` 下：
 *
 *   adapter-common.sh      适配器基础设施（被 pre-commit/pre-push source）
 *   deploy-manifest.sh     本清单自身的 shell 投影（供 shell 侧安装器读取）
 *   install.sh             项目内安装器
 *   lib/**                 hooks/lib/ 下被运行时 source 的模块
 *
 * 「按类别断言」的失效方式很隐蔽：新增一类文件时，它不匹配任何既有类别，
 * 于是所有断言继续通过，而文件不被部署。这正是 #783 第三次重演的机制。
 *
 * 因此本清单的断言方式是**枚举目录**（见 deploy-manifest-completeness.test.js），
 * 不比对手写清单：漏了一项就是红的，不需要有人记得加断言。
 *
 * 路径一律相对 `src/npm-package/hooks/`，正斜杠分隔。
 * `lib/` 下逐个文件列出（而不是写目录名 'lib'）——写目录名会让「目录里新增
 * 一个模块」再次逃脱断言，正是本清单要消灭的那种漏。
 */
const MODULE_FILES = Object.freeze([
  ADAPTER_COMMON,
  'deploy-manifest.sh',
  'install.sh',
  'lib/Measure-PowerShellComplexity.ps1',
  'lib/assertion-quality.sh',
  'lib/audit-sanitize.sh',
  'lib/ccn-ratchet.sh',
  'lib/coverage-total.sh',
  'lib/diff-coverage.sh',
  'lib/docs-only.sh',
  'lib/gate-5c-alignment.sh',
  'lib/java-test-selection.sh',
  'lib/jscpd-run.sh',
  'lib/layer-baseline.cjs',
  'lib/native-path.sh',
  'lib/now-ms.sh',
  'lib/prepush-score.py',
  'lib/python-incremental-typecheck.sh',
  'lib/python-test-selection.sh',
  'lib/sprint-gate-report.sh',
  'lib/test-failure.sh',
  'lib/toolchain-path.sh',
  'lib/typecheck.sh',
  'lib/validate-code-walkthrough.cjs',
]);

/**
 * `src/npm-package/hooks/` 下**确实不该部署**的文件。
 *
 * 实测结论：当前为空。`hooks/` 下 39 个文件（递归）每一个都应该被部署，
 * 没有例外——这不是假设，是 `find src/npm-package/hooks -type f` 的实测结果。
 *
 * 保留这个空数组而不是删掉概念，是因为「不需要豁免」本身是需要被断言的：
 * 一旦有人往这里加一项，测试会同时检查三件事——
 *   (a) 名单逐项等于期望值（现在是空，加一项就红，迫使那次决策被显式做出）；
 *   (b) 名单里不含 .sh、不含非点开头的文件；
 *   (c) 名单里的每一项都真实存在于 hooks/ 下（防死字符串式豁免）。
 *
 * 初版曾把 `.DS_Store` / `.gitkeep` 写在这里，但 `hooks/` 下并没有这两个文件
 * ——那正是 (c) 要抓的「豁免了不存在的东西，等于豁免失效却看不出来」。
 */
const NON_DEPLOYABLE = Object.freeze([]);

module.exports = Object.freeze({
  HOOK_FILES,
  GATE_FILES,
  MODULE_FILES,
  NON_DEPLOYABLE,
  ADAPTER_COMMON,
  HOOKS_LIB,
});
