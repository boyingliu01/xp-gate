# XGate Architecture

XGate 是一个 AI 驱动的开发工作流工具，通过 6 道质量门禁和多专家 AI 评审，确保每次代码提交都符合高质量标准。

---

## 1. 系统概述

XGate 将确定性质量门禁（纯代码）与 AI 智能评审（多专家共识）结合，形成完整的开发质量保障体系。系统采用分层架构，从底层 Git Hooks 到顶层 Sprint Flow 编排，实现自动化质量管控。

---

## 2. 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Layer 5: Sprint Flow 编排层                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │  THINK   │──│   PLAN   │──│  BUILD   │──│  REVIEW  │──│   SHIP   │      │
│  │brainstorm│  │autoplan  │  │  TDD +   │  │code-walk │  │finishing │      │
│  │   -ing   │  │delphi    │  │blind-review│ │-through  │  │-a-branch │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│         │             │            │            │            │             │
│         ▼             ▼            ▼            ▼            ▼             │
│    Pain Doc    specification.yaml  MVP      browse QA    canary           │
│    Design Doc       MVP v1       v1..vN    test-align    deploy          │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Layer 4: AI Skills (Markdown)                        │
│                                                                              │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐            │
│   │  sprint-flow/   │  │  delphi-review/ │  │test-spec-align/ │            │
│   │   SKILL.md      │  │   SKILL.md      │  │   SKILL.md      │            │
│   │                 │  │                 │  │                 │            │
│   │ 7 Phase Flow    │  │ 2 Expert Modes  │  │ 2 Phase Check   │            │
│   │ Output Contract │  │ Consensus >=91% │  │ Freeze/Unfreeze │            │
│   └─────────────────┘  └─────────────────┘  └─────────────────┘            │
│                                                                              │
│   Skill = Markdown + Output Contract (机器可解析的 JSON Schema)              │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Layer 3: Architecture Validation                        │
│                                                                              │
│   src/architecture/         architecture.yaml          .archlint.yaml      │
│   ├─ version-parser.ts      ├─ layers: []              ├─ rules: []        │
│   └─ __tests__/             ├─ rules: ARCH-001..014    └─ thresholds: {}   │
│                             └─ baseline: {}                                 │
│                                                                              │
│   Clean Architecture: Domain <- Application <- Infrastructure <- Presentation│
│   14 条架构规则 (ARCH-001 至 ARCH-014)                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Layer 2: Principles Checker (TS)                       │
│                                                                              │
│   src/principles/                                                            │
│   ├─ index.ts              CLI Entry, 14 Rules                              │
│   ├─ analyzer.ts           Rule Orchestration Engine                        │
│   ├─ boy-scout.ts          Differential Warning Enforcement                 │
│   ├─ reporter.ts           Console/JSON/SARIF Output                        │
│   │                                                                          │
│   ├─ rules/clean-code/     9 Rules                                          │
│   │   ├─ long-function.ts  ├─ magic-numbers.ts   ├─ god-class.ts           │
│   │   ├─ large-file.ts     ├─ deep-nesting.ts    ├─ unused-imports.ts      │
│   │   ├─ too-many-params.ts├─ missing-error-handling.ts                    │
│   │   └─ code-duplication.ts                                                │
│   │                                                                          │
│   └─ rules/solid/          5 Rules                                          │
│       ├─ srp.ts (单一职责)  ├─ ocp.ts (开闭原则)   ├─ lsp.ts (里氏替换)      │
│       └─ isp.ts (接口隔离)  └─ dip.ts (依赖倒置)                            │
│                                                                              │
│   Output: SARIF 2.1.0 (IDE/CI 集成标准格式)                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Layer 1: Git Hooks (Deterministic)                     │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        pre-commit (6 Gates)                          │   │
│   ├─────────────────────────────────────────────────────────────────────┤   │
│   │ Gate 1 │ Gate 2 │ Gate 3 │ Gate 4 │ Gate 5 │ Gate 6                 │   │
│   │ Code   │ Dup    │ CCN    │Principles│ Tests │Arch +                │   │
│   │ Quality│ Code   │Complexity│Checker │Coverage│Boy Scout             │   │
│   ├────────┴────────┴────────┴──────────┴────────┴──────────────────────┤   │
│   │  adapter-common.sh: detect_project_lang() + route_to_adapter()      │   │
│   │  adapters/*.sh: 12 Language Adapters                                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        pre-push (Code Walkthrough)                   │   │
│   │                                                                      │   │
│   │  Validates .code-walkthrough-result.json (file-based, not CLI)      │   │
│   │  - Max 20 files / 500 LOC per push                                  │   │
│   │  - Verdict: APPROVED + commit match + not expired                   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 分层详解

### 3.1 Layer 1: Git Hooks (确定性层)

#### 3.1.1 pre-commit 钩子

pre-commit 在每次 `git commit` 时自动运行 6 道质量门禁，任何一道失败都会阻止提交。

**6 道门禁**

| Gate | 名称 | 检查内容 | 标准 |
|------|------|----------|------|
| 1 | Code Quality | 静态分析 + Lint + Shell 检查 | 零错误 |
| 2 | Duplicate Code | 重复代码检测 | ≤5% 相似度 |
| 3 | Cyclomatic Complexity | 圈复杂度 | ≤5 警告, ≤10 阻断 |
| 4 | Principles | Clean Code + SOLID | 零错误 |
| 5 | Tests + Coverage | 单元测试 + 覆盖率 | 全部通过 + ≥80% |
| 6 | Architecture + Boy Scout | 层边界 + 童子军规则 | 不违规 + 警告不增 |

**关键文件**

- `githooks/pre-commit` — 6 道门禁主脚本 (1099 行)
- `githooks/adapter-common.sh` — 语言检测与路由 (130 行)

#### 3.1.2 语言适配器模式

`adapter-common.sh` 提供统一的适配器接口：

```bash
# 语言检测
detect_project_lang() {
  # 返回: typescript | python | go | java | kotlin | dart | flutter
  #        swift | cpp | objectivec | shell | powershell
}

# 路由到对应适配器
route_to_adapter() {
  # 参数: static_analysis | lint | tests | coverage
}
```

**12 个语言适配器**

| 语言 | 适配器文件 | 静态分析 | Lint | 测试 | 覆盖率 |
|------|-----------|----------|------|------|--------|
| TypeScript | `adapters/typescript.sh` | tsc | ESLint | jest/vitest | c8 |
| Python | `adapters/python.sh` | mypy | Ruff | pytest | coverage |
| Go | `adapters/go.sh` | go vet | golangci-lint | go test | go cover |
| Java | `adapters/java.sh` | javac | CheckStyle/PMD | JUnit | JaCoCo |
| Kotlin | `adapters/kotlin.sh` | ktlint | detekt | JUnit | — |
| Dart | `adapters/dart.sh` | dart analyze | — | dart test | — |
| Flutter | `adapters/flutter.sh` | flutter analyze | — | flutter test | lcov |
| Swift | `adapters/swift.sh` | — | swiftlint | XCTest | — |
| C++ | `adapters/cpp.sh` | clang-tidy | cppcheck | — | — |
| Objective-C | `adapters/objectivec.sh` | scan-build | oclint | — | — |
| Shell | `adapters/shell.sh` | bash -n | shellcheck | bats | — |
| PowerShell | `adapters/powershell.sh` | — | PSScriptAnalyzer | Pester | — |

#### 3.1.3 pre-push 钩子

pre-push 在 `git push` 前验证代码走查结果：

```bash
# 验证 .code-walkthrough-result.json 文件
# 1. 文件存在性检查
# 2. commit hash 匹配当前 HEAD
# 3. verdict == "APPROVED"
# 4. 未过期 (expires > now)
# 5. 变更大小: max 20 files, max 500 LOC
```

**设计原则**: Hook 只验证结果文件，不直接调用 Skill。Skill 的执行在 Agent 会话中完成，通过文件传递结果。

---

### 3.2 Layer 2: Principles Checker (TypeScript)

Principles Checker 是一个独立的 TypeScript 项目，实现 14 条代码规范检查规则。

#### 3.2.1 核心组件

| 文件 | 职责 |
|------|------|
| `src/principles/index.ts` | CLI 入口，解析参数，输出结果 |
| `src/principles/analyzer.ts` | 规则编排引擎，协调所有规则执行 |
| `src/principles/reporter.ts` | 多格式输出: Console / JSON / SARIF 2.1.0 |
| `src/principles/config.ts` | `.principlesrc` 配置文件加载 |
| `src/principles/boy-scout.ts` | 童子军规则: 差分警告强制执行 |
| `src/principles/baseline.ts` | 历史基线存储 `.warnings-baseline.json` |

#### 3.2.2 规则体系 (14 条)

**Clean Code 规则 (9 条)**

| 规则 | ID | 检查内容 | 默认阈值 |
|------|-----|----------|----------|
| Long Function | `clean-code.long-function` | 函数行数过多 | 50 行 |
| Large File | `clean-code.large-file` | 文件行数过多 | 300 行 |
| Magic Numbers | `clean-code.magic-numbers` | 魔术数字 | 白名单: 0,1,-1,2,10,100... |
| God Class | `clean-code.god-class` | 上帝类 | 15 个方法 |
| Deep Nesting | `clean-code.deep-nesting` | 深层嵌套 | 4 层 |
| Too Many Params | `clean-code.too-many-params` | 参数过多 | 4 个 |
| Missing Error Handling | `clean-code.missing-error-handling` | 缺少错误处理 | — |
| Unused Imports | `clean-code.unused-imports` | 未使用导入 | — |
| Code Duplication | `clean-code.code-duplication` | 代码重复 | — |

**SOLID 规则 (5 条)**

| 规则 | ID | 检查内容 |
|------|-----|----------|
| SRP | `solid.srp` | 单一职责原则 |
| OCP | `solid.ocp` | 开闭原则 |
| LSP | `solid.lsp` | 里氏替换原则 |
| ISP | `solid.isp` | 接口隔离原则 |
| DIP | `solid.dip` | 依赖倒置原则 |

#### 3.2.3 语言适配器 (9 种)

`src/principles/adapters/` 目录包含 9 种语言的 AST 解析适配器：

| 适配器 | 技术 | 说明 |
|--------|------|------|
| `typescript.ts` | ast-grep + TypeScript AST | 完整 AST 支持 |
| `python.ts` | ast-grep | Python 语法树解析 |
| `go.ts` | ast-grep | Go 语法树解析 |
| `java.ts` | ast-grep | Java 语法树解析 |
| `kotlin.ts` | ast-grep | Kotlin 语法树解析 |
| `dart.ts` | ast-grep | Dart 语法树解析 |
| `swift.ts` | ast-grep | Swift 语法树解析 |
| `cpp.ts` | Regex | C++ 正则提取 (无完整 AST) |
| `objectivec.ts` | Regex | Objective-C 正则提取 |

#### 3.2.4 童子军规则 (Boy Scout Rule)

```
首次提交: 自动从当前 violations 创建基线
后续提交: 修改的文件警告数必须下降或持平
新文件:   零容忍 (任何警告都会阻止提交)
≤5 警告:  必须清零
```

---

### 3.3 Layer 3: Architecture Validation

架构验证层确保代码遵循 Clean Architecture 分层边界。

#### 3.3.1 核心文件

| 文件 | 用途 |
|------|------|
| `architecture.yaml` | 架构规则定义 (分层、依赖方向、规则集) |
| `.archlint.yaml` | 项目级架构配置覆盖 |
| `.architecture-baseline.json` | 历史项目基线 (渐进式采用) |

#### 3.3.2 分层定义

```yaml
layers:
  domain:          # 核心领域层
    pattern: "src/domain/**"
    allowedImports: ["src/shared/**"]
    forbiddenImports: ["src/infrastructure/**", "src/application/**"]
    
  application:     # 应用服务层
    pattern: "src/application/**"
    allowedImports: ["src/domain/**", "src/shared/**"]
    forbiddenImports: ["src/infrastructure/**"]
    
  infrastructure:  # 基础设施层
    pattern: "src/infrastructure/**"
    allowedImports: ["src/application/**", "src/domain/**", "src/shared/**"]
    
  presentation:    # 表示层
    pattern: "src/presentation/**"
    allowedImports: ["src/application/**", "src/domain/**", "src/shared/**"]
```

#### 3.3.3 14 条架构规则

| 规则 | 名称 | 说明 | 默认启用 |
|------|------|------|----------|
| ARCH-001 | Domain Isolation | 领域层不得导入外层 | 是 |
| ARCH-002 | Application Boundary | 应用层不得导入基础设施/表示层 | 是 |
| ARCH-003 | Presentation Boundary | 表示层不得直接导入领域层 | 是 |
| ARCH-004 | Infrastructure Boundary | 基础设施层不得导入表示层 | 是 |
| ARCH-005 | Cross-layer Cycles | 禁止跨层循环依赖 | 是 |
| ARCH-006 | Within-layer Cycles | 禁止同层循环依赖 | 否 |
| ARCH-007 | Module-level Cycles | 禁止模块间循环依赖 | 否 |
| ARCH-008 | Repository Location | 仓库接口在领域层，实现在基础设施层 | 是 |
| ARCH-009 | Service Location | 领域服务必须在领域层 | 是 |
| ARCH-010 | Controller Location | 控制器必须在表示层 | 是 |
| ARCH-011 | LCOM Threshold | 方法内聚缺乏度阈值 | 否 |
| ARCH-012 | CBO Threshold | 对象间耦合度阈值 | 否 |
| ARCH-013 | Fan-out Threshold | 出度阈值 | 否 |
| ARCH-014 | Fan-in Threshold | 入度阈值 | 否 |

#### 3.3.4 语言特定工具

| 语言 | 工具 | 安装命令 |
|------|------|----------|
| TypeScript | @archlinter/cli | `npm install -g @archlinter/cli` |
| Python | import-linter | `pip install import-linter` |
| Go | arch-go | `go install github.com/arch-go/arch-go@latest` |
| Java | ArchUnit | Maven/Gradle 依赖 |

---

### 3.4 Layer 4: AI Skills (Markdown)

Skills 是以 Markdown 形式定义的 AI 工作流，包含机器可解析的 Output Contract。

#### 3.4.1 Skill 结构

```markdown
---
name: skill-name
description: Skill 描述
triggers:
  - "触发词1"
  - "触发词2"
---

# Skill Title

## 核心原则
...

## Output Format (MANDATORY)
```json
{
  "skill_name": "skill-name",
  "status": "...",
  "...": "..."
}
```
```

#### 3.4.2 核心 Skills

**sprint-flow/SKILL.md** — Sprint 流程编排器

```yaml
7 Phases:
  Phase 0: THINK      → brainstorming → Pain Document + Design Document
  Phase 1: PLAN       → autoplan + delphi-review → specification.yaml
  Phase 2: BUILD      → TDD + freeze + blind-review → MVP v1
  Phase 3: REVIEW     → code-walkthrough + test-alignment + browse
  Phase 4: USER ACCEPTANCE → 必须人工验收
  Phase 5: FEEDBACK   → learn + retro + systematic-debugging
  Phase 6: SHIP       → finishing-a-development-branch + deploy + canary
```

**delphi-review/SKILL.md** — 多专家共识评审

```yaml
Modes:
  design:            # 设计评审
    - 需求/设计/架构/PR 评审
    - 输出: 共识报告 + specification.yaml
    
  code-walkthrough:  # 代码走查
    - 变更代码评审
    - 输出: .code-walkthrough-result.json

Experts: 2-3 位来自不同提供商的模型
Consensus: >=91% 一致性
Rounds: 多轮直到 APPROVED 或达到 max_rounds
```

**test-specification-alignment/SKILL.md** — 测试与需求对齐

```yaml
Phase 1 (可修改):
  - 解析 specification.yaml
  - 解析测试文件 AST
  - 验证对齐规则
  - 可选: 修复测试
  - Checkpoint: Alignment Score >= 80%

Phase 2 (禁止修改):
  - freeze skill 锁定测试目录
  - 执行所有测试
  - 失败分析: 业务代码/测试数据/Specification/环境
  - unfreeze skill 解锁
```

---

### 3.5 Layer 5: Sprint Flow 编排层

Sprint Flow 是整个系统的顶层编排器，串联所有组件完成从需求到部署的完整流程。

#### 3.5.1 7 阶段流程

```
用户输入: /sprint-flow "开发用户登录功能"
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Phase 0: THINK                                           │
│ Skill: brainstorming                                     │
│ Output: Pain Document + Design Document                  │
│ Pause: 等待用户 APPROVED (HARD-GATE)                     │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Phase 1: PLAN                                            │
│ Skills: autoplan → delphi-review                         │
│ Output: specification.yaml                               │
│ Pause: 如有 taste_decisions 暂停确认                     │
│        delphi-review 未 APPROVED 需修复                  │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Phase 2: BUILD                                           │
│ Skills: dispatching-parallel-agents + TDD + freeze +     │
│         requesting-code-review + verification            │
│ Output: MVP v1                                           │
│ Constraint: 验证失败超过 3 次 BLOCK                      │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Phase 3: REVIEW                                          │
│ Skills: delphi-review --mode code-walkthrough            │
│         test-specification-alignment + browse            │
│ Output: Review Report + QA Report                        │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Phase 4: USER ACCEPTANCE (MUST 人工)                     │
│ Output: Emergent Issues List                             │
│ Pause: 必须人工验收，不可自动化                          │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Phase 5: FEEDBACK                                        │
│ Skills: learn + retro + systematic-debugging             │
│ Output: Feedback Log + Sprint 2 Pain Doc (如有)          │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Phase 6: SHIP                                            │
│ Skills: finishing-a-development-branch + ship/land-and-deploy│
│         + canary                                         │
│ Output: Deployed Release + Sprint Summary                │
└─────────────────────────────────────────────────────────┘
```

#### 3.5.2 暂停点设计

| 暂停位置 | 触发条件 | 用户操作 |
|----------|----------|----------|
| Phase 0 | 设计未 APPROVED | 修改设计直到通过 |
| Phase 1 | autoplan 发现 taste_decisions | 确认每个决策 |
| Phase 1 | delphi-review REQUEST_CHANGES | 修复并重新评审 |
| Phase 2 | 验证失败超过 max 3 | 决定修复或放弃 |
| Phase 4 | 必须人工验收 | 实际使用后确认 |
| Phase 6 | finishing-a-development-branch | 选择 4 选项之一 |

---

## 4. 数据流

### 4.1 完整数据流

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  用户需求   │────▶│  Pain Doc   │────▶│ Design Doc  │────▶│specification│
│  /sprint-flow│     │   (MD)      │     │   (MD)      │     │   .yaml     │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                    │
                                                                    ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Production │◀────│   Canary    │◀────│   Deploy    │◀────│     PR      │
│   System    │     │  Monitoring │     │   (ship)    │     │  (land-and- │
│             │     │             │     │             │     │  deploy)    │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                    │
                                                                    ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Sprint 2    │◀────│   Ship      │◀────│   User      │◀────│   browse    │
│  (if needed)│     │  Summary    │     │ Acceptance  │     │    QA       │
│             │     │             │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                                    │
                                                                    ▼
                                                           ┌─────────────┐
                                                           │ delphi-review│
                                                           │ code-walkthru│
                                                           │ test-align   │
                                                           └─────────────┘
                                                                    │
                                                                    ▼
                                                           ┌─────────────┐
                                                           │ MVP v1..vN  │
                                                           │ (TDD + blind │
                                                           │  review)     │
                                                           └─────────────┘
```

### 4.2 Git Hooks 数据流

```
git commit
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│ pre-commit hook                                          │
│  ├─ detect_project_lang() → 识别项目语言                 │
│  ├─ route_to_adapter() → 加载语言适配器                  │
│  │                                                         │
│  ├─ Gate 1: Code Quality                                 │
│  │   └─ adapter.run_static_analysis()                    │
│  │   └─ adapter.run_lint()                               │
│  ├─ Gate 2: Duplicate Code → jscpd                       │
│  ├─ Gate 3: Complexity → lizard                          │
│  ├─ Gate 4: Principles → principles/index.ts             │
│  ├─ Gate 5: Tests + Coverage → adapter                   │
│  └─ Gate 6: Architecture + Boy Scout                     │
│      ├─ archlint / import-linter / arch-go               │
│      └─ boy-scout.ts (differential check)                │
│                                                         │
│  └─ generate_quality_report() → quality-report.json      │
└──────────────────────────────────────────────────────────┘
    │
    ▼
[PASS] → Commit created
[FAIL] → Commit blocked


git push
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│ pre-push hook                                            │
│  ├─ Check file count <= 20                               │
│  ├─ Check LOC <= 500                                     │
│  ├─ Validate .code-walkthrough-result.json exists        │
│  ├─ Validate commit matches HEAD                         │
│  ├─ Validate verdict == "APPROVED"                       │
│  └─ Validate not expired                                 │
└──────────────────────────────────────────────────────────┘
    │
    ▼
[PASS] → Push allowed
[FAIL] → Push blocked
```

---

## 5. 配置文件

### 5.1 质量门禁配置

| 文件 | 用途 | 位置 |
|------|------|------|
| `.principlesrc` | Principles Checker 阈值覆盖 | 项目根目录 |
| `architecture.yaml` | 架构分层规则定义 | 项目根目录 |
| `.archlint.yaml` | 架构检查配置 | 项目根目录 |
| `.architecture-baseline.json` | 架构违规历史基线 | 项目根目录 |
| `.warnings-baseline.json` | 童子军规则警告基线 | 项目根目录 |
| `.architecture-skip` | 跳过架构检查标记 | 项目根目录 |

### 5.2 AI Skills 配置

| 文件 | 用途 | 位置 |
|------|------|------|
| `.delphi-config.json` | Delphi Review 模型配置 | 项目根目录 |
| `specification.yaml` | 需求规格说明 (自动生成) | 项目根目录 |
| `.sprint-state/` | Sprint Flow 状态目录 | 项目根目录 |
| `.code-walkthrough-result.json` | 代码走查结果 | 项目根目录 |

### 5.3 示例配置

**.principlesrc**

```json
{
  "rules": {
    "clean-code": {
      "long-function": { "threshold": 50 },
      "god-class": { "threshold": 15 },
      "deep-nesting": { "threshold": 4 }
    },
    "solid": {
      "srp": { "methodThreshold": 15 }
    }
  }
}
```

**.delphi-config.json**

```json
{
  "experts": [
    { "id": "A", "name": "架构专家", "model": "deepseek-v4-pro" },
    { "id": "B", "name": "技术专家", "model": "kimi-k2.6" }
  ],
  "consensus_threshold": 0.91,
  "max_rounds": 5
}
```

**package.json 脚本**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src --ext .ts",
    "principles": "npx tsx src/principles/index.ts"
  }
}
```

---

## 6. 适配器模式详解

### 6.1 设计动机

XGate 需要支持 12 种编程语言，每种语言有不同的工具链。适配器模式将语言特定的复杂性封装在独立模块中，使主流程保持简洁。

### 6.2 适配器接口

每个适配器必须实现 4 个标准函数：

```bash
# adapters/{lang}.sh

run_static_analysis() {
  # 执行静态分析 (类型检查、语法检查等)
  # 返回: 退出码 0=成功, 非0=失败
}

run_lint() {
  # 执行代码风格检查
  # 返回: 退出码 0=成功, 非0=失败
}

run_tests() {
  # 执行单元测试
  # 返回: 退出码 0=全部通过, 非0=有失败
}

run_coverage() {
  # 执行覆盖率检查
  # 返回: 退出码 0=达到阈值, 非0=未达标
}
```

### 6.3 适配器注册表

```
adapter-common.sh
├── detect_project_lang()      # 语言检测
├── route_to_adapter()         # 路由分发
└── check_if_tool_available()  # 工具可用性检查

adapters/
├── typescript.sh   # TS/JS 项目
├── python.sh       # Python 项目
├── go.sh           # Go 项目
├── java.sh         # Java/Maven/Gradle
├── kotlin.sh       # Kotlin 项目
├── dart.sh         # Dart 项目
├── flutter.sh      # Flutter 项目 (extends dart)
├── swift.sh        # Swift/iOS 项目
├── cpp.sh          # C++ 项目
├── objectivec.sh   # Objective-C 项目
├── shell.sh        # Shell 脚本项目
└── powershell.sh   # PowerShell 项目
```

### 6.4 子目录项目支持

pre-commit 钩子支持混合/嵌套项目结构：

```
root/
├── docs/                    # 纯文档
├── scripts/                 # 工具脚本
├── frontend/                # TypeScript 子项目
│   ├── package.json
│   └── tsconfig.json
└── backend/                 # Python 子项目
    ├── pyproject.toml
    └── src/
```

检测逻辑：
1. 先在根目录查找项目标识文件
2. 未找到则在子目录 (max depth 2) 搜索
3. 发现子目录项目后，`cd` 进入该目录执行门禁

---

## 7. 设计决策

### 7.1 为什么 6 道门禁 (从 9 道简化)

原始设计有 9 道门禁，经过重构合并为 6 道：

| 原门禁 | 新门禁 | 合并理由 |
|--------|--------|----------|
| Gate 1 (Static) + Gate 2 (Lint) + Gate 5 (Shell) | Gate 1 (Code Quality) | 都是静态代码分析，按语言统一处理 |
| Gate 3 (Tests) + Gate 4 (Coverage) | Gate 5 (Tests + Coverage) | 测试和覆盖率紧密相关，适配器统一提供 |
| Gate 8 (Boy Scout) + Gate 9 (Architecture) | Gate 6 (Architecture + Boy Scout) | 都属于代码长期健康度检查 |
| Gate 6 (Principles) | Gate 4 (Principles) | 独立保留，14 条规则需要专门检查 |
| Gate 7 (Complexity) | Gate 3 (Complexity) | 独立保留，圈复杂度是核心指标 |
| — | Gate 2 (Duplicate Code) | 新增门禁，代码重复检测 |

**简化收益**:
- 减少用户认知负担
- 适配器可以更完整地封装语言工具链
- 保持检查完整性不降低

### 7.2 为什么使用 Delphi 方法

Delphi 方法 (兰德公司开发) 相比单一 AI 评审有显著优势：

| 特性 | 单一 AI | Delphi 多专家 |
|------|---------|---------------|
| 偏见避免 | 容易受训练数据偏见影响 | 匿名评审避免锚定效应 |
| 覆盖度 | 单点视角 | 多维度交叉验证 |
| 一致性 | 波动较大 | >=91% 统计共识 |
| 置信度 | 主观判断 | 量化的 confidence 评分 |

**关键设计**:
- 至少 2 位来自不同提供商的专家
- 多轮迭代直到共识
- 零容忍: Critical/Major 问题必须全部处理

### 7.3 为什么区分 Phase 1/Phase 2 (Test Alignment)

Test-Specification Alignment 的两阶段设计解决了一个核心矛盾：

**矛盾**: 测试既需要灵活调整以反映需求变化，又需要在验证时保持稳定不可篡改。

**解决方案**:
```
Phase 1 (Align):  可修改测试 ← 测试是"活的"，随需求演进
Phase 2 (Execute): 禁止修改 ← 测试是"防护网"，确保实现正确
```

**freeze/unfreeze 机制**:
- Phase 2 开始前调用 `/freeze` 锁定测试目录
- Agent 的任何 Edit/Write 尝试都会被拦截
- Phase 2 结束后调用 `/unfreeze` 解锁

### 7.4 为什么必须人工验收 (Phase 4)

研究表明，78% 的软件缺陷在用户实际使用后才被发现 (Emergent Requirements)。自动测试和 AI 评审无法替代真实用户场景。

**设计原则**: Phase 4 是唯一的强制人工环节，不可自动化、不可跳过。

### 7.5 为什么使用 Markdown 定义 Skills

| 方案 | 优点 | 缺点 |
|------|------|------|
| 可执行代码 | 运行时直接调用 | 版本兼容性、安全沙箱复杂 |
| JSON 配置 | 机器友好 | 人类编写困难，表达能力弱 |
| **Markdown** | 人类可读 + 机器可解析 | 需要解析器 |

**Output Contract**: 每个 SKILL.md 包含机器可解析的 JSON Schema，使 Agent 能够验证输出格式。

---

## 8. 扩展性设计

### 8.1 添加新语言支持

1. 创建 `githooks/adapters/{lang}.sh`
2. 实现 4 个标准函数
3. 在 `adapter-common.sh` 的 `detect_project_lang()` 中添加检测逻辑
4. (可选) 创建 `src/principles/adapters/{lang}.ts` 用于 Principles Checker

### 8.2 添加新规则

1. 在 `src/principles/rules/` 下创建规则文件
2. 实现 `Rule` 接口
3. 在 `src/principles/index.ts` 的 `getAllRules()` 中注册

### 8.3 添加新 Skill

1. 创建 `skills/{skill-name}/SKILL.md`
2. 定义触发词、核心原则、工作流程
3. 包含 Output Contract (JSON Schema)
4. 在 sprint-flow 中引用 (如适用)

---

## 9. 总结

XGate 通过 5 层架构实现了从代码提交到部署发布的全流程质量保障：

1. **Git Hooks 层** — 确定性质量门禁，每次提交必检
2. **Principles Checker** — 14 条代码规范，9 语言支持
3. **Architecture Validation** — Clean Architecture 分层边界验证
4. **AI Skills** — 多专家共识评审，测试与需求对齐
5. **Sprint Flow** — 一键编排完整开发流程

分层设计使各组件可独立使用、独立演化，同时通过标准化接口实现无缝集成。
