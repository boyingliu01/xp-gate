# XP-Gate

> **AI 驱动开发工作流工具：10 道质量门禁 (Gate 0–9) + Delphi 多专家评审 + Sprint Flow 全流程编排**

[![Git Hooks](https://img.shields.io/badge/Git%20Hooks-Gate%200--9-green)](./githooks)
[![AI Review](https://img.shields.io/badge/AI%20Review-Delphi%20≥90%25-blue)](./skills/delphi-review)
[![Sprint Flow](https://img.shields.io/badge/Sprint%20Flow-11%20Phases-purple)](./skills/sprint-flow)
[![npm package](https://img.shields.io/badge/npm%20registry-npm%20install%20--g%20%40boyingliu01%2Fxp--gate-blue?logo=npm)](src/npm-package)

> **v0.8.1**: xp-gate 已从 GitHub Packages 迁移到公共 npm registry。新增 `xp-gate uninstall` / `doctor` / `migrate` / `check` / `principles` / `arch` 命令。

---

## 目录

1. [为什么需要 XP-Gate](#为什么需要-xp-gate)
2. [三大核心模块](#三大核心模块)
3. [快速开始](#快速开始)
4. [语言支持](#语言支持)
5. [Sprint Flow 全流程](#sprint-flow-全流程)
6. [质量门禁详解](#质量门禁详解)
7. [AI 技能集成](#ai-技能集成)
8. [配置说明](#配置说明)
9. [贡献指南](#贡献指南)
10. [许可证](#许可证)

---

## 为什么需要 XP-Gate

传统开发中，代码质量依赖人工 Code Review，存在以下问题：

| 问题 | 影响 |
|------|------|
| 评审标准不一致 | 不同 reviewer 关注点不同，质量波动大 |
| 锚定效应 | 先发言的人影响后续判断 |
| 遗漏关键问题 | 单人视角有限，复杂逻辑难以全覆盖 |
| 返工成本高 | 问题发现晚，修复成本指数级增长 |

XP-Gate 通过 **确定性门禁 + AI 多专家共识 + 全流程编排** 解决这些问题。

---

## 三大核心模块

```
┌─────────────────────────────────────────────────────────┐
│                      XP-Gate 架构                         │
├─────────────────┬─────────────────┬─────────────────────┤
│   质量门禁      │    AI 评审      │    Sprint Flow      │
│   (确定性)      │   (共识驱动)    │   (流程编排)        │
├─────────────────┼─────────────────┼─────────────────────┤
│ • 10 道门禁 0-9 │ • Delphi 方法   │ • 11 阶段流水线     │
│ • 13 语言适配   │ • ≥90% 共识     │ • 硬门槛控制        │
│ • 零容忍策略    │ • 国产模型      │ • 自动并行执行      │
└─────────────────┴─────────────────┴─────────────────────┘
```

### 1. 质量门禁 (Quality Gates)

Git 提交时自动触发，**纯代码逻辑，无 AI 参与**，确保快速可靠。

### 2. AI 评审 (Delphi Review)

多轮匿名专家评审，基于 RAND 公司 Delphi 方法论：
- 匿名性：第一轮专家互不知晓
- 迭代性：多轮直到共识
- 统计共识：≥90% 一致才算通过

### 3. Sprint Flow

一键启动完整开发流水线：
```
THINK → PLAN → BUILD → REVIEW → USER ACCEPT → FEEDBACK → SHIP
```

---

## 快速开始

XP-Gate 由 **两个互补的发行渠道** 组成，建议同时安装：

### 第一步：安装 npm 包（必需 — Git Hooks + 全流程基础设施）

**前置条件**：Node.js ≥18.x（`npm` 包运行时）、Git ≥2.38。

> Linux/macOS 用户已自带 bash，无需额外安装。Windows 用户必须安装 [Git Bash](https://git-scm.com/download/win)。

```bash
# 全局安装（公共 npm registry，无需 PAT）
npm install -g @boyingliu01/xp-gate

# 进入你的项目目录
cd your-project

# 安装 Git Hooks（每个项目只需一次）
xp-gate init

# 按需安装 AI 技能（可选）
xp-gate install-skill sprint-flow
xp-gate install-skill delphi-review
```

npm 包提供：
- **Git Hooks**（pre-commit Gate 0–9 + pre-push Gate M/M2/M3）— 每次提交/推送自动执行 14 道质量门禁
- **CLI 管理命令**（doctor, baseline, audit, uninstall 等 15+ 子命令）
- **Skill 下载器**（`xp-gate install-skill` 从 GitHub 按版本下载 SKILL.md）

npm 包 **不提供** IDE 内的即时 gate 调用和 skill 自动发现。

### 第二步：安装 IDE 插件（推荐 — AI 对话内质量工具 + 技能自动加载）

XP-Gate 同时支持 **Claude Code** 和 **OpenCode** 插件分发：

**OpenCode 插件**：
```json
// opencode.json
{ "plugin": ["@boyingliu01/opencode-plugin"] }
```

**Claude Code 插件**：
```bash
/plugin install boyingliu01/xp-gate
```

IDE 插件提供：
- **AI 对话内的质量工具**（`gate-check`、`gate-principles`、`gate-arch`，与 `xp-gate check/principles/arch` CLI 子命令输出一致）
- **AI 工作流技能自动加载**（sprint-flow、delphi-review、ralph-loop 等 8 个 skill，OpenCode 自动发现，无需 `install-skill`）
- **IDE 级 enforcement**（Claude Code PostToolUse hook：每次 Edit/Write 自动运行 principles 检查）

IDE 插件 **不提供** Git Hooks（AI 平台限制，无法在 commit/push 时机自动执行）。

> **两步的关系**：npm 包负责 git enforcement（提交门禁），IDE 插件负责 IDE 集成（对话内工具 + 自动 skill）。两者互补，**缺一不可**。只装 npm 包 ≠ skill 自动加载；只装插件 ≠ 提交门禁生效。

### xp-gate CLI 命令速查

| 命令 | 说明 |
|------|------|
| `xp-gate init` | 初始化项目，安装 hooks + adapters |
| `xp-gate setup-global` | 全局安装 adapters 到 `~/.config/xp-gate/` |
| `xp-gate uninstall` | 完整卸载 xp-gate（反向操作 init），支持 --dry-run --force --local --global |
| `xp-gate doctor` | 诊断安装状态（config/hooks/adapters/env），支持 --fix 自动修复 |
| `xp-gate baseline <create\|show\|reset\|diff>` | 管理 lint 基线（创建/查看/重置/对比），跟踪 lint 债务变化 |
| `xp-gate migrate` | 迁移助手：从 v0.4.x (GitHub Packages) 清理残留配置 |
| `xp-gate install-skill <name>` | 从 GitHub 下载并安装 Skill |
| `xp-gate update-skill <name>` | 更新已安装的 Skill |
| `xp-gate uninstall-skill <name> --force` | 卸载 Skill |
| `xp-gate audit [--tail \| --stats \| record]` | 查看/记录 gate 审计日志 |
| `xp-gate ui-review` | UI/视觉改动 review（委托给 ui-review.ts） |
| `xp-gate sprint-status [--json] [--watch] [--dir <path>]` | 查看 Sprint Flow 进度（读取 `.sprint-state/sprint-state.json`） |
| `xp-gate check <path> [--gates principles,arch]` | 在指定路径上运行用户可调用的质量门禁 (Gate 4 + Gate 6)。**v0.8.9+**：同名 OpenCode 工具 `gate-check` 即调用此命令。修复 #208。 |
| `xp-gate principles <path> [--format console\|json\|sarif]` | 单独运行 Clean Code + SOLID 检查器 (Gate 4)。OpenCode 工具 `gate-principles` 即调用此命令。修复 #208。 |
| `xp-gate arch [--config <path>]` | 单独运行架构合规检查 (Gate 6, 读取 architecture.yaml)。OpenCode 工具 `gate-arch` 即调用此命令。修复 #208。 |
| `xp-gate --version` | 查看版本 |

---

### 遗留安装路径（仓库直接克隆）

> 以下路径适用于 xp-gate 开发者或无法使用 npm 的环境。普通用户请使用上方的 npm 安装。

```bash
# 克隆仓库
git clone https://github.com/boyingliu01/xp-gate.git && cd xp-gate

# 一键安装 Git Hooks + adapter 基础设施
bash githooks/install.sh

# 验证安装完整性
bash githooks/verify.sh

# 组件化安装（按需）
bash scripts/install-hooks.sh   # 仅 hooks
bash scripts/install-skills.sh  # 仅 skills
bash scripts/install-all.sh     # 全部
```

---

## 语言支持

XP-Gate 支持 **12 种语言** + IaC 文件，通过适配器自动检测和路由：

| 语言 | 适配器文件 | 静态分析 | 测试框架 | 复杂度检测 |
|------|-----------|---------|---------|-----------|
| TypeScript | `adapter-typescript.sh` | ESLint | Jest/Vitest | lizard ✅ |
| Python | `adapter-python.sh` | Ruff/Black | pytest | lizard ✅ |
| Go | `adapter-go.sh` | gofmt/govet | go test | lizard ✅ |
| Java | `adapter-java.sh` | Checkstyle | JUnit | lizard ✅ |
| Kotlin | `adapter-kotlin.sh` | ktlint | JUnit | lizard ✅ |
| C++ | `adapter-cpp.sh` | clang-tidy | GoogleTest | lizard ✅ |
| Swift | `adapter-swift.sh` | swiftlint | XCTest | lizard ✅ |
| Objective-C | `adapter-objc.sh` | oclint | XCTest | lizard ✅ |
| Shell | `adapter-shell.sh` | shellcheck | bats | lizard ✅ |
| Dart | `adapter-dart.sh` | dart analyze | dart test | lizard ✅ |
| Flutter | `adapter-flutter.sh` | flutter analyze | flutter test | lizard ✅ |
| PowerShell | `adapter-powershell.sh` | PSScriptAnalyzer | Pester | lizard ✅ |
| IaC (Terraform/K8s/Docker) | `adapter-iac.sh` | checkov/hadolint/kube-score/tflint | N/A | N/A |

适配器位于 `githooks/adapters/`，自动根据文件扩展名选择。

> **plugins/ 扩展目录**：`githooks/adapters/plugins/` 包含第三方扩展工具（如 alibaba-java/p3c、book299-20132-python 等），可按需安装以增强特定语言检查能力。

---

## Sprint Flow 全流程

```
Phase -1     Phase -0.5      Phase 0      Phase 1     Phase 2      Phase 3       Phase 4       Phase 5      Phase 6     Phase 7      Phase 8
ISOLATE  →  AUTO-ESTIMATE →  THINK    →   PLAN    →   BUILD    →  REVIEW    → USER ACCEPT  → FEEDBACK   →  SHIP    →   LAND    →  CLEANUP
   │             │             │             │           │           │              │             │            │           │            │
   ▼             ▼             ▼             ▼           ▼           ▼              ▼             ▼            ▼           ▼            ▼
worktree      sizing        brainstorm   autoplan    ralph-loop  code-walk      manual        learn +    finishing-   land +     sprint
isolation     pass          + CONTEXT    + delphi    (default)   + QA / web     verification  retro      dev-branch   deploy +   branch
              + estimate    + ADR        review +    TDD +       benchmark     (78% bugs      debug      + ship       canary     cleanup
                                         spec.yaml   test-align                 invisible)
                                              │
                                           HARD-GATE ← 设计未达 ≥90% Delphi 共识 → 禁止编码
```

> **完整 11 阶段** (Phase -1, -0.5, 0..8)。`Phase 2 BUILD` 默认使用 `ralph-loop` (REQ 级迭代，干净上下文，节约 40-67% token)。`Phase 1 PLAN` 与 `Phase 2 BUILD` 之间存在 HARD-GATE — 设计必须通过 Delphi 评审 (≥90% 共识，≥2 家不同模型厂家) 才能开始实施。

### 各阶段说明

| 阶段 | 名称 | 关键动作 | 输出 |
|------|------|---------|------|
| -1 | ISOLATE | worktree 隔离 | 隔离工作树 |
| -0.5 | AUTO-ESTIMATE | 规模评估 | estimate 模板 |
| 0 | THINK | brainstorming | CONTEXT.md + ADR |
| 1 | PLAN | autoplan → delphi-review (HARD-GATE ≥90% 共识) | specification.yaml |
| 2 | BUILD | ralph-loop (默认) + TDD + test-spec-alignment | 功能代码 |
| 3 | REVIEW | code-walkthrough + QA + benchmark | 评审报告 |
| 4 | USER ACCEPT | 人工验收 | 验收确认 |
| 5 | FEEDBACK | retro + systematic-debugging + learn (Sprint 级) | 改进建议 |
| 6 | SHIP | finishing-a-development-branch + PR | PR 已创建 |
| 7 | LAND | land + deploy + canary | 生产部署完成 |
| 8 | CLEANUP | Sprint 分支清理 | Sprint 状态归档 |

### 使用方式

```bash
# 启动完整 Sprint
/sprint-flow "开发用户登录功能，支持 OAuth2"

# 指定技术栈
/sprint-flow "开发用户登录" --type web-nextjs --lang typescript

# 仅执行特定阶段
/sprint-flow "开发用户登录" --phase build-only
```

---

## 质量门禁详解

每次 `git commit` 自动执行 10 道门禁 (Gate 0-9)，每次 `git push` 自动执行 Gate M / M2 / M3 + Delphi 代码走查校验：

### Pre-commit（10 道门禁 Gate 0-9）

| 门禁 | 检查内容 | 阈值 | 失败行为 |
|------|---------|------|---------|
| Gate 0 | 版本一致性 (VERSION vs package.json) | 完全一致 | 阻断提交 |
| Gate 1 | 代码质量 (lint) | 零错误 | 阻断提交 |
| Gate 2 | 重复代码 (jscpd) | ≤5% 相似度 | 阻断提交 |
| Gate 3 | 圈复杂度 (lizard) | ≤5 警告，≤10 阻断 | 警告/阻断 |
| Gate 4 | Principles (14 条 Clean Code + SOLID) | 零错误 | 阻断提交 |
| Gate 5 | 单元测试 + 覆盖率 | 全部通过 + ≥80% | 阻断提交 |
| Gate 6 | 架构合规 + 童子军规则 | 无新增警告 | 阻断提交 |
| Gate 7 | IaC 安全扫描 (checkov/hadolint/kube-score/tflint) | 无 High 级别风险 | 阻断提交 |
| Gate 8 | 密钥扫描 (gitleaks) | 零泄漏 | 阻断提交 |
| Gate 9 | Semgrep SAST 安全扫描 | 无 High 级别风险 | 阻断提交 |

> **概念分组（旧 "6 道门禁" 视角）**：Gates 1+2+5 = 代码质量集群，Gate 3 = 复杂度，Gate 4 = 原则，Gate 6 = 架构，Gates 7+8+9 = 安全（0.8.x 新增），Gate 0 = 预检。两种视角同时存在，README 现在以脚本真相 (Gate 0-9) 为准。

### Pre-push（Gate M / M2 / M3 + Delphi 代码走查）

| 门禁 | 检查内容 | 阈值 | 失败行为 |
|------|---------|------|---------|
| Gate M | 增量变异测试 (Stryker, TS only) | 默认 60%，关键路径 80% | 阻断推送 |
| Gate M2 | Mock 密度内联扫描 | mock 关键字密度 ≤50% 或带 `@mock-justified` | 阻断推送 |
| Gate M3 | Mock 分层策略 (per-file validator) | 每层 mock 策略合规 | 阻断推送 |
| Delphi 代码走查 | `.code-walkthrough-result.json` 校验 | 必须存在且未过期 (vs HEAD commit) | 阻断推送 |

> **Pre-push 硬上限**：单次推送 ≤20 个文件 或 ≤500 LOC。`main`/`master` 上的推送会跳过 Delphi 代码走查校验（设计如此）。所有 pre-push 运行写入 `.xp-gate/reports/pre-push/*.json`。

### Clean Code 规则（10 条）

- CC-001: 函数长度 ≤50 行
- CC-002: 嵌套深度 ≤4 层
- CC-003: 禁止 God Class
- CC-004: 参数数量 ≤4 个
- CC-005: 圈复杂度 ≤10
- CC-006: 命名规范检查
- CC-007: 注释质量
- CC-008: 重复代码检测
- CC-009: 魔法数字检查
- CC-010: 单模块导出数 ≤10 个

### SOLID 规则（5 条）

- SOLID-001: 单一职责原则
- SOLID-002: 开闭原则
- SOLID-003: 里氏替换原则
- SOLID-004: 接口隔离原则
- SOLID-005: 依赖倒置原则

### 项目类型自动检测

| 项目类型 | 检测依据 |
|---------|---------|
| web-nextjs | next.config.js / app/ 目录 |
| web-react | vite.config.js / src/App.tsx |
| web-vue | vite.config.js / src/App.vue |
| mobile-flutter | pubspec.yaml / lib/ 目录 |
| mobile-react-native | metro.config.js / ios/ 目录 |
| backend-go | go.mod / cmd/ 目录 |
| backend-springboot | pom.xml / Application.java |
| backend-django | manage.py / settings.py |

---

## Web Dashboard

查看扫描历史和趋势：

```bash
npm run dashboard
# 打开 http://localhost:3333
```

Dashboard 包含 4 个视图 + PDF 导出：
| 视图 | 说明 |
|------|------|
| Score Trend | 提交质量评分趋势折线图 |
| Gate Pass Rate | 各 Gate 历史通过率柱状图 |
| Metrics Trend | 复杂度告警数、童子军阻断数趋势 |
| Latest Gate Status | 最新一次各 Gate 状态表 |
| Export PDF | 导出 PDF 报告（含总结 + Gate 表 + 历史） |

数据文件：
- `.quality-history.jsonl` — 每次提交的评分、Gate 状态、指标
- `quality-report.json` — 最新门禁详情

---

## AI 技能集成

XP-Gate 集成 15+ 个专业 AI 技能，按 Sprint Flow 阶段排列：

| 技能 | 来源 | 用途 | 触发时机 |
|------|------|------|---------|
| brainstorming | superpowers | 需求探索、方案设计，自动创建 CONTEXT.md + ADR | Phase 0 |
| to-issues | xp-gate | **垂直切片 Issue 拆分**——将需求拆解为可独立交付的 Issue | Phase 0→1 |
| autoplan | gstack | CEO/设计/工程自动评审 | Phase 1 |
| delphi-review | xp-gate | 多专家匿名共识（新增 User Stories→REQ→AC 追溯链） | Phase 1, 3 |
| improve-codebase-architecture | xp-gate | **定期架构健康检查**——发现死代码、架构腐化、覆盖下降 | 定期 |
| ralph-loop | xp-gate | **REQ 级迭代构建**（Phase 2 **默认模式**），Token 节约 40-67% | Phase 2 |
| test-specification-alignment | xp-gate | 测试对齐验证 | Phase 2, 3 |
| qa | gstack | Web QA 测试 | Phase 3 |
| design-review | gstack | 设计审计 | Phase 3 |
| benchmark | gstack | 性能基准 | Phase 3 |
| systematic-debugging | superpowers | 根因调试 | Phase 3, 5 |
| retro | gstack | 工程复盘 | Phase 5 |
| learn | gstack | 经验教训总结 | **Phase 5**，每个 REQ 完成时也会调用 |
| finishing-a-development-branch | superpowers | 分支收尾决策 | Phase 6 |
| dispatching-parallel-agents | superpowers | 并行任务分发 | Phase 2（可选模式） |
| executing-plans | superpowers | 计划执行 | Phase 2（可选模式） |
| cso | gstack | 安全审计 | 定期/发布前 |

### Phase 2 构建模式说明

Sprint Flow 的 Phase 2 BUILD 有两种模式：

| 模式 | 说明 | 默认 |
|------|------|------|
| **ralph-loop** | **REQ 级迭代构建**（默认模式），Token 节约 40-67%，干净上下文 | ✅ 默认 |
| 并行模式 | 使用 `dispatching-parallel-agents` + `executing-plans` | ❌ 可选 |

> **learn 调用时机**：ralph-loop 内部使用自有 learnings 分类机制（permanent/contextual），通过 progress.log 持久化。此外 Phase 5 FEEDBACK 阶段调用 `gstack/learn` 进行 Sprint 级复盘。用户期望在每个 REQ 完成时也调用 learn 及时总结经验。

### 模型选择（强制国产）

根据 XP-Gate 规范，**必须使用国产开源模型**：

| 专家 | 推荐模型 | 备选 |
|------|---------|------|
| Expert A (架构) | deepseek-v4-pro | qwen3.6-plus, glm-5.1 |
| Expert B (技术) | kimi-k2.6 | deepseek-v4-pro, minimax-m2.7 |
| Expert C (可行性) | qwen3.6-plus | kimi-k2.6, glm-5.1 |

**关键原则：** 三个专家必须来自 **至少 2 家不同厂家**。

---

## 最大化 XP-Gate 价值

XP-Gate 不只是一个工具——它是一套 AI 辅助开发的纪律体系。以下实战指南帮你榨取每一分价值。

### 1. 每天这样用（开发者日常流程）

```
写需求 → /sprint-flow "XXX"  → 自动走完 11 阶段  → 审查 PR  → merge
```

**最简路径：** 一条命令启动全流程：
```bash
/sprint-flow "开发用户认证模块，支持 JWT 和 OAuth2" --type web-nextjs
```

Sprint Flow 会自动走完：
- Phase 0: brainstorming 探索需求，生成设计文档
- Phase 1: autoplan + delphi-review 多专家评审设计（≥90% 共识才放行）
- Phase 2: ralph-loop **逐 REQ 迭代构建**（每个 REQ 干净上下文，节省 40-67% token）
- Phase 3-6: 代码走查、用户验收、复盘、发布

> **关键：** 不要跳过 delphi-review 环节。设计未通过 HARD-GATE 就写代码，等于裸奔。

### 2. 10 道门禁 (Gate 0-9)：零容忍，但不折腾

质量门禁在每次 `git commit` 时**自动运行**，无需手动触发。门禁的意义：

- **第一次用门禁会痛苦**——历史代码积累的问题集中暴露。正确做法：先跑一次全量扫描建立 baseline，开启**童子军规则**后，只保证"修改不恶化"
- **工具不可用 = SKIP，不阻断**——门禁是辅助，不是路障。某语言的工具装不上，该语言的检查会自动跳过，不影响其他语言
- **`--no-verify` 严格禁止**——绕过门禁等于放弃保护

### 3. 先设计，后编码（HARD-GATE）

XP-Gate 的核心纪律：**设计未通过，禁止写一行代码**。

```
THINK (brainstorming) → PLAN (autoplan) → delphi-review (3 专家共识) → 才轮到 BUILD
```

- `/to-issues`：需求拆成垂直切片式 Issue，每个 Issue 可独立交付
- brainstorming 自动生成 `CONTEXT.md` 和 `ADR` 记录——共享语言比个人脑嗨重要
- 3 位中国模型专家匿名评审，91% 共识阈值——避免单人视角盲区

### 4. 定期体检（/improve-codebase-architecture）

门禁只管提交那一刻的质量，不管长期健康。定期运行架构健康检查：
- 发现死代码、架构腐化、测试覆盖下降
- 给出修复优先级，不阻断日常工作

### 5. Web Dashboard：趋势比单次重要

```bash
npm run dashboard
```

看 **Score Trend** 和 **Gate Pass Rate** 的趋势线，不要盯着单次分数。趋势向上说明流程在起作用。

### 6. 童子军规则：历史项目也能用

童子军规则（Boy Scout Rule）是 XP-Gate 对存量项目的关键：

| 文件状态 | 门禁要求 |
|---------|---------|
| 新文件 | 零警告，全量通过 |
| 已修改 | 警告数持平或下降 |
| 未触碰 | 不检查 |

这意味着你不需要在第一天修完所有历史债务，只要保证"每次修改都比原来好"。

### 7. 模型选择：国产多厂家交叉

Delphi 评审的 3 位专家必须来自**至少 2 家不同厂家**，避免单一模型的系统性盲区：

| 专家 | 推荐模型 | 备选 |
|------|---------|------|
| Expert A (架构) | deepseek-v4-pro | qwen3.6-plus |
| Expert B (技术) | kimi-k2.6 | deepseek-v4-pro |
| Expert C (可行性) | qwen3.6-plus | kimi-k2.6 |

### 8. 经验沉淀：/learn

每个 Sprint 结束后调用 `/learn` 总结经验教训。XP-Gate 会分类存储（permanent / contextual），在后续 REQ 中自动传递——**同样的坑只踩一次**。

---

## 配置说明

### .principlesrc（原则检查配置）

```json
{
  "long-function-threshold": 50,
  "god-class-threshold": 15,
  "deep-nesting-threshold": 4,
  "max-parameters": 4,
  "complexity-threshold": 10,
  "magic-numbers-whitelist": [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024],
  "coverage-threshold": 80,
  "max-exports": 10
}
```

### architecture.yaml（架构规则）

```yaml
rules:
  - id: ARCH-001
    name: 层边界检查
    description: 禁止跨层直接调用
    severity: error
  - id: ARCH-002
    name: 依赖方向检查
    description: 内层不依赖外层
    severity: error
```

### .delphi-config.json（Delphi 评审配置）

```json
{
  "experts": [
    {
      "id": "A",
      "role": "architecture",
      "model": "deepseek-v4-pro"
    },
    {
      "id": "B",
      "role": "implementation",
      "model": "kimi-k2.6"
    }
  ],
  "consensus_threshold": 0.90,
  "max_rounds": 5,
  "timeout": 3600
}
```

### .mutation-critical-paths（关键路径配置）

```json
{
  "criticalPaths": ["src/core/", "src/handlers/"],
  "threshold": 80
}
```

### 变异测试命令

```bash
# 初始化本地 baseline（全量扫描，首次启用时）
npm run mutation:baseline:init

# 增量推送时触发 Gate M
git push

# 查看增量变异报告
npm run mutation:incremental -- --changed-files "src/foo.ts,src/bar.ts"
```

---

## 贡献指南

### 开发设置

```bash
# 安装依赖
npm install

# 设置 Git Hooks（必须）— 安装 hooks + adapter 基础设施
bash githooks/install.sh --force

# 验证安装完整性
bash githooks/verify.sh
```

### 提交规范

1. **所有提交必须通过 10 道 pre-commit 门禁 (Gate 0-9)**
2. **禁止** 使用 `--no-verify` 跳过门禁
3. 每次推送最多 **20 个文件** 或 **500 行代码**
4. 修改的文件警告数必须 **持平或下降**（童子军规则）

### 代码风格

- 使用 TypeScript 严格模式
- **禁止** `as any`、`@ts-ignore`、`@ts-expect-error`
- **禁止** 空 catch 块
- 使用 `logging` 而非 `print()`

### 测试规范

```typescript
/**
 * @test REQ-XXX 功能名称
 * @intent 验证特定行为
 * @covers AC-XXX-01, AC-XXX-02
 */
describe('Feature', () => {
  it('should do X when Y', () => { ... });
});
```

---

## 许可证

MIT License

Copyright (c) 2024-2025 XP-Gate Contributors

---

## 相关链接

- [Sprint Flow 详细文档](./skills/sprint-flow/SKILL.md)
- [Ralph Loop 构建模式](./skills/ralph-loop/SKILL.md) — Phase 2 默认 REQ 级迭代构建，Token 节约 40-67%
- [Delphi 评审规范](./skills/delphi-review/SKILL.md)
- [测试对齐验证](./skills/test-specification-alignment/SKILL.md)
- [质量门禁守则](./githooks/QUALITY-GATES-CODE-OF-CONDUCT.md)
