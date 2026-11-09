# 设计文档：P1-A 部署链路单一事实源 + P1-C 解析层收敛

- 日期：2026-11-09
- Sprint：sprint-20261109-15（worktree .worktrees/sprint-20261109-arch，分支 sprint/2026-11-09-arch-deploy-resolve）
- 状态：待用户审批（DESIGN HARD-GATE）
- 关联 issue：#789（索引）#783 #769 #771 #770 #741 #756
- 前置：docs/plans/2026-11-09-architecture-orthogonal-decomposition.md（根因实测）、docs/plans/2026-11-09-architecture-sprint-breakdown.md（REQ/AC 边界）
- 决策：CONTEXT.md + .sprint-state/decisions.md DR-004（D1–D5 已敲定）

---

## 0. 设计目标

消除两个架构根因（#789 根因②部署清单、根因④解析层），用**单一事实源 + 契约测试**替代四处手写清单与手写解析级联。本 sprint 只做 P1-A + P1-C（P1-B/D/E/F 后续独立 sprint）。

**非目标**（明确不做，避免范围蔓延）：
- 不合并 3 套安装器为 1 套（D2：只统一清单来源）
- 不动 registry 派生 CLI / gate-9.sh 死文件 / CLI 12-13 子命令（P1-B）
- 不动镜像治理（P1-E，需 A/B/C 决策）
- 不动 Gate 10 性能（P1-F）

---

## 1. P1-A：部署清单单一事实源

### 1.1 现状实测（四处手写清单互不一致）

| 消费方 | 位置 | hooks 白名单 | gate-*.sh | lib/ | 布局 |
|---|---|---|---|---|---|
| shared-utils.copyHooks | src/npm-package/lib/shared-utils.js:70 | pre-commit/pre-push/post-commit/post-merge/hook-module-resolution.sh（5，**缺 adapter-common.sh**） | ❌ 不拷 | ✅ 整目录 | flat |
| update-hooks.copyHooks | src/npm-package/lib/update-hooks.js:161 | pre-commit/pre-push/post-merge（3）**缺 post-commit + hook-module-resolution.sh** | ❌ | ✅ 逐文件 | nested |
| sync-package-content HOOK_FILES | src/npm-package/scripts/sync-package-content.js:255 | pre-commit/pre-push/post-commit/post-merge/adapter-common.sh/hook-module-resolution.sh（6）+ 单独 gate-* 过滤（277-282，含 sprint-gate.sh）| ✅ 拷进包内 hooks/ | ✅ 整目录 | flat |
| install.sh | githooks/install.sh:19-20 | HOOKS_LIST=pre-commit/pre-push/post-merge（**缺 post-commit**） | ❌ GATE_SCRIPTS 声明 9 个但**不拷到 .git/hooks** | — | — |
| doctor EXPECTED_GATE_SCRIPTS | src/npm-package/lib/doctor.js:1764 | — | gate-3/4/7/8/9/10（**无 registry、无 gate-6-layers**） | — | — |

**关键区分**：sync-package-content（打包链路）**已**把 gate-*.sh 拷进 src/npm-package/hooks/（tarball 内是完整的）。问题全在**安装链路**（shared-utils/update-hooks/install.sh 三套安装器都不拷 gate-*.sh 到用户机器）——#783 的"包内有、安装后无"正是此因。

后果（活 bug）：
- update-hooks --scope hooks 装出缺 hook-module-resolution.sh 的目录 → pre-commit fail-closed FATAL（shared-utils.js:67-69 注释自认）
- gate-6-layers.sh / gate-registry.sh 随包发布但安装器不部署（#783 / #769）
- install.sh 的 HOOKS_LIST 缺 post-commit，GATE_SCRIPTS 声明了却不拷（#783 实测：安装后 ~/.config/xp-gate/hooks/ 一个 gate-*.sh 都没有）
- copyAdapters 拷 nested → 全局安装造出 adapters/adapters/ 双层（update-hooks.js:202）

### 1.2 设计：部署清单数据文件

**新增** `src/npm-package/lib/deploy-manifest.js`（zero-dependency，纯数据 + 消费辅助）——**唯一事实源**，与 hook-module-resolution.js 正交（后者管"解析顺序"，本模块管"部署哪些文件"）。

**数据契约（R1 缺口#1 补全：schema/投影目标/bash 消费归属在此定义，使"单一事实源"可测）**：

```js
'use strict';
// 部署清单：包内文件 → 安装目标位置的唯一事实源（#789 根因②）。
// 数据契约（v1）：
//   HOOK_FILES      string[]  包内 hooks/ 顶层普通 hook 文件名（不含 gate-*、adapter-common.sh）
//                             安装目标：<destDir>/<file>（flat）
//   GATE_FILES      string[]  包内 gate-*.sh + gate-registry.sh 文件名
//                             安装目标：<destDir>/<file>（flat，与 hooks 同目录）
//   ADAPTER_COMMON  string    包内 adapter-common.sh 文件名（adapter 基础设施，非普通 hook）
//                             安装目标：全局 adapters/ 根（install.sh 链路）；本地 githooks/（init 链路）
//   HOOKS_LIB       string    包内 hooks/lib 子目录名（整目录递归拷贝）
//                             安装目标：<destDir>/lib/
// 六个消费方全部 require 本模块，禁止持有私有字面量文件清单：
//   Node 方（直接 require）：shared-utils.copyHooks / update-hooks.copyHooks /
//                             doctor(EXPECTED_GATE_SCRIPTS) / uninstall(移除枚举)
//   shell 方（source 生成的投影）：install.sh / setup-global
//   间接消费（调 shared-utils）：init.js 三处 copyHooks 调用

const HOOK_FILES = ['pre-commit', 'pre-push', 'post-commit', 'post-merge', 'hook-module-resolution.sh'];
const GATE_FILES = [
  'gate-3.sh', 'gate-4.sh', 'gate-6-layers.sh', 'gate-7.sh', 'gate-8.sh',
  'gate-9.sh', 'gate-10.sh', 'gate-13-compiler-strictness.sh', 'gate-registry.sh',
];
const ADAPTER_COMMON = 'adapter-common.sh';
const HOOKS_LIB = 'lib';

module.exports = { HOOK_FILES, GATE_FILES, ADAPTER_COMMON, HOOKS_LIB };
```

**双投影机制**（复用 #505 generate-hook-resolution.cjs 范式）：
- Node 消费方（shared-utils/update-hooks/doctor/uninstall）直接 `require('./deploy-manifest.js')`
- install.sh 是纯 shell 无法 require → 新建 `scripts/generate-deploy-manifest.cjs` 把清单投影成 `githooks/deploy-manifest.sh`（shell 数组），install.sh source 它。生成器带 `--check`（stale 退出非 0），parity 测试断言 freshness
- 投影文件纳入 check-hook-mirror.sh parity + sync-package-content（拷进 src/npm-package/hooks/，保 tarball 自包含——npm files 字段硬约束）

**adapter-common.sh 归属**：它由 copyAdapters 单独部署（shared-utils.js:88-104），不属于 HOOK_FILES（普通 hook）也不属于 GATE_FILES（门禁脚本）。部署清单用独立字段 `ADAPTER_COMMON` 表达，避免把它误归类进 hook 白名单（sync-package-content 的 HOOK_FILES 含它是打包语义，与安装语义不同——两链路清单字段分离）。

**断言**（防漏改）：新增 `src/npm-package/lib/__tests__/deploy-manifest.test.js`，断言：
- AC-A1-1a：`HOOK_FILES` 包含包内 `hooks/` 下每个顶层 hook 文件（遍历 src/npm-package/hooks/ 比对，排除 gate-*/adapter-common.sh）——新增 hook 脚本时漏改清单会测试失败
- AC-A1-1b：`GATE_FILES` 包含包内 `hooks/gate-*.sh` 每个文件（含 gate-registry.sh、gate-6-layers.sh）——#783 的回归断言
- AC-A1-1c：`HOOK_FILES` 与 `GATE_FILES` 无交集（hooks 与 gates 是两类部署目标）
- AC-A1-1d：生成的 githooks/deploy-manifest.sh 与 deploy-manifest.js 数据一致（--check 范式，防双投影漂移）

**Delphi R2 吸收（2026-11-09，4 轮 100% 共识）**：
- **AC-A1-1e（A-1）**：`generate-deploy-manifest.cjs --check` 进 CI 构建门（npm run prepack / CI quality-gates 步骤），不止测试——stale 投影在发布前就红，不进 tarball
- **AC-A1-1f（A-2 + C-Low）**：parity 断言 `copyAdapters` 部署的 adapter-common 恰是清单 `ADAPTER_COMMON` 字段（require 清单而非字面量）；文档化 copyAdapters 消费该字段。uninstall.js 的移除枚举 **require deploy-manifest.js**（B-watch2：若只注释指向清单，移除路径成第五份手写清单）
- **AC-A1-1g（B-watch1）**：生成的 deploy-manifest.sh 首行 `#!/bin/bash` + 仅从 bash 上下文 source；install.sh 断言 `$BASH_VERSION` 非空（POSIX sh 下数组静默坏），缺失时 fail-closed 提示用 bash 执行

**Delphi R1 吸收（2026-11-09，R1 5 轮 0% 共识的缺口补全）**：
- **AC-A1-1h（缺口#1，可行性#1；R1 重审缺口#1 精化；二轮 R1 A1/F1 吸收）**：断言**清单来源单一化**——六个消费方（shared-utils/update-hooks/init/install.sh/doctor/uninstall）的 hook/gate 文件清单**全部经由 deploy-manifest.js 导出常量取得**（Node 方 `require('./deploy-manifest.js')` 后读字段；shell 方 source 生成的投影），**无任何硬编码字面量清单**（不存在第二个 `['pre-commit','pre-push',...]` 形式的数组字面量，除 deploy-manifest.js 源与生成的投影外）。**断言方法（A1/F1 精化）**：① Node 方用 AST 解析（babel/acorn 提取 ArrayExpression 字面量），但只抓静态字面量——若未来某消费方改为动态构造（循环/拼接），断言切换为评估其产出函数的输出或断言其 import 了 deploy-manifest 常量（动态构造不 false-negative）；② shell 方**不用全文件 strip 注释**（heredoc 内嵌示例/字符串内 `#` 会误报漏报），改用 `bash -n` 语法检查 + 显式标记块（`# BEGIN MANIFEST CONSUMERS` / `# END MANIFEST CONSUMERS` 之间才扫描）；③ **覆盖范围契约化**：六个消费方列表写入 specification.yaml 作为"断言覆盖范围契约"，并加 meta-断言——任何新增的清单消费 import 必须同步更新断言范围（否则 CI 失败），防第七个消费方静默漏报；④ 误报 triage：断言命中后人工确认是否为真实清单（注释/docblock/测试 fixture/文档示例不计入），确认真实的才 CI 失败。这是"六方都消费清单"的可测断言（双投影 freshness 必要但不充分，此 AC 补足充分性）
- **AC-A1-1i（缺口#2，边界澄清）**：AC-A2-2 的"doctor 派生"**仅限 gate-script 部署清单派生**（EXPECTED_GATE_SCRIPTS 从 GATE_FILES 读），**不**含 registry 派生 CLI（那是 P1-B 非目标）；AC-A1-1g 的 bash 断言**仅限部署契约**（install.sh 安全 source），**不**涉门禁脚本治理。设计文档显式标注此边界，防 BUILD 时范围蔓延进 P1-B

### 1.3 改造五个消费方（D2：保留 3 套安装器，统一数据源）

**REQ-A1（清单数据化 + 五方消费）**

1. **shared-utils.js copyHooks**：`hookFiles` 字面量改为 `require('./deploy-manifest.js').HOOK_FILES`。lib/ 整目录拷贝保留。
2. **update-hooks.js copyHooks**：删本地 3 文件字面量，改用 `HOOK_FILES`（修复缺 post-commit + hook-module-resolution.sh → 修复 update-hooks FATAL）。lib/ 逐文件逻辑保留但 label 从清单派生。
3. **init.js**：三处 copyHooks 调用（local/template/global）不变（它们调 shared-utils，已间接消费清单）。
4. **install.sh**：`GATE_SCRIPTS=` 字面量改为 source 一个生成的清单片段（或读 deploy-manifest 的 shell 投影）。**实现选择**：在 `scripts/generate-hook-resolution.cjs` 同机制下新增 `scripts/generate-deploy-manifest.cjs`，生成 `githooks/deploy-manifest.sh`（含 HOOK_FILES/GATE_FILES 的 shell 数组），install.sh source 它。
5. **doctor.js EXPECTED_GATE_SCRIPTS**：改为从 GATE_FILES 派生（require deploy-manifest.js），不再手写 gate-3/4/7/8/9/10。
6. **uninstall.js:868**：同步注释指向 deploy-manifest.js（消除"必须与 copyHooks 列表同步"的手写同步义务）。

**AC-A1-2**：update-hooks 与 init 的 hooks 白名单来自同一数据源（deploy-manifest.js）——测试断言两者 require 同一模块且 HOOK_FILES 一致。
**AC-A1-3**：update-hooks 后 `.git/hooks/`（或目标 hooks 目录）含 hook-module-resolution.sh + post-commit（当前缺，导致 pre-commit FATAL）。

**REQ-A2（gate 脚本部署，#783/#769）**

**AC-A2-1**：install.sh / setup-global 部署 gate-*.sh（含 gate-registry.sh、gate-6-layers.sh）到目标 hooks 目录。
**AC-A2-2**：`xp-gate doctor` 的 EXPECTED_GATE_SCRIPTS 含 gate-registry.sh + gate-6-layers.sh（不再漏报）。**边界**：仅限 gate-script 部署清单派生，不含 registry 派生 CLI（P1-B 非目标，AC-A1-1i）。
**AC-A2-3**：全局安装后 `source ~/.config/xp-gate/hooks/gate-registry.sh` 成功（契约测试）。
**AC-A2-4（C-High）**：install.sh source deploy-manifest.sh 前加 fail-closed guard——投影文件存在性 + 非空检查，缺失/stale 时 exit 非 0 并输出可操作提示（"run node scripts/generate-deploy-manifest.cjs"），**禁止静默装出残缺 hooks**（与 update-hooks FATAL 同类失败，install.sh 不得复现）。契约测试覆盖 missing 投影 + stale 投影（--check 红）两种情形。
**AC-A2-5（缺口#3，技术 B1）**：update-hooks **同时修复 gate 脚本部署**（不只 hooks）——扩展 AC-A1-3：update-hooks 后目标目录含 HOOK_FILES + GATE_FILES 全集（gate-*.sh 一并补齐）。这消除"升级后未跑 doctor 的用户提交遇未解释 FATAL"窗口：update-hooks 本身即修复路径，不强制先跑 doctor。

**REQ-A3（发布契约测试 + D1 BLOCK 化）**

**AC-A3-1**：契约测试（范式 plugins/dsh/src/contract.test.ts）在 `npm pack` 后断言 tarball hooks/ 含 HOOK_FILES + GATE_FILES 全集。
**AC-A3-2**：模拟全局安装到临时目录后，`source <dest>/hook-module-resolution.sh` 成功且 project-first（HOOK_ADAPTER_DIR_TIERS 项目在前）。
**AC-A3-3（D1）**：architecture.yaml 存在时，pre-commit 的 LAYER_CHECKER_MISSING（gate-6-layers.sh 未部署）升 BLOCK（当前 WARN）。存量用户升级后提交失败是逼其重装/更新的信号（fail-closed 哲学，Gate 8 #499 先例）。**BLOCK 输出必须包含可操作修复命令**（"xp-gate doctor --fix" 或 "xp-gate setup-global"），不得只报缺失名。
**AC-A3-4（C-Medium）**：D1 BLOCK 化配套自动迁移路径——`xp-gate doctor --fix` 检测到 LAYER_CHECKER_MISSING 时自动重部署 gate-6-layers.sh（调 deploy-manifest），或输出一键修复命令；升级路径测试覆盖「architecture.yaml 存在 + 检查器缺失 → doctor --fix 后 gate-6-layers.sh 到位 → 再次提交不再 BLOCK」。release notes 明示「升级后重跑 xp-gate init / setup-global 或 xp-gate doctor --fix」。
**AC-A3-5（缺口#3，架构#3 鸡生蛋 + 可行性#3）**：doctor --fix 的**触发条件 / 幂等 / 离线**行为作为可测 AC——
  (a) 触发：LAYER_CHECKER_MISSING 且 architecture.yaml 存在时，doctor（无 --fix）报告 + doctor --fix 自动补部署；
  (b) 幂等：连续两次 doctor --fix 结果一致（不重复部署、不报错）；
  (c) 离线：doctor --fix 从本地包内 hooks/（tarball 或 node_modules）取 gate-6-layers.sh，**不依赖网络**；
  (d) **escape hatch**：文档化一次性逃生阀 `XP_GATE_SKIP_LAYER_CHECK=1`（用户因 pre-commit BLOCK 无法跑 doctor 时，先设此变量提交一次再 doctor --fix），解决"pre-commit BLOCK → 无法提交 → 无法触发 doctor"的鸡生蛋。**滥用治理（R1 重审缺口#2 补；二轮 A2/F2 精化）**：① 作用域严格限定 LAYER_CHECKER_MISSING（不放宽其他 Gate 6 检查）；② 每次使用 log WARN（含时间戳 + "one-shot escape hatch, run xp-gate doctor --fix" 提示）；③ **CI 环境拒绝该变量**——检测信号明确为 `CI` 环境变量（ truthy 即视为 CI；兼容 GITHUB_ACTIONS/CI 各平台），CI fixture 断言 XP_GATE_SKIP_LAYER_CHECK 在 CI 上下文被忽略/报错，防 CI 永久绕过；④ **sunset 无条件钉死 v0.39.0 移除**（A3/F2：移除标准不作 gate——"doctor --fix 迁移路径上线满一个 minor"仅作 justification，起算点=doctor --fix GA release tag 日期；v0.39.0 发布即强制移除，不因迁移路径早晚而递延）。测试断言：设此变量时 LAYER_CHECKER_MISSING 降级 WARN（一次性）+ WARN 日志含 remediation 命令 + CI 上下文（CI=true）该变量被拒绝。
**AC-A3-6（缺口#3，可行性#2：滚动升级窗口）**：定义 mid-upgrade partial/stale 安装的预期行为 + fixture——
  (a) partial（hooks/ 部分到位）：pre-commit 按 fail-closed 报缺失文件名（非笼统 FAIL），不假装 PASS；
  (b) stale（deploy-manifest 投影旧版）：generate-deploy-manifest --check 在 pre-commit 的 Gate 0 段或 doctor 检测为 STALE 并提示 regenerate；
  (c) 测试 fixture 构造 partial/stale 两态，断言上述行为。

### 1.4 TDD 顺序（P1-A）

1. RED：deploy-manifest.test.js（AC-A1-1a/b/c）——清单模块不存在，先红
2. GREEN：写 deploy-manifest.js
3. RED：update-hooks 契约测试（AC-A1-3：update 后含 hook-module-resolution.sh + post-commit）——当前 update-hooks 缺这两文件，先红
4. GREEN：update-hooks.js 改消费 HOOK_FILES
5. RED：install/doctor 部署断言（AC-A2-1/2/3）——gate 脚本不部署，先红
6. GREEN：install.sh source 生成清单 + doctor 派生
7. RED：pack 契约测试（AC-A3-1/2）——先红
8. GREEN：sync-package-content HOOK_FILES 对齐
9. RED：LAYER_CHECKER_MISSING BLOCK 测试（AC-A3-3，D1）——当前 WARN，先红
10. GREEN：pre-commit 该分支升 BLOCK

**估算**：3–4 天。

---

## 2. P1-C：解析层收敛

### 2.1 现状实测

- `githooks/pre-push:534-545`：手写 `if global → elif project → elif script-dir` 级联，注释"3-tier resolution (global → project → script dir)"——**与设计意图 project-first 相反**。对 hook-module-resolution/HOOK_ADAPTER_DIR_TIERS/_hook_resolve 引用计数 = 0。
- `githooks/pre-commit:243`：正确范式 `ADAPTER_DIR="$(_hook_resolve 'adapter-common' HOOK_ADAPTER_DIR_TIERS)"`。
- `src/npm-package/hook-module-resolution.sh`：顶层死副本，global-first 过期内容，三重盲区（无消费者/无 parity/无 sync）。

后果：全局安装 + 项目自带 githooks/ 的机器上，同一 push 的 pre-commit 用项目副本（project-first）、pre-push 用全局副本（global-first）——优先级反转。

### 2.2 设计

**REQ-C1（pre-push 接入生成表，D5）**

pre-push:534-545 的手写级联替换为与 pre-commit:243 同源的解析：

```bash
# Source adapter-common.sh — tiers from the generated table (project-first),
# never a hand-written cascade. Same source as pre-commit (#789 根因④).
ADAPTER_COMMON="$(_hook_resolve 'adapter-common' HOOK_ADAPTER_DIR_TIERS)" || ADAPTER_COMMON=""
# shellcheck source=githooks/adapter-common.sh
source "${ADAPTER_COMMON:-/dev/null}" 2>/dev/null || {
  echo "⚠️ Could not source adapter-common.sh. SKIP — Gate M."
  GATE_M_SKIP_REASON="adapter-common.sh could not be sourced"
}
```

前提：**pre-push 顶部当前未 source hook-module-resolution.sh**（实测 grep 零命中，连 _hook_resolve 函数都未加载；pre-commit:78-86 有完整加载逻辑）。P1-C 必须在 pre-push 顶部补加载，对齐 pre-commit:78-86 的两级 fallback 范式：

```bash
HOOK_RESOLUTION_SH="${SCRIPT_DIR}/hook-module-resolution.sh"
if [ ! -f "$HOOK_RESOLUTION_SH" ] && [ -f "$GLOBAL_ADAPTER_DIR/hook-module-resolution.sh" ]; then
  HOOK_RESOLUTION_SH="$GLOBAL_ADAPTER_DIR/hook-module-resolution.sh"
fi
# shellcheck source=githooks/hook-module-resolution.sh
source "$HOOK_RESOLUTION_SH" 2>/dev/null || {
  echo "FATAL: cannot load hook-module-resolution.sh" >&2
  exit 1   # fail-closed，与 pre-commit:82-89 一致
}
```

然后 534-545 的手写级联才能换成 `_hook_resolve` 调用（函数已加载）。

**AC-C1-1**：pre-push 引用 hook-module-resolution.sh / HOOK_ADAPTER_DIR_TIERS / _hook_resolve（当前计数=0 → 变为 >0）。
**AC-C1-2**：全局安装 + 项目自带 githooks/adapter-common.sh 时，pre-push 与 pre-commit 解析到同一份（新增 bats：构造 global+project 双副本 fixture，断言两路解析路径相同）。
**AC-C1-3**：pre-push 对项目级 adapter-common 的解析顺序与 pre-commit 一致（project-first）——断言 HOOK_ADAPTER_DIR_TIERS 在 pre-push 上下文与 pre-commit 相同。
**AC-C1-4（C-1）**：两条 fail 路径显式区分并测试——
  (a) hook-module-resolution.sh 本身缺失 → pre-push FATAL exit 1（与 pre-commit:82-89 一致，解析表不可用则无法判断任何优先级，fail-closed）；
  (b) resolution 表可用但 adapter-common.sh 在所有 tier 都不存在 → pre-push SKIP Gate M + GATE_M_SKIP_REASON（#404 P0 语义：每个 SKIP 记录 WHY），**不得**因 (b) 回归成 FATAL。bats 同时断言 (a) exit≠0 且 (b) exit=0 + reason 非空。
  **Rationale（缺口#5，架构#5：不对称性论证）**：(a) 中解析表是判断任何 tier 优先级的**先验条件**——表缺失则"该用 global 还是 project 副本"这个问题本身无法 fail-closed 地回答，放行等于用错误优先级执行，故 FATAL；(b) 中表在、优先级可判、只是所有 tier 都无 adapter-common——此时 Gate M 无 adapter 可路由，降级 SKIP+reason 不阻断提交（与 pre-commit 既有 SKIP 语义一致）。**不对称是 fail-closed 原则在两层不同失败上的正确投影，不是特例。**
**AC-C1-5（缺口#6，技术 B2：存量无表安装的升级窗口）**：现有安装的 pre-push 无生成表（引用计数=0）。P1-C 升级后 pre-push 开始 source hook-module-resolution.sh——若目标 hooks 目录无此文件会 FATAL。故：
  (a) **update-hooks / init 再生解析表**：update-hooks 部署 hook-module-resolution.sh（已在 HOOK_FILES，P1-A 修复后自然到位）+ pre-push 顶部加载逻辑与 pre-commit 同范式（两级 fallback：SCRIPT_DIR → GLOBAL_ADAPTER_DIR）；
  (b) **版本化 fallback**：pre-push 加载逻辑对"无表"安装（旧版升级未跑 update-hooks）降级为 SKIP Gate M + reason="hook-module-resolution.sh missing, run xp-gate update-hooks"，**不 FATAL**（与 pre-commit 的 FATAL 区分——pre-commit 已 fail-closed 多年且用户已习惯其 FATAL 提示；pre-push 首次引入表加载，给一个升级缓冲期，下个版本再收紧为 FATAL）。测试断言两态：有表→正常解析；无表→SKIP+reason 非 FATAL。**缓冲期契约过期（R1 重审缺口#3 补；二轮 A3/F3 精化）**：该 SKIP 缓冲是**有版本号的临时态**，非永久语义——在 specification.yaml 登记后续 REQ（REQ-P1C-FOLLOWUP-01，目标 v0.39.0）。**移除标准（A3/F3：避免指标装饰化）**：v0.39.0 发布即**强制收紧为 FATAL**（与 pre-commit 对齐，无条件）；"doctor 统计的无表安装占比 <1%"仅作**提前收紧的可选项**（数据源=opt-in doctor telemetry 或 CI 聚合占比，未接入前不触发），**不作 gate**——whichever-first 中 v0.39.0 是硬上限，占比指标是 decoration-resistant 的提前量而非依赖项。本次 sprint 的 specification.yaml 必须含此 follow-up REQ 条目（含目标版本 + 移除标准 + 起算点），使缓冲期有契约过期而非依赖部落记忆。

**REQ-C2（删顶层死副本 + 防再生，D4）**

**AC-C2-1**：`git rm src/npm-package/hook-module-resolution.sh`（顶层孤儿）。
**AC-C2-2**：sync-package-content.js + check-hook-mirror.sh 断言顶层无此孤儿（防再生：新增测试断言 `!existsSync(src/npm-package/hook-module-resolution.sh)`，且 sync 不生成它）。
**AC-C2-3**：确认无部署路径消费它（install.sh 引用 $HOOKS_DIR 副本，已核实；grep 全仓无消费者）。

### 2.3 TDD 顺序（P1-C）

1. RED：pre-push 解析表引用测试（AC-C1-1）——当前计数=0，先红
2. GREEN：pre-push source 生成表 + 删手写级联
3. RED：双副本一致性 bats（AC-C1-2）——当前 pre-push global-first，先红
4. GREEN：pre-push 与 pre-commit 同源解析
5. RED：顶层孤儿不存在断言（AC-C2-1/2）——当前文件存在，先红
6. GREEN：git rm + sync 断言

**估算**：1–2 天。依赖 P1-A（部署统一后 pre-push 部署的解析表才是 project-first 版本——但 pre-push 改的是 githooks/ 源，与部署清单解耦，可同 sprint 并行准备，BUILD 时先 A 后 C）。

---

## 3. 等价性与回归风险

| 风险 | 缓解 |
|---|---|
| D1 BLOCK 化误伤存量用户（architecture.yaml 存在但 gate-6-layers.sh 未部署） | AC-A3-3 测试覆盖；release notes 明示"升级后重跑 xp-gate init / setup-global"；fail-closed 哲学先例（Gate 8 #499） |
| pre-push 改解析后 Gate M 在无 adapter-common 时行为变化 | AC-C1-2/3 双副本一致性 bats；保留 SKIP+reason 语义（#404 P0：每个 SKIP 记录 WHY） |
| 删顶层死副本误删消费者 | AC-C2-3 grep 全仓零消费者核实；git 历史可恢复 |
| deploy-manifest 与 sync-package-content HOOK_FILES 分歧 | AC-A1-1a 断言清单=包内实际文件；契约测试 AC-A3-1 断言 pack tarball 含全集 |
| install.sh source 生成片段的生成器遗漏 | generate-deploy-manifest.cjs --check（仿 generate-hook-resolution.cjs --check 范式）进 CI |

---

## 4. 验收总览（DoD）

- [ ] deploy-manifest.js（数据契约 v1）+ deploy-manifest.test.js（AC-A1-1a/b/c/d/e/f/g/h/i）
- [ ] generate-deploy-manifest.cjs + githooks/deploy-manifest.sh 投影（--check 进 CI，AC-A1-1e）
- [ ] shared-utils/update-hooks/init/install.sh/doctor/uninstall 六方消费清单（AC-A1-2/3；AC-A1-1h 断言无私有字面量清单）
- [ ] gate-*.sh 部署 + doctor 派生（AC-A2-1/2/3/4/5；update-hooks 同时修 gate 脚本）
- [ ] pack 契约测试 + 全局安装 source 成功（AC-A3-1/2）
- [ ] LAYER_CHECKER_MISSING 升 BLOCK（AC-A3-3，D1；输出含修复命令）
- [ ] D1 迁移：doctor --fix 触发/幂等/离线 + escape hatch XP_GATE_SKIP_LAYER_CHECK=1（AC-A3-5）；滚动升级 partial/stale fixture（AC-A3-6）
- [ ] pre-push source 生成表 + 删手写级联（AC-C1-1/2/3/4/5；双路径 FATAL/SKIP + 无表缓冲期）
- [ ] 删顶层死副本 + sync 防再生（AC-C2-1/2/3）
- [ ] 镜像同步：改 githooks/ 后 `node src/npm-package/scripts/sync-package-content.js --fix` + `bash scripts/check-hook-mirror.sh`
- [ ] 全量回归：npm test / vitest / tsc --noEmit / eslint / bats 全绿
- [ ] 代码与文档分离提交；VERSION 经 node scripts/sync-version.cjs
- [ ] #754 #740 #779 核实测试绿后 close（D3）

---

## 5. Delphi 评审记录

### R2 设计维度（2026-11-09，已通过）

**执行了独立的 R2 delphi-review**（设计维度，3 专家 distinct 模型：deepseek-v4.1-flash / glm-5.3-flash / Ling-3.1-flash，external 通道）。

- **结论：CONSENSUS REACHED 100%，4 轮**（R1 0/3 → R2 1/3 → R3 1/3 → R4 3/3 APPROVED，confidence 7-8）
- **R4 APPROVED 时保留的 5 个执行细节缺口**（非架构缺陷，已落为 AC）：
  - A-1（Med）→ AC-A1-1e：--check 进 CI 构建门，不止测试
  - A-2（Low）+ C-Low → AC-A1-1f：copyAdapters/uninstall require 清单（B-watch2：uninstall 不得成第五份手写清单）
  - C-1（Med）→ AC-C1-4：resolution-missing=FATAL vs adapter-common-missing=SKIP 双路径测试
  - B-watch1 → AC-A1-1g：bash shebang + $BASH_VERSION 断言
  - C-High → AC-A2-4：install.sh source 投影的 fail-closed guard + missing/stale 契约测试
  - C-Medium → AC-A3-4：D1 BLOCK 化配套 doctor --fix 自动迁移 + 升级路径测试

### R1 需求维度（2026-11-09，首轮 0% 共识 → 吸收 6 缺口后重审通过）

**执行了独立的 R1 delphi-review**（需求维度，同 3 专家）。**首轮 5 轮 0% 共识（NO CONSENSUS）**——三专家一致 REQUEST_CHANGES，意见高度一致且全部可操作。缺口与吸收：

| 缺口 | 提出者 | 吸收为 |
|---|---|---|
| #1 deploy-manifest schema/契约未定义；六消费方"都消费清单"无 AC 断言（双投影 freshness 必要不充分） | 架构#1 + 可行性#1 | §1.2 数据契约 v1（字段/投影目标/bash 消费归属）+ **AC-A1-1h**（静态/AST 断言六方无私有字面量清单，CI 失败于回归） |
| #2 AC-A2-2/3 与 P1-B 边界模糊（doctor 派生 / bash 断言偏向 registry 治理） | 架构#2 + 可行性#4 + 技术 minor | **AC-A1-1i**（边界澄清：doctor 仅限 gate-script 部署清单派生；bash 断言仅限部署契约） |
| #3 D1 BLOCK 化迁移/回滚/升级窗口未指定；鸡生蛋（pre-commit BLOCK→无法跑 doctor） | 架构#3 + 技术 B1 + 可行性#2/3 | **AC-A2-5**（update-hooks 同时修 gate 脚本）+ **AC-A3-3**（BLOCK 输出含修复命令）+ **AC-A3-5**（doctor --fix 触发/幂等/离线 + escape hatch XP_GATE_SKIP_LAYER_CHECK=1）+ **AC-A3-6**（滚动升级 partial/stale 预期行为 + fixture） |
| #4 用户画像缺口（CI 非交互 / install.sh-only / 从不重跑 update-hooks 的存量用户） | 架构#4 + 技术 B3 | CONTEXT.md 用户画像 5/6/7，各带验证路径 |
| #5 AC-C1-4 双路径不对称 rationale 未文档化 | 架构#5 | AC-C1-4 Rationale 段（表缺失=先验条件失败→FATAL；表在仅 adapter 缺失→可降级 SKIP） |
| #6 存量无表安装升级后 pre-push FATAL 无再生 trigger | 技术 B2 | **AC-C1-5**（update-hooks/init 再生表 + 版本化 fallback：无表降级 SKIP+reason 缓冲期，下版本收紧 FATAL） |

**R1 重审（首轮吸收 6 缺口后，2/3 APPROVED，feasibility 余 3 窄缺口）→ 二轮吸收**：
- 重审缺口#1（AC-A1-1h grep 误报）→ AC-A1-1h 精化：AST 解析（Node 方 babel/acorn）+ shell strip-comments 后 grep，范围限定六消费方活代码路径，排除注释/docblock/测试 fixture/文档示例，定义误报 triage 路径
- 重审缺口#2（escape hatch 滥用）→ AC-A3-5(d) 补滥用治理：作用域限定 LAYER_CHECKER_MISSING + 每次 WARN 日志（时间戳+remediation）+ CI 环境拒绝该变量 + sunset（v0.38.x 一次性缓冲，v0.39.0 移除，移除标准=doctor --fix 上线满一个 minor）
- 重审缺口#3（缓冲期无契约过期）→ AC-C1-5(b) 补：specification.yaml 登记 REQ-P1C-FOLLOWUP-01（目标 v0.39.0，移除标准=无表安装占比<1% 或 v0.39.0 发布），缓冲期有契约过期非部落记忆

- **重审结论**：首轮 6 缺口 + 二轮 3 缺口全部落为可测 AC，需求集完整（三专家中 architecture+technical 已 APPROVED，feasibility 的 3 点为 spec 补全项，二轮吸收后应闭合）。R1 证据见 `.sprint-state/phase-outputs/requirements-reviewed.json`
- **采纳的 #789 历史 Delphi 结论**（#789 正文：首轮 0/3、5 轮无共识、三条实质意见）：解析单一实现（D5）、不引入 12×14 meta-gate 矩阵、测量先于冻结（语言分布属 P1-E，本次不做）

证据文件：`.sprint-state/delphi-reviewed.json`（R2）、`.sprint-state/phase-outputs/requirements-reviewed.json`（R1 重审）。
