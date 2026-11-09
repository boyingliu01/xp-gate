# CONTEXT.md — 项目特性上下文

## 项目背景

XP-Gate 是确定性 git 质量门禁 + AI 多专家评审（Delphi）+ Sprint Flow 流水线的工具集，核心是 `xp-gate` CLI + 12 道确定性门禁（纯 shell/CLI，零 AI 耦合）。

- 门禁链：G0 版本一致性 → G1 语言适配器 → G2 jscpd → G3 复杂度 → G4 principles → G5 测试+覆盖率 → G6 架构 → G7 IaC → G8 密钥扫描(fail-closed) → G9 build integrity → G10 SAST → G11 sprint → G12 文件卫生（warn-only）
- 语言适配器在 `githooks/adapters/*.sh`，评分与审计在 `src/npm-package/lib/gate-audit.ts`
- 镜像纪律：`src/npm-package/**` 是 `githooks/**` 等规范源的字节级镜像，改规范源后必须 `sync-package-content.js --fix`
- 解析层单一事实源：`src/npm-package/lib/hook-module-resolution.js`（project-first），`githooks/hook-module-resolution.sh` 由 `scripts/generate-hook-resolution.cjs` 生成

## 本次特性（sprint-20261109-15：P1-A 部署链路单一事实源 + P1-C 解析层收敛）

来源：架构正交分解（#789 索引 + docs/plans/2026-11-09-architecture-orthogonal-decomposition.md 实测）。用户已确认本次 sprint 范围 = P1-A + P1-C。

### P1-A 部署链路单一事实源（根因②）
同一份「装哪些文件」清单手写 4 处且互不一致：
- `src/npm-package/lib/shared-utils.js:70`（copyHooks 5 文件 flat：pre-commit/pre-push/post-commit/post-merge/hook-module-resolution.sh）
- `src/npm-package/lib/update-hooks.js:165`（copyHooks 3 文件 nested，缺 post-commit + hook-module-resolution.sh + lib/）
- `src/npm-package/scripts/sync-package-content.js:255`（prepack HOOK_FILES 6 文件）
- `scripts/check-hook-mirror.sh:20`（HOOK_MIRROR_FILES 47 对）
- 另有 `githooks/install.sh:20` GATE_SCRIPTS、`src/npm-package/lib/doctor.js` EXPECTED_GATE_SCRIPTS、`uninstall.js:868` 同步注释

后果（活 bug）：
- `update-hooks --scope hooks` 装出缺 hook-module-resolution.sh 的 hooks 目录 → pre-commit fail-closed FATAL（把能用的安装破坏成提交不可用）
- registry / gate-6-layers.sh 随包发布但不部署（#769 / #783）
- update-hooks copyAdapters 拷 nested → 全局安装造出 `adapters/adapters/` 双层

### P1-C 解析层收敛（根因④）
- `githooks/pre-push:534-545` 手写 global→project→script 级联（与设计意图 project-first 相反），对 hook-module-resolution/HOOK_ADAPTER_DIR_TIERS 引用计数 = 0
- `githooks/pre-commit:243` 已正确消费 HOOK_ADAPTER_DIR_TIERS（project-first）
- 后果：全局安装 + 项目自带 githooks/ 的机器上，同一 push 的 pre-commit 用项目副本、pre-push 用全局副本（优先级反转）
- 附带：`src/npm-package/hook-module-resolution.sh` 顶层死副本（global-first 过期，三重盲区：无消费者/无 parity/无 sync）

## 分工边界

- 部署清单（数据）：声明「包内 hooks/ 各文件 → 安装目标位置」，是唯一事实源
- 安装器（init/update-hooks/install.sh/setup-global/uninstall）：消费清单，保留 3 套但数据源统一（D2）
- 解析层（hook-module-resolution）：pre-commit 与 pre-push 都 source 同一生成表（D5）
- 契约测试：发布/安装链路改动先写契约测试（AGENTS.md 规则 4，plugins/dsh/src/contract.test.ts 范式）

## 关键环境

- 开发机：Windows 11 + Git Bash；worktree 隔离（.worktrees/sprint-20261109-arch）
- core.hooksPath = ~/.config/xp-gate/hooks（全局）——改 githooks/ 脚本对本地提交不生效，需 `xp-gate doctor --sync-hooks` 同步后验证（#451 陷阱）
- npm registry：npmmirror.com 滞后，安装/验证用 --registry=https://registry.npmjs.org

## 领域术语

- **部署清单**：包内文件 → 安装目标位置的映射数据，替代 4 处手写清单
- **fail-closed**：无法得出确定结论时必须 BLOCK 而非放行（同 Gate 8 #499 哲学）
- **优先级反转**：pre-push 全局优先 vs pre-commit 项目优先，同一机器两套结论
- **死副本**：被 git 跟踪但无消费者/无 parity/无 sync 的文件（三重盲区）
- **契约测试**：发布/安装前就红的集成测试（先于实现提交）

## 用户画像（R1 Delphi 吸收后补全：原 4 个 + R1 缺口#4 补 3 个）

1. **全局安装用户**（xp-gate setup-global）：升级后 update-hooks 不应把能用的安装破坏成 FATAL；gate 脚本应被部署
2. **项目自带 githooks/ 的用户**：pre-commit 与 pre-push 应解析到同一份 adapter-common（优先级一致）
3. **存量 architecture.yaml 用户**：D1 BLOCK 化后应有 doctor --fix 自动迁移路径 + 一次性 escape hatch，而非仅 release notes
4. **xp-gate 维护者**：新增 gate/hook 脚本时漏改部署清单应被测试拦截（防漏改）
5. **CI / 非交互安装用户**（R1 缺口#4）：install.sh 在 CI 无 TTY 环境跑，AC-A2-4 的 fail-closed guard 改变其失败模式——从"静默装残缺"变为"明确 exit 非 0 + 可操作提示"。验证路径：CI fixture 断言 install.sh 在投影缺失时 exit≠0 且 stderr 含 regenerate 命令（非交互可读）
6. **install.sh-only 用户**（R1 缺口#4，技术 B3）：只用 `bash githooks/install.sh`（从不跑 xp-gate init/update-hooks）的群体——正是 #783 实测"GATE_SCRIPTS 声明 9 个却不拷"的受害者。验证路径：install.sh 契约测试独立覆盖（不依赖 init/update-hooks）
7. **从不重跑 update-hooks 的存量用户**（R1 缺口#4，技术 B3）：升级 xp-gate 后不重跑 update-hooks，hooks 目录停留在旧版。验证路径：AC-A2-5（update-hooks 修复 gate 脚本）+ AC-C1-5(b)（pre-push 无表降级 SKIP 缓冲期）共同覆盖此群体的升级窗口

## 关键决策（grill-with-docs 敲定，2026-11-09；详见 .sprint-state/decisions.md DR-004）

1. **D1 BLOCK 时机**：architecture.yaml 存在时 LAYER_CHECKER_MISSING 升 BLOCK（本次一起）。存量未部署成功用户升级后提交失败——但 #783 修复后 gate-6-layers.sh 正确部署，新安装用户不再触发；存量用户的失败是逼其重装/更新的信号，符合 fail-closed 哲学（Gate 8 #499 先例）
2. **D2 安装器统一范围**：只统一白名单来源（数据化），安装器保留 3 套（init/update-hooks/install.sh）消费同一清单。不合并安装器代码（改动面大，回归风险超目标）
3. **D3 已修未关关单**：授权核实测试绿后直接 close #754 #740 #779（#789 step 0）
4. **D4 顶层死副本**：删除 src/npm-package/hook-module-resolution.sh + sync 断言防再生（它是 global-first 过期内容，保留=保留错误）
5. **D5 pre-push 接入**：pre-push source 生成的 hook-module-resolution.sh（HOOK_ADAPTER_DIR_TIERS），与 pre-commit 同源；删手写 global-first 级联。单一解析实现（#789 Delphi 结论：解析只能有一份实现）

## 关键证据源

- Issue #789（索引，4 根因/5 sprint/14 症状）、#790（镜像 A/B/C，P1-E 前置，本次不做）、#791（Gate 10 性能负结果，P1-F，本次不做）
- #783（gate-6-layers.sh 不部署）、#769（registry 不部署）、#771/#770（uninstall 误删）、#741/#756
- docs/plans/2026-11-09-architecture-orthogonal-decomposition.md（根因实测）
- docs/plans/2026-11-09-architecture-sprint-breakdown.md（REQ/AC 边界 + 依赖图）
- 实测：update-hooks 白名单 3 文件 vs shared-utils 5 文件；pre-push 解析表引用计数=0；顶层死副本 global-first
