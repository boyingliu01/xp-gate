# XGate

> **AI 驱动开发工作流工具：6 道质量门禁 + Delphi 多专家评审 + Sprint Flow 全流程编排**

[![Git Hooks](https://img.shields.io/badge/Git%20Hooks-6%20Gates-green)](./githooks)
[![AI Review](https://img.shields.io/badge/AI%20Review-Delphi%20≥91%25-blue)](./skills/delphi-review)
[![Sprint Flow](https://img.shields.io/badge/Sprint%20Flow-Think→Ship-purple)](./skills/sprint-flow)
[![npm](https://img.shields.io/badge/npm-install%20--g%20xgate-blue?logo=npm)](src/npm-package)

---

## 目录

1. [为什么需要 XGate](#为什么需要-xgate)
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

## 为什么需要 XGate

传统开发中，代码质量依赖人工 Code Review，存在以下问题：

| 问题 | 影响 |
|------|------|
| 评审标准不一致 | 不同 reviewer 关注点不同，质量波动大 |
| 锚定效应 | 先发言的人影响后续判断 |
| 遗漏关键问题 | 单人视角有限，复杂逻辑难以全覆盖 |
| 返工成本高 | 问题发现晚，修复成本指数级增长 |

XGate 通过 **确定性门禁 + AI 多专家共识 + 全流程编排** 解决这些问题。

---

## 三大核心模块

```
┌─────────────────────────────────────────────────────────┐
│                      XGate 架构                         │
├─────────────────┬─────────────────┬─────────────────────┤
│   质量门禁      │    AI 评审      │    Sprint Flow      │
│   (确定性)      │   (共识驱动)    │   (流程编排)        │
├─────────────────┼─────────────────┼─────────────────────┤
│ • 6 道门禁      │ • Delphi 方法   │ • 7 阶段流水线      │
│ • 12 语言适配   │ • ≥91% 共识     │ • 硬门槛控制        │
│ • 零容忍策略    │ • 国产模型      │ • 自动并行执行      │
└─────────────────┴─────────────────┴─────────────────────┘
```

### 1. 质量门禁 (Quality Gates)

Git 提交时自动触发，**纯代码逻辑，无 AI 参与**，确保快速可靠。

### 2. AI 评审 (Delphi Review)

多轮匿名专家评审，基于 RAND 公司 Delphi 方法论：
- 匿名性：第一轮专家互不知晓
- 迭代性：多轮直到共识
- 统计共识：≥91% 一致才算通过

### 3. Sprint Flow

一键启动完整开发流水线：
```
THINK → PLAN → BUILD → REVIEW → USER ACCEPT → FEEDBACK → SHIP
```

---

## 快速开始

### 方式零：零安装（推荐 — AI Agent 友好）

```bash
# npm 全局安装（无需 clone 仓库）
npm install -g xgate

# 初始化项目（安装 hooks）
cd your-project
xgate init

# 按需安装 AI 技能
xgate install-skill sprint-flow
xgate install-skill delphi-review
xgate install-skill test-spec
xgate install-skill ralph-loop
```

### 方式一：独立安装（仅门禁）

```bash
# 克隆仓库
git clone https://github.com/boyingliu01/xgate.git
cd xgate

# 安装 Git Hooks（必须）— 安装 hooks + adapter 基础设施
bash githooks/install.sh

# 验证安装
bash githooks/verify.sh

# 可选：安装 npm 依赖（用于 TypeScript 项目）
npm install
```

### 方式二：完整安装（含 AI 技能）

```bash
# 1. 安装基础依赖
npm install

# 2. 配置 Delphi 评审（需要配置模型）
cp skills/delphi-review/.delphi-config.json.example .delphi-config.json
# 编辑 .delphi-config.json，配置你的模型

# 3. 验证安装
npx tsx src/principles/index.ts --help
```

### 推荐：统一安装脚本

```bash
# 一键安装 Git Hooks + adapter 基础设施
bash githooks/install.sh

# 验证安装完整性
bash githooks/verify.sh
```

### 组件化安装脚本（按需）

```bash
# 仅安装 Git Hooks
bash scripts/install-hooks.sh

# 仅安装 AI 技能
bash scripts/install-skills.sh

# 安装全部
bash scripts/install-all.sh
```

### xgate CLI 命令速查

| 命令 | 说明 |
|------|------|
| `xgate init` | 初始化项目，安装 hooks + adapters |
| `xgate install-skill <name>` | 从 GitHub 下载并安装 Skill |
| `xgate update-skill <name>` | 更新已安装的 Skill |
| `xgate uninstall-skill <name> --force` | 卸载 Skill |
| `xgate --version` | 查看版本 |

---

## 语言支持

XGate 支持 **13 种语言** + IaC 文件，通过适配器自动检测和路由：

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
| C | `adapter-c.sh` | clang-tidy | GoogleTest | lizard ✅ |
| Dart | `adapter-dart.sh` | dart analyze | dart test | lizard ✅ |
| Flutter | `adapter-flutter.sh` | flutter analyze | flutter test | lizard ✅ |
| PowerShell | `adapter-powershell.sh` | PSScriptAnalyzer | Pester | lizard ✅ |
| IaC (Terraform/K8s/Docker) | `adapter-iac.sh` | checkov/hadolint/kube-score/tflint | N/A | N/A |

适配器位于 `githooks/adapters/`，自动根据文件扩展名选择。

> **plugins/ 扩展目录**：`githooks/adapters/plugins/` 包含第三方扩展工具（如 alibaba-java/p3c、book299-20132-python 等），可按需安装以增强特定语言检查能力。

---

## Sprint Flow 全流程

```
Phase 0        Phase 1        Phase 2        Phase 3        Phase 4        Phase 5        Phase 6
 THINK    →    PLAN     →    BUILD     →   REVIEW    →  USER ACC   →  FEEDBACK   →   SHIP
  │              │              │              │              │              │             │
  ▼              ▼              ▼              ▼              ▼              ▼             ▼
brainstorm    autoplan    parallel-dev   code-walk     manual        learn +      finishing-
  │           delphi      TDD + review   + QA/web      verification  retro        dev-branch
  │           review      test-align                  (78% bugs     debug        + ship/
  │           spec.yaml     │           benchmark      invisible)                 land
  │                         │
 HARD-GATE ────────────────┘
 (设计未通过 → 禁止编码)
```

### 各阶段说明

| 阶段 | 名称 | 关键动作 | 输出 |
|------|------|---------|------|
| 0 | THINK | brainstorming | 设计文档 |
| 1 | PLAN | autoplan → delphi-review | specification.yaml |
| 2 | BUILD | 并行开发 + TDD | 功能代码 |
| 3 | REVIEW | 代码走查 + 测试对齐 | 评审报告 |
| 4 | USER ACCEPT | 人工验收 | 验收确认 |
| 5 | FEEDBACK | 复盘 + 调试 | 改进建议 |
| 6 | SHIP | 发布 | 上线版本 |

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

每次 `git commit` 自动执行 6 道门禁，每次 `git push` 自动执行 Gate M：

### Pre-commit（6 道门禁）

| 门禁 | 检查内容 | 阈值 | 失败行为 |
|------|---------|------|---------|
| Gate 1 | 代码质量 | 零错误 | 阻断提交 |
| Gate 2 | 重复代码 | ≤5% 相似度 | 阻断提交 |
| Gate 3 | 圈复杂度 | ≤5 警告，≤10 阻断 | 警告/阻断 |
| Gate 4 | Clean Code + SOLID | 零错误 | 阻断提交 |
| Gate 5 | 单元测试 + 覆盖率 | 全部通过 + ≥80% | 阻断提交 |
| Gate 6 | 架构合规 + 童子军规则 | 无新增警告 | 阻断提交 |

### Pre-push（Gate M）

| 门禁 | 检查内容 | 阈值 | 失败行为 |
|------|---------|------|---------|
| Gate M | 变异测试得分 | 默认 60%，关键路径 80% | 阻断推送 |

### Clean Code 规则（9 条）

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
# 打开 http://localhost:3000
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

XGate 集成 15+ 个专业 AI 技能，按 Sprint Flow 阶段排列：

| 技能 | 来源 | 用途 | 触发时机 |
|------|------|------|---------|
| brainstorming | superpowers | 需求探索、方案设计 | Phase 0 |
| autoplan | gstack | CEO/设计/工程自动评审 | Phase 1 |
| delphi-review | xgate | 多专家匿名共识 | Phase 1, 3 |
| ralph-loop | xgate | **REQ 级迭代构建**（Phase 2 **默认模式**），Token 节约 40-67% | Phase 2 |
| test-specification-alignment | xgate | 测试对齐验证 | Phase 2, 3 |
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

根据 XGate 规范，**必须使用国产开源模型**：

| 专家 | 推荐模型 | 备选 |
|------|---------|------|
| Expert A (架构) | deepseek-v4-pro | qwen3.6-plus, glm-5.1 |
| Expert B (技术) | kimi-k2.6 | deepseek-v4-pro, minimax-m2.7 |
| Expert C (可行性) | qwen3.6-plus | kimi-k2.6, glm-5.1 |

**关键原则：** 三个专家必须来自 **至少 2 家不同厂家**。

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
  "consensus_threshold": 0.91,
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

1. **所有提交必须通过 6 道门禁**
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

Copyright (c) 2024-2025 XGate Contributors

---

## 相关链接

- [Sprint Flow 详细文档](./skills/sprint-flow/SKILL.md)
- [Ralph Loop 构建模式](./skills/ralph-loop/SKILL.md) — Phase 2 默认 REQ 级迭代构建，Token 节约 40-67%
- [Delphi 评审规范](./skills/delphi-review/SKILL.md)
- [测试对齐验证](./skills/test-specification-alignment/SKILL.md)
- [质量门禁守则](./githooks/QUALITY-GATES-CODE-OF-CONDUCT.md)
