# P1-A 部署清单 + P1-C 解析收敛 — 设计勘误 v2（实证修正）

> **本文档性质**：`2026-11-09-deploy-resolution-design.md`（v1，已 Delphi R1/R2 100% 通过并随 6518011 提交）的**事实勘误**。按 `docs/AGENTS.md`「Plans are immutable once Delphi-APPROVED. Corrections happen in a new -v2 file」——v1 保持不可变，修正记录于此。
>
> **勘误触发**：BUILD 启动前的 setup-global 实证 + git 历史核实，发现 v1 §1.1 实测表有两处与现实不符，且暴露一个被 v1 误判的事实（#783 的全局安装态 gate 部署）。
>
> **设计结构不变**：deploy-manifest.js 单一事实源 + 双投影（Node require / 生成 shell）+ 六消费方统一 + 防漏改断言 + LAYER_CHECKER_MISSING→BLOCK + pre-push 接入生成解析表。v1 经 Delphi 批准的结构全部保留。本次只修正**事实表、清单成员、部署目标映射、#783 状态判断**。

---

## 勘误 1 — §1.1 install.sh 行（数量与行为均误）

**v1 写**：「GATE_SCRIPTS 声明 9 个但**不拷到 .git/hooks**」
**实测**（githooks/install.sh:19-20, :54-59）：
- `GATE_SCRIPTS="gate-3.sh gate-4.sh gate-7.sh gate-8.sh gate-9.sh gate-10.sh gate-13-compiler-strictness.sh"` —— **7 个**（非 9）
- `:54 for gate in $GATE_SCRIPTS hook-module-resolution.sh; do cp ... $TARGET_HOOKS/$gate` —— **确实拷**到 `.git/hooks/`（非"不拷"）
- 真实缺陷是**枚举白名单不全**：缺 `gate-6-layers.sh` / `gate-registry.sh` / `gate-12-file-hygiene.sh`（包内 10 个 gate-*.sh 只拷 7 个）

## 勘误 2 — §1.1「后果」段与「关键区分」段（全局 gate 部署已修）

**v1 写**：「问题全在安装链路（三套安装器都不拷 gate-*.sh 到用户机器）——#783 的『包内有、安装后无』正是此因」
**实测修正**（三条独立证据）：

1. **copyAdapters 已部署 gate**（shared-utils.js:109-126，2d6390a9「repair gate-script deployment」2026-09-23 引入，v0.37.2 已含——`git show v0.37.2:src/npm-package/lib/shared-utils.js` 有 2 处 `startsWith('gate-')`）：`f.startsWith('gate-') || f === 'sprint-gate.sh'` 前缀过滤，把 githooks/ 与包根的**全部** gate-*.sh + sprint-gate.sh 拷到 adapters/ 目标目录。
2. **setup-global 实证**（临时 HOME 隔离跑 `xp-gate setup-global`）：`~/.config/xp-gate/adapters/` 含全部 10 个 gate-*.sh（gate-3/4/6-layers/7/8/9/10/12-file-hygiene/13-compiler-strictness/registry）+ sprint-gate.sh + adapter-common.sh + 13 adapters + lib。`~/.config/xp-gate/hooks/` 无 gate（正确——gate 不属于 hooks/ 部署目标）。
3. **pre-commit GATE_DIR 解析成功**：hook-module-resolution.js:67-86 `GATE_RESOLUTION_ORDER` = gate_adapter_dir(ADAPTER_DIR, probe gate-3.sh) → gate_project → gate_script_dir。全局安装态 ADAPTER_DIR=~/.config/xp-gate/adapters，gate-3.sh（probe）与 gate-6-layers.sh 均在 → `GATE_DIR` 解析到 adapters/ → pre-commit:4371 `$GATE_DIR/gate-6-layers.sh` 命中 → Gate 6 执行。

**结论**：#783 报告的复现命令 `ls ~/.config/xp-gate/hooks/` 显示无 gate 是**事实**，但 gate 的正确部署位置是 adapters/（pre-commit 的 GATE_DIR gate_adapter_dir tier 搜 adapters/，不搜 hooks/）。#783 的归因「copyHooks 硬编码白名单致 gate 不部署」与实证不符——**全局安装的 gate 部署由 copyAdapters 前缀过滤覆盖，当前 main 已修**。#783 报告时（v0.37.2）copyAdapters 的 gate 拷贝逻辑已在发布版（2d6390a9 早于 0.37.2）。

## 勘误 3 — #783 状态重估与 P1-A 对它的真实剩余修复

#783 的 3 条建议仍有真实价值，但「全局安装 Gate 6 永远不执行」这一字面现象在当前 main **已不成立**（实证）。P1-A 对 #783 的真实剩余修复聚焦四点：

| #783 建议 | 当前 main 状态 | P1-A 修复 |
|---|---|---|
| ① copyHooks 硬编码白名单结构性 | **仍存在**（copyHooks 5 文件枚举曾漏 post-commit/hook-module-resolution；install.sh 枚举漏 3 gate；update-hooks sprint-gate 硬编码单文件） | deploy-manifest 单一事实源 + 防漏改断言（AC-DEPLOY-01/07） |
| ② 回归测试「包内 hooks/ 每个 .sh 都出现在安装后目录」 | **不存在**（打包测试查 tarball，安装测试跑 pre-commit，都不覆盖「安装后该有什么」） | AC-DEPLOY-01 防漏改断言 + AC-DEPLOY-15 pack 契约 + AC-DEPLOY-16 全局安装源 |
| ③ LAYER_CHECKER_MISSING→BLOCK（architecture.yaml 存在时） | **仍 WARN**（pre-commit:4416） | D1 + AC-DEPLOY-17（BLOCK）+ AC-DEPLOY-18（doctor --fix 迁移 + escape hatch） |
| （新增）项目内 install.sh 枚举漏 3 gate | **仍存在**（GATE_SCRIPTS 7 个漏 gate-6-layers/registry/12） | install.sh 消费 deploy-manifest GATE_FILES（AC-DEPLOY-11） |

**对 #783 的 close 判断修正**：#783 不是「完全未修」，而是「全局部署已修（copyAdapters），结构性白名单 + 项目内枚举漏 + doctor 漏报 + WARN 未 BLOCK 仍存」。P1-A 修剩余四点后可 close #783（D3 授权核实测试绿后 close）。

## 勘误 4 — §1.2 GATE_FILES 成员（漏 2 个）

**v1 GATE_FILES（9 个）**：gate-3/4/6-layers/7/8/9/10/13-compiler-strictness/registry
**实测包内 gate-*.sh（10 个）** + sprint-gate.sh（Gate S 脚本）= **11 个**：

```
GATE_FILES = [
  'gate-3.sh', 'gate-4.sh', 'gate-6-layers.sh', 'gate-7.sh', 'gate-8.sh',
  'gate-9.sh', 'gate-10.sh', 'gate-12-file-hygiene.sh', 'gate-13-compiler-strictness.sh',
  'gate-registry.sh', 'sprint-gate.sh'
]
```

- **补 gate-12-file-hygiene.sh**（v1 漏；pre-commit Gate 12 warning-only 脚本，被 gate-registry.sh 路由）
- **补 sprint-gate.sh**（v1 未列；Gate S 脚本，copyAdapters:112/122 与 update-hooks.copySprintGate:239 都部署它）

防漏改断言（AC-DEPLOY-01）遍历包内 `gate-*.sh` + sprint-gate.sh 比对 GATE_FILES——正是为了拦截这类漏列（v1 手抄漏 gate-12 即是活例，讽刺地印证根因②）。

## 勘误 5 — 部署目标映射（v1 假设 gate 统一部署到 hooks/，实证否）

**实证**：gate 脚本的部署目标**依安装链路而异**，pre-commit/pre-push 通过 GATE_DIR tier 兼容：

| 链路 | 部署目标 | gate 脚本去向 | 解析方 |
|---|---|---|---|
| 全局 setup-global（copyAdapters） | ~/.config/xp-gate/adapters/ | gate-* + sprint-gate 平铺到 adapters/ | pre-commit GATE_DIR gate_adapter_dir tier（probe gate-3.sh） |
| 项目内 install.sh | .git/hooks/ | 7 gate（枚举漏 3）+ hook-module-resolution | pre-commit GATE_DIR gate_script_dir tier（hook 脚本目录 = .git/hooks/） |
| update-hooks --scope global | ~/.config/xp-gate/adapters/ | gate-*（前缀过滤）+ sprint-gate | 同上 |
| update-hooks --scope hooks | 项目 .git/hooks/ | gate-*（前缀过滤）+ sprint-gate（:239 硬编码到 hooksDestDir） | gate_script_dir tier |

**关键澄清**：
- **copyHooks / update-hooks --scope hooks 不拷 gate 是正确的**——gate 不属于 hooks/ 部署目标（pre-commit GATE_DIR 不搜 hooks/，搜 adapters/ + project-githooks/ + script-dir）。v1 把 copyHooks/update-hooks 列为 GATE_FILES 消费方需修正：它们消费 HOOK_FILES（hooks 部署），**不消费 GATE_FILES**。
- **GATE_FILES 的真实消费方**：copyAdapters（全局 adapters/）、install.sh（项目内 .git/hooks/）、update-hooks.copyGateScripts（scope 依参数）、doctor（EXPECTED_GATE_SCRIPTS 派生校验）、uninstall（删除）。
- **sprint-gate.sh 的归属**：它随 gate 一起部署（adapters/ 或 hooks/ 依链路），pre-push Gate S 搜 4 tier（project githooks/ + script dir + hooks/ + adapters/，pre-push:445-446）兼容。deploy-manifest 把它列入 GATE_FILES（与 copyAdapters 的 `f === 'sprint-gate.sh'` 条件一致）。

## 勘误 6 — copyAdapters 前缀过滤 → 枚举的权衡

copyAdapters 现用 `f.startsWith('gate-')` 前缀过滤（自动覆盖新 gate，无漏清单问题）。统一到 deploy-manifest 枚举 GATE_FILES 后，引入「新增 gate 忘改清单」的风险——但 AC-DEPLOY-01 的防漏改断言（遍历包内 gate-*.sh 比对 GATE_FILES）会把这种漏变成**测试红**（显式失败），而非前缀过滤的**静默正确**。权衡：枚举 + 断言 > 前缀过滤，因为前者漏了会响，后者掩盖了「到底该部署哪些文件」这个事实本身（无法回答 doctor「该有哪些」）。v1 §1.2 的「六消费方」表述据此修正为上述真实消费方集合。

---

## 对 BUILD 的影响（TDD 起点不变，断言用修正后成员）

- deploy-manifest.test.js（RED 第一步）的 GATE_FILES 防漏改断言用 **11 个成员**（含 gate-12-file-hygiene.sh + sprint-gate.sh），遍历包内 gate-*.sh + sprint-gate.sh 比对。
- HOOK_FILES（5：pre-commit/pre-push/post-commit/post-merge/hook-module-resolution.sh）与 ADAPTER_COMMON（adapter-common.sh）/ HOOKS_LIB（lib）不变。
- AC-DEPLOY-10/11/12 的部署目标描述按勘误 5 修正（adapters/ 或 .git/hooks/，非 hooks/）。
- specification.yaml 的 REQ-DEPLOY-002/003 与 AC-DEPLOY-10..14 描述同步修正（编号不变，内容更新）。

## 实证记录（可复现）

```
# 全局安装 gate 部署实证（临时 HOME 隔离）
tmpH=$(mktemp -d)
HOME="$tmpH" node src/npm-package/bin/xp-gate.js setup-global
ls "$tmpH/.config/xp-gate/adapters/" | grep '^gate-\|^sprint-gate'
# → gate-10.sh gate-12-file-hygiene.sh gate-13-compiler-strictness.sh gate-3.sh
#   gate-4.sh gate-6-layers.sh gate-7.sh gate-8.sh gate-9.sh gate-registry.sh sprint-gate.sh
ls "$tmpH/.config/xp-gate/hooks/" | grep gate   # → （空，正确：gate 不在 hooks/）
# GATE_DIR tier：gate_adapter_dir(ADAPTER_DIR) probe gate-3.sh → adapters/ 命中
```

git 历史：2d6390a9（2026-09-23）引入 copyAdapters gate 拷贝；e66b3120（2026-11-07）引入 gate-6-layers.sh；a2fb0f7b（2026-11-09）发布 0.37.2（shared-utils.js 已含 2 处 startsWith('gate-')）。
