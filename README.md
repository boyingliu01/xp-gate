# XP-Gate

> **AI 写 100 行代码只需 5 秒，但判断这 100 行对不对仍然要人工花 30 分钟。XP-Gate 把这 30 分钟压缩回秒级。**
>
> 三个机器驱动的反馈环，实现极限编程在 AI 时代的速度。

[![Delphi](https://img.shields.io/badge/AI%20Review-Delphi%20≥90%25-blue)](./skills/delphi-review)
[![Sprint Flow](https://img.shields.io/badge/Sprint%20Flow-6%20Phases-purple)](./skills/sprint-flow)
[![npm package](https://img.shields.io/badge/npm%20registry-npm%20install%20--g%20%40boyingliu01%2Fxp--gate-blue?logo=npm)](src/npm-package)

---

## 目录

1. [为什么是极限编程](#为什么是极限编程)
2. [三个反馈环](#三个反馈环)
3. [快速开始](#快速开始)
4. [Sprint Flow 全流程](#sprint-flow-全流程)
5. [质量门禁详解](#质量门禁详解)
6. [Delphi 多专家评审](#delphi-多专家评审)
7. [语言支持](#语言支持)
8. [AI 技能集成](#ai-技能集成)
9. [配置说明](#配置说明)
10. [贡献指南](#贡献指南)

---

## 为什么是极限编程

1999 年，Kent Beck 在《Extreme Programming Explained》中描述了 12 个极限编程实践。这本书的核心洞见不是"结对编程"或"持续集成"这些具体做法，而是一个更根本的观察：

> **软件开发中最大的成本不是写代码，而是返工。返工的根本原因不是程序员不够聪明，而是反馈太慢。**

传统的反馈周期以**天**为单位（写完代码 → Code Review → QA 测试 → 返工）。极限编程试图把反馈压缩到**分钟**级 — 每次改动都有单元测试告知对错，每轮迭代都有客户验证方向。

AI 辅助编程把这个问题彻底改变了。AI 写完一段代码的速度是**秒级**，但反馈速度仍然以人审阅代码的速度运行 — **分钟级甚至小时级**。反馈循环的瓶颈从"写代码"转移到了"判断代码对不对"。

**XP-Gate 解决的就是这个问题：在 AI 生成代码的速度和人类验证代码的速度之间，构建三个机器驱动的反馈环。**

---

## 三个反馈环

极限编程认为反馈是质量的根本来源。XP-Gate 用三个层层递进的反馈环把这个理念自动化：

```
┌──────────────────────────────────────────────────────────────────┐
│                        三个反馈环                                  │
├──────────────┬──────────────────────┬────────────────────────────┤
│   环 1        │   环 2               │   环 3                      │
│   代码层      │   需求层              │   迭代层                    │
├──────────────┼──────────────────────┼────────────────────────────┤
│ 代码          │ 需求 ↔ 测试           │ 规划 ↔ 复盘                  │
│ ↔ 测试        │                      │                            │
│ ↔ 静态检查    │                      │                            │
├──────────────┼──────────────────────┼────────────────────────────┤
│ 确定性        │ 确定性 + Delphi 评审  │ 数据驱动的                    │
│ 秒级反馈      │ 分钟级反馈 (2 次提交)  │ 迭代级反馈 (每 Sprint)        │
│ 约 90% 闭合   │ 约 80% 闭合           │ 约 55% 闭合                  │
└──────────────┴──────────────────────┴────────────────────────────┘
```

### 环 1：代码层 — "这行代码写得对吗？"

提交代码时自动触发，秒级反馈。**纯确定性规则，零 AI 参与。**

- **Gate 1**: Lint — 代码风格一致
- **Gate 2**: 重复代码 — 不重复造轮子
- **Gate 3**: 圈复杂度 — 逻辑不过度复杂
- **Gate 4**: Clean Code + SOLID — 14 条确定性规则
- **Gate 5**: 单元测试 + 覆盖率 + 文件配对 — 测试写了且写对了
- **Gate 6**: 架构合规 — 不破坏分层
- **Gate 7**: IaC 安全扫描 — 基础设施即代码的漏洞
- **Gate 8**: 密钥扫描 — 不泄露密钥
- **Gate 9**: 构建完整性 — TypeScript 编译、打包、import 检查
- **Gate 10**: SAST 安全扫描 — 代码层安全漏洞

这个环闭合了约 90%。目标：100%。

### 环 2：需求层 — "这段代码做对了吗？"

需求写成测试，测试约束代码。分两步：

**第一步（AI 参与）：Delphi 多专家匿名评审**

3 位不同厂家的国产模型匿名评审需求和设计，必须 ≥90% 一致才能通过。这一步在**写代码之前**完成，回答"需求是否合理"。基于 RAND 公司 1950 年代开发的 Delphi 方法论，消除锚定效应和单一视角盲区。

**第二步（确定性）：`test-alignment` 引擎**

提交时自动运行，纯 TypeScript 代码：parse `specification.yaml` → parse `@test REQ-XXX` 注解 → 交叉验证每个需求是否有对应的测试，每个验收条件是否有断言。回答"测试是否真的覆盖了需求"。

> **为什么必须有第二步？** Delphi 评审保证需求的质量，但无法保证代码真的实现了需求。AI 可能误读 spec，可能漏写断言，可能让测试通过但语义不对。`test-alignment` 引擎用确定性代码捕捉这个断层。

这个环闭合了约 80%。剩余 20% 缺口：`parseTestFiles()` 中 template literal 测试名称和 `.each()` 变体的正则匹配，见 `src/npm-package/lib/__tests__/test-alignment.test.ts`。

### 环 3：迭代层 — "我们是不是在越做越好？"

一个 Sprint 产生的数据驱动下一个 Sprint 的决策。

- **Boy Scout Rule**：每次修改，警告数不能增加。这是环 3 的微观实现 — 代码质量只进不退。
- **retro 数据**：每个 Sprint 结束时的复盘数据（rework rate, evidence skip 次数, 质量趋势）自动注入下一个 Sprint 的初始化参数。
- **evidence_schema_version=2**：新 Sprint 默认启用严格证据验证，让环 2 的输出真正约束环 3。

这个环闭合了约 55%。剩余缺口：环 3 的数据产量够了，但**自动驱动**下一个 Sprint 的机制还不完善。

---

## 快速开始

XP-Gate 由 **两个互补的发行渠道** 组成，建议同时安装：

### 第一步：安装 npm 包（必需 — Git Hooks + 全流程基础设施）

**前置条件**：Node.js ≥18.x、Git ≥2.38、bash（Linux/macOS 自带，Windows 需 [Git Bash](https://git-scm.com/download/win)）。

```bash
npm install -g @boyingliu01/xp-gate
cd your-project
xp-gate init
```

npm 包提供：
- **Git Hooks**（pre-commit 12 道门禁 + pre-push 8 道门禁）— 每次提交/推送自动执行
- **CLI 管理命令**（doctor, baseline, audit, check-alignment 等 20+ 子命令）
- **Skill 下载器**（`xp-gate install-skill` 按版本下载 SKILL.md）

### 第二步：安装 IDE 插件（推荐 — AI 对话内质量工具 + 技能自动加载）

**Qoder 插件**（推荐）：`xp-gate init` 自动检测并部署 Delphi 评审所需的 3 个 Custom Agent，直接消耗 Qoder Credits，无需外部 API。

**OpenCode 插件**：
```json
{ "plugin": ["@boyingliu01/opencode-plugin"] }
```

**Claude Code 插件**：
```bash
/plugin install boyingliu01/xp-gate
```

IDE 插件提供 AI 对话内的质量工具（`gate-check`、`gate-principles`、`gate-arch`）和技能自动加载。不提供 Git Hooks（AI 平台限制）。

> **npm 包 = git enforcement，IDE 插件 = IDE 集成。两者互补，缺一不可。**

### xp-gate CLI 命令速查

| 命令 | 说明 |
|------|------|
| `xp-gate init` | 初始化项目，安装 hooks + adapters |
| `xp-gate doctor [--fix]` | 诊断/自动修复安装状态 |
| `xp-gate bootstrap [--dry-run]` | 一键安装 jscpd, lizard, checkov, gitleaks, semgrep |
| `xp-gate baseline <create\|show\|reset\|diff>` | 管理 lint 基线 |
| `xp-gate check-alignment` | **环 2 核心命令** — 运行需求↔测试对齐检查 |
| `xp-gate check <path>` | 运行 Gate 4 + Gate 6 |
| `xp-gate principles <path>` | 运行 Clean Code + SOLID 检查 (Gate 4) |
| `xp-gate arch` | 运行架构合规检查 (Gate 6) |
| `xp-gate sprint-status [--json] [--watch]` | 查看 Sprint Flow 进度 |
| `xp-gate retro [--days N] [--json]` | 生成工程复盘报告 |
| `xp-gate audit [--tail \| --stats \| record]` | 查看/记录 gate 审计日志 |
| `xp-gate install-skill <name>` | 从 GitHub 下载 Skill |
| `xp-gate uninstall [--dry-run]` | 完整卸载 xp-gate |
| `xp-gate migrate` | v0.4.x → 清理残留配置 |
| `xp-gate --version` | 查看版本 |

---

### 遗留安装路径（仓库直接克隆）

```bash
git clone https://github.com/boyingliu01/xp-gate.git && cd xp-gate
bash githooks/install.sh
bash githooks/verify.sh
```

---

## Sprint Flow 全流程

极限编程的迭代周期映射到 AI 驱动的 6 阶段流水线：

```
Phase 1       Phase 2       Phase 3       Phase 4       Phase 5       Phase 6
PREP     →    DESIGN   →    BUILD    →    VERIFY   →    SHIP     →    CLOSE
   │             │             │             │             │             │
   ▼             ▼             ▼             ▼             ▼             ▼
worktree      grill-with    ralph-loop    code-walk     PR + merge     UAT +
+ sizing      -docs → R1    + TDD         + QA + retro  + deploy       cleanup
              → batch-      + test-align  + learn       + canary
              grill-me
              → R2 delphi
              (HARD-GATE)
```

> v0.18.0+：Phase 2 DESIGN 使用 grill-with-docs（需求梳理）→ batch-grill-me（批量决策）→ delphi-review 多轮评审。旧版文档中提及的 brainstorming/autoplan 是 v0.17.x 及之前的 Phase 2 流程。

| 阶段 | 名称 | 关键动作 | 对应反馈环 |
|------|------|---------|-----------|
| 1/6 | PREP | worktree 隔离 + 规模评估 | — |
| 2/6 | DESIGN | grill-with-docs → R1 requirements → batch-grill-me → R2 delphi-review (HARD-GATE ≥90% 共识) | 环 2（需求评审） |
| 3/6 | BUILD | ralph-loop (默认) + TDD + test-alignment | 环 1（代码质量） + 环 2（测试对齐） |
| 4/6 | VERIFY | code-walkthrough + QA + benchmark + retro + learn | 环 1（质量验证） + 环 3（复盘数据） |
| 5/6 | SHIP | PR + merge + deploy + canary | — |
| 6/6 | CLOSE | 人工验收 + emergent issues + 清理 | 环 3（Iteration 闭环） |

### 使用方式

```bash
# 启动完整 Sprint
/sprint-flow "开发用户登录功能，支持 OAuth2"

# 指定技术栈
/sprint-flow "开发用户登录" --type web-nextjs --lang typescript

# 查看当前 Sprint 进度
xp-gate sprint-status --watch
```

---

## 质量门禁详解

每次 `git commit` 自动执行 12 道门禁 (Gate 0-11)，每次 `git push` 自动执行 8 道门禁：

### Pre-commit（12 道门禁）

| 门禁 | 检查内容 | 失败行为 |
|------|---------|---------|
| Gate 0 | 版本一致性 (VERSION vs package.json) | 阻断 |
| Gate 1 | 代码质量 (ESLint/Ruff/gofmt 等) | 阻断 |
| Gate 2 | 重复代码 (jscpd, ≤5% 相似度) | 阻断 |
| Gate 3 | 圈复杂度 (lizard, ≤5 警告, ≤10 阻断) | 警告/阻断 |
| Gate 4 | Clean Code + SOLID (14 条规则 × 9 语言) | 阻断 |
| Gate 5 | 单元测试 + 覆盖率 (≥80%) + 文件配对 (新 .ts/.tsx 必须有测试) | 阻断 |
| Gate 6 | 架构合规 + 童子军规则 (修改文件警告数不能增加) | 阻断 |
| Gate 7 | IaC 安全扫描 (checkov/hadolint/kube-score/tflint) | 阻断 |
| Gate 8 | 密钥扫描 (gitleaks) | 阻断 |
| Gate 9 | 构建完整性 (tsc + npm pack + import check) | 阻断 |
| Gate 10 | SAST 安全扫描 (semgrep) | 阻断 |
| Gate 11 | Sprint Flow 执行 + 文件卫生 | 阻断 |

### Pre-push（8 道门禁）

| 门禁 | 检查内容 | 失败行为 |
|------|---------|---------|
| Gate 10 | 构建完整性 (推送到远程前的最后编译检查) | 阻断 |
| Gate M | 增量变异测试 (Stryker, TS, 默认 60%/关键路径 80%) | 阻断 |
| Gate M-Python/Go/Java/Kotlin | 多语言变异测试（按项目语言自动选择） | 阻断 |
| Gate M2 (Mock Density) | Mock 密度扫描 (≤30% 或带 `@mock-justified`) — **警告，不阻断** | 警告 |
| Gate ML (Mock Layering) | Mock 分层策略 | 阻断 |
| Gate UI | UI Sprint 质量门禁 (UI 相关变更时) | 阻断 |
| Gate MW | 代码走查 (`.code-walkthrough-result.json` 必须存在且未过期) | 阻断 |
| Gate S | Sprint Flow 执行 | 阻断 |

> **Pre-push 大小限制已移除**：AI 工作流产生大体积累积推送，文件数量不是质量信号。预推送门禁强制执行突变、模拟和代码走查，但不限制推送大小。

> **设计原则：工具不可用 = SKIP，不阻断。** 某语言的工具装不上，该语言的检查自动跳过，不影响其他语言。
> **`--no-verify` 严格禁止。** 绕过门禁等于放弃反馈环。

---

## Delphi 多专家评审

作为**环 2 的第一步**，Delphi 评审在写代码之前就验证需求和设计。基于 RAND 公司 1950 年代开发的 Delphi 方法论：

### 为什么是 Delphi？

传统 AI 评审是 n=1 — 一个模型对一段信息做出判断。但单个模型有系统性盲区：DeepSeek 对某些领域偏保守，Kimi 可能过度乐观，Qwen 可能在特定场景误判。

Delphi 方法论解决这个问题的核心设计：

- **匿名性**：3 位专家互不知晓对方的判断，消除锚定效应
- **迭代性**：多轮评审直到共识，每轮能看到上一轮的统计结果但不知道谁说了什么
- **统计共识**：≥90% 一致才算通过，不靠多数票

### 三种模式

| 模式 | 触发时机 | 输入 | 输出 |
|------|---------|------|------|
| `requirements` | Phase 2 DESIGN 之后 | specification.yaml | `requirements-reviewed.json` |
| `design` | 架构/方案设计 | 设计文档 | 评审报告 |
| `code-walkthrough` | Phase 4 VERIFY（pre-push 时） | 代码 diff | `.code-walkthrough-result.json` |

### 与 `test-alignment` 的关系

Delphi 评审回答**"需求写得好不好"**，`test-alignment` 引擎回答**"代码有没有按需求实现"**。两者是互补的，不是互相替代的：

```
specification.yaml
       │
       ├── Delphi Review ──► "需求质量、完整性、可行性"
       │
       └── test-alignment ──► "测试是否覆盖每个需求、每个验收条件"
```

### 模型选择（强制国产 + 多厂家交叉）

模型配置通过 `.delphi-config.json` 管理，推荐使用国产模型（如 DeepSeek、Qwen、GLM、Kimi、MiniMax 等）。**三个专家必须来自至少 2 家不同厂家**，避免单一模型的系统性盲区。具体模型名称以你的服务商 API 文档为准，配置示例见下方[配置说明](#配置说明)。

---

## 语言支持

XP-Gate 支持 **12 种语言** + IaC，通过适配器自动检测和路由：

| 语言 | 适配器 | 静态分析 | 测试框架 | 复杂度 |
|------|--------|---------|---------|--------|
| TypeScript | `adapter-typescript.sh` | ESLint | Jest/Vitest | lizard |
| Python | `adapter-python.sh` | Ruff/Black | pytest | lizard |
| Go | `adapter-go.sh` | gofmt/govet | go test | lizard |
| Java | `adapter-java.sh` | Checkstyle | JUnit | lizard |
| Kotlin | `adapter-kotlin.sh` | ktlint | JUnit | lizard |
| C++ | `adapter-cpp.sh` | clang-tidy | GoogleTest | lizard |
| Swift | `adapter-swift.sh` | swiftlint | XCTest | lizard |
| Objective-C | `adapter-objc.sh` | oclint | XCTest | lizard |
| Shell | `adapter-shell.sh` | shellcheck | bats | lizard |
| Dart | `adapter-dart.sh` | dart analyze | dart test | lizard |
| Flutter | `adapter-flutter.sh` | flutter analyze | flutter test | lizard |
| PowerShell | `adapter-powershell.sh` | PSScriptAnalyzer | Pester | lizard |
| IaC | `adapter-iac.sh` | checkov/hadolint/kube-score/tflint | N/A | N/A |

> \* 所有编程语言统一使用 [lizard](https://github.com/terryyin/lizard) 进行圈复杂度分析。

---

## AI 技能集成

XP-Gate 内置 12 个专业 AI 技能，另在 Sprint Flow 中集成了多个外部技能。以下按 Sprint Flow 阶段排列：

| 技能 | 来源 | 用途 | 触发时机 |
|------|------|------|---------|
| delphi-review | 内置 | 多专家匿名共识评审 | Phase 2, 4 |
| sprint-flow | 内置 | 6 阶段全流程编排 | — |
| ralph-loop | 内置 | REQ 级迭代构建（默认模式） | Phase 3 |
| test-driven-development | 内置 | RED → GREEN → REFACTOR 循环 | Phase 3 |
| test-specification-alignment | 内置 | 测试对齐验证 | Phase 3, 4 |
| to-issues | 内置 | 垂直切片 Issue 拆分 | Phase 2 |
| improve-codebase-architecture | 内置 | 架构健康检查 | 定期 |
| verify-before-completion | 内置 | 变更完成前验证 | Phase 4 |
| requesting-code-review | 内置 | 代码评审请求 | Phase 4 |
| receiving-code-review | 内置 | 处理评审反馈 | Phase 4 |
| systematic-debugging | 内置 | 根因调试 | Phase 3-5 |
| brainstorming | 内置 | 需求探索、方案设计 | Phase 2 |
| qa | 外部 (gstack) | Web QA 测试 | Phase 4 |
| design-review | 外部 (gstack) | 视觉审计 | Phase 4 |
| benchmark | 外部 (gstack) | 性能基准 | Phase 4 |
| retro | 外部 (gstack) | 工程复盘 | Phase 4 |
| learn | 外部 (gstack) | 经验教训总结 | Phase 4 |
| cso | 外部 (gstack) | 安全审计 | 定期/发布前 |

> 内置技能通过 `xp-gate install-skill <name>` 安装。外部技能由 Sprint Flow 工作流自动调用，无需单独安装。

---

## 配置说明

### .principlesrc（原则检查配置）

在项目根目录创建，Gate 4 读取此文件：

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

### architecture.yaml（架构规则，共 14 条规则 ARCH-001 至 ARCH-014）

在项目根目录创建，Gate 6 读取此文件。示例：

```yaml
rules:
  - id: ARCH-001
    name: 层边界检查
    description: 禁止跨层直接调用
    severity: error
  - id: ARCH-002
    name: 依赖方向检查
    description: 禁止反向依赖（内层不依赖外层）
    severity: error
```

完整规则列表见项目根目录的 `architecture.yaml`。

### .delphi-config.json（Delphi 评审配置）

在项目根目录创建，定义评审专家和共识参数。模型名称以你的服务商 API 文档为准：

```json
{
  "experts": [
    { "id": "A", "role": "architecture", "model": "deepseek/deepseek-chat" },
    { "id": "B", "role": "implementation", "model": "bailian/qwen-plus" },
    { "id": "C", "role": "feasibility", "model": "zhipu/glm-4" }
  ],
  "consensus_threshold": 0.90,
  "max_rounds": 5
}
```

> 配置示例包含 3 位专家、2 家不同厂家（deepseek + bailian + zhipu），满足跨厂家要求。2 专家配置（默认）适用于代码变更和简单设计评审。

---

## 贡献指南

### 开发设置

```bash
npm install
bash githooks/install.sh --force
bash githooks/verify.sh
```

### 提交规范

- 所有提交必须通过 pre-commit 门禁
- 禁止 `--no-verify`
- 禁止 `as any`、`@ts-ignore`、空 catch 块
- 修改文件的警告数持平或下降（童子军规则）
- Pre-push 大小限制已移除 — AI 工作流产生大体积累积推送，数量不是质量信号

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

MIT License. Copyright (c) 2024-2026 XP-Gate Contributors.

---

## 相关链接

- [三个反馈环设计文档](./docs/plans/2026-07-28-feedback-loop-2-redesign.md) — 反馈环 2 重构的完整设计
- [Sprint Flow 详细文档](./skills/sprint-flow/SKILL.md)
- [Delphi 评审规范](./skills/delphi-review/SKILL.md)
- [测试对齐验证](./skills/test-specification-alignment/SKILL.md)
- [质量门禁守则](./githooks/QUALITY-GATES-CODE-OF-CONDUCT.md)
