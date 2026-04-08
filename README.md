# XP Workflow Automation for OpenCode

## 项目概述

### 项目名称
**XP Workflow Automation** - 极限编程工作流自动化引擎

### 版本
V1.0.0

### 项目目标

将 **XP (Extreme Programming) 的 12 个核心实践实例化并固化到 OpenCode 环境中**，实现 AI 自主执行的软件开发工作流，最小化人的参与，同时保证软件质量。

### 核心设计原则

| 原则 | 说明 |
|------|------|
| **减少 human-in-the-loop** | 人是瓶颈，AI 应自主执行 |
| **AI 自主结对** | 大模型自己结对、自己纠正错误 |
| **人的角色最小化** | 只提出原始需求 + 确认原始方案 |
| **零容忍原则** | 所有发现的问题必须处理，不遗漏到后续阶段 |
| **零降级原则** | 环境/资源问题必须阻断并通知用户，禁止自动降级 |

### ⚠️ 质量优先原则 (不可妥协)

**问题发现越早，修复成本越低。** 这是软件工程的核心经济规律：

| 发现阶段 | 修复成本 | 说明 |
|---------|---------|------|
| 需求阶段 | 1x | 修改文档即可 |
| 设计阶段 | 5x | 修改设计文档 |
| 编码阶段 | 10x | 修改代码 + 测试 |
| 测试阶段 | 20x | 修改代码 + 测试 + 回归测试 |
| 发布后 | 100x+ | 紧急修复 + 用户影响 + 信任损失 |

**前期投入是值得的：**

1. **多轮评审不是浪费** — Delphi Review 的多轮迭代确保方案可行，避免后期返工
2. **质量检查不是官僚主义** — Gate 1/2/3 的自动化检查是质量保障，不是流程负担
3. **Token 消耗不是成本** — 相比后期修复的巨大成本，前期的 token 消耗是微不足道的投资

**评审的终点是 APPROVED，不是"完成评审"：**

```
❌ WRONG: 评审 → 发现问题 → 记录问题 → "评审完成"
   问题：问题未修复，方案不可行

✅ CORRECT: 评审 → 发现问题 → 修复问题 → 重新评审 → APPROVED → "评审完成"
   结果：得到可行方案
```

**这些原则必须固化到门禁中，不能作为"建议"或"提示"。**

---

## XP 12 实践覆盖情况

### 实践覆盖矩阵

| # | XP 实践 | 覆盖状态 | 实现方式 | Skill/工具 |
|---|---------|----------|----------|------------|
| 1 | **Planning Game** | ✅ 覆盖 | 需求探索 + 方案评审 | `brainstorming` + `delphi-review` |
| 2 | **Small Releases** | ✅ 覆盖 | 频繁发布 + 持续集成 | `gstack-ship` + `gstack-land-and-deploy` |
| 3 | **System Metaphor** | ⚠️ 部分 | 架构隐喻 | 架构决策记录 |
| 4 | **Simple Design** | ✅ 覆盖 | 设计评审 | `design-consultation` + `plan-design-review` |
| 5 | **Test-Driven Development** | ✅ 覆盖 | 测试驱动 + 对齐验证 | `tdd-workflow` + `test-specification-alignment` |
| 6 | **Pair Programming** | ✅ 覆盖 | AI 结对编程 | `xp-consensus` (Driver + Navigator) |
| 7 | **Continuous Integration** | ✅ 覆盖 | Git hooks + 自动测试 | `pre-commit` + `pre-push` |
| 8 | **Collective Code Ownership** | ✅ 覆盖 | 多模型代码走查 | `code-walkthrough` (Delphi) |
| 9 | **On-site Customer** | ⚠️ 部分 | 用户确认点 | 方案评审时的用户决策 |
| 10 | **Sustainable Pace** | ✅ 覆盖 | 成本控制 | `xp-consensus` 成本阈值 |
| 11 | **Coding Standards** | ✅ 覆盖 | 代码规范 + 静态检查 | `coding-standards` + `pre-commit` |
| 12 | **Refactoring** | ✅ 覆盖 | 重构优化 | `refactor-cleaner` |

### 覆盖统计

| 状态 | 数量 | 占比 |
|------|------|------|
| ✅ 完整覆盖 | 10 | 83% |
| ⚠️ 部分覆盖 | 2 | 17% |
| ❌ 未覆盖 | 0 | 0% |

---

## 核心架构

### ⚠️ 重要说明：单次迭代 vs 完整 XP 流程

**本文档描述的是单次迭代的工作流。**

XP (Extreme Programming) 的核心是**短迭代循环**，完整 XP 流程包含：

```
┌─────────────────────────────────────────────────────────────┐
│                   完整 XP 流程 (多迭代)                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 迭代规划 (Iteration Planning)                        │    │
│  │ • 选择本次迭代要完成的用户故事                        │    │
│  │ • 估算故事点数                                        │    │
│  │ • 确定迭代目标                                        │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 单次迭代 (本文档描述的内容)                           │    │
│  │ • 需求探索 → 方案评审 → 实现 → 测试 → 发布           │    │
│  │ • 迭代周期：1-2 周                                    │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 迭代回顾 (Retrospective)                             │    │
│  │ • 回顾本次迭代的成果和问题                            │    │
│  │ • 调整流程和估算                                      │    │
│  │ • 使用 gstack-retro skill 自动生成回顾报告           │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│                    下一轮迭代                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**迭代回顾 Skill**: `gstack-retro` 用于自动化迭代回顾，分析：
- 本次迭代完成的用户故事
- 代码质量指标
- 成本消耗
- 下次迭代的改进建议

---

### 整体架构图 (单次迭代)

```
┌─────────────────────────────────────────────────────────────┐
│                   Human Role (最小化)                        │
│   提出原始需求 → 确认原始方案 → 处理 escalations              │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                  AI Autonomous Layer                         │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │     Phase 1: Requirements & Design                  │    │
│  │                                                      │    │
│  │  brainstorming (需求探索)                            │    │
│  │         │                                            │    │
│  │         ▼                                            │    │
│  │  delphi-review (方案评审 - 多专家共识)               │    │
│  │         │                                            │    │
│  │         ▼                                            │    │
│  │  plan-ceo-review / plan-eng-review (方案细化)        │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │     Phase 2: Implementation (TDD)                   │    │
│  │                                                      │    │
│  │  xp-consensus (Driver + Navigator + Arbiter)        │    │
│  │  ├─ Round 1: Driver AI 生成代码 + 测试              │    │
│  │  ├─ Round 2: Navigator AI 盲评 + 验证               │    │
│  │  └─ Round 3: Arbiter AI 决策冲突                    │    │
│  │         │                                            │    │
│  │         ▼                                            │    │
│  │  test-specification-alignment                        │    │
│  │  ├─ Phase 1: 验证测试与需求对齐                      │    │
│  │  └─ Phase 2: 执行测试 (freeze 锁定测试目录)          │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │     Phase 3: Quality Gates                          │    │
│  │                                                      │    │
│  │  Gate 1: Static Analysis (pre-commit hook)          │    │
│  │  ├─ tsc / Ruff / golangci-lint                      │    │
│  │  ├─ ESLint / mypy                                   │    │
│  │  └─ Tests + Coverage                                │    │
│  │                                                      │    │
│  │  Gate 2: Code Walkthrough (pre-push hook)           │    │
│  │  └─ code-walkthrough (Delphi 多模型评审)             │    │
│  │                                                      │    │
│  │  Gate 3: Security Scan                              │    │
│  │  └─ gstack-cso / security-review                    │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │     Phase 4: Release                                │    │
│  │                                                      │    │
│  │  gstack-ship (发布)                                  │    │
│  │  gstack-land-and-deploy (部署)                       │    │
│  │  canary (监控)                                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                    Output to Human                           │
│  完成报告 + 变更清单 + 测试结果 + 成本报告 + 安全扫描结果     │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心组件详解

### 1. delphi-review Skill

**目的**: 多轮匿名评审直到专家达成共识

**核心特性**:
- 匿名性 — Round 1 专家互不知道对方意见
- 迭代数据收集 — 多轮直到共识
- 参与者反馈 — 每轮看到其他专家意见
- 统计共识 — >=91% 一致才算共识

**触发条件**:
- 需求文档评审
- 设计方案评审
- 代码 PR 评审

---

### 2. xp-consensus Skill

**目的**: AI 结对编程 — Driver + Navigator 双阶段评审

**核心流程**:
```
Round 1: Driver AI (TDD Cycle)
├─ 输入: 需求 + 上下文
├─ 🔴 RED: 先写测试（预期失败）
│   └─ 测试定义期望行为，因实现不存在而失败
├─ 🟢 GREEN: 再写实现代码
│   └─ 写最少代码使测试通过
├─ 🔄 REFACTOR: 重构优化（可选）
│   └─ 保持测试通过
└─ 输出: sealed{code, decisions} + public{tests, results}

Round 2 Phase 1: Navigator 盲评 (oracle agent)
├─ 输入: requirements + testCases + testResults
├─ ⚠️ sealed.code 不可访问（盲评约束）
└─ 输出: checkList

Round 2 Phase 2: Navigator 验证 (oracle agent)
├─ 输入: code (解锁) + checkList
└─ 输出: verdict + confidence

Gate 1: Pre-Arbiter Static Analysis
├─ TypeScript strict + ESLint + Test execution
├─ 失败: 自动修复 (max 3) → 回退 Round 1
└─ 通过: 进入 Arbiter

Round 3: Arbiter AI (oracle agent)
├─ 输入: Driver output + Navigator verdict + Gate 1 result
├─ 置信度阈值: ≥8 APPROVE, <6 REQUEST_CHANGES
└─ 输出: APPROVED / REQUEST_CHANGES / ESCALATE_TO_HUMAN
```

**TDD 说明**:
Driver AI 必须严格遵循 TDD 流程（见 `xp-consensus/references/driver-prompt.md`）：
1. **RED**: 先写测试，定义期望行为，测试应该失败
2. **GREEN**: 写最少代码使测试通过
3. **REFACTOR**: 重构代码，保持测试通过

**Agent 配置**:

| 角色 | Agent | 模型 | Skills |
|------|-------|------|--------|
| Driver | `build` | GLM-5 | coding-standards, tdd-workflow |
| Navigator Phase 1 | `oracle` | MiniMax M2.5 | review |
| Navigator Phase 2 | `oracle` | MiniMax M2.5 | review, security-review |
| Arbiter | `oracle` | GLM-5 | - |

---

### Sealed Code 隔离机制

**Navigator Phase 1 的盲评通过 prompt 输入隔离实现。**

#### 隔离原理

```
Navigator Phase 1 输入:
  ✅ requirements (原始需求)
  ✅ testCases (测试用例列表)
  ✅ testResults (测试执行结果)
  
  ❌ sealed.code (实现代码 - 不可访问)
  ❌ sealed.designDecisions (设计决策 - 不可访问)
```

#### 实现方式

**方式 1: Prompt 输入隔离（当前实现）**

在构建 Navigator Phase 1 的 prompt 时，只传递 `public` 部分（测试相关），不传递 `sealed` 部分（代码相关）。

```
Driver 输出:
  sealed: { code, designDecisions }  ← 不传递给 Navigator Phase 1
  public: { tests, results }          ← 传递给 Navigator Phase 1
```

Navigator Phase 1 的 prompt 明确约束（见 `xp-consensus/references/navigator-phase1-prompt.md`）：
```
## ⚠️ 核心约束：盲评

**你不能看到 Driver 的实现代码！**

你只能看到：
- requirements（原始需求）
- testCases（测试用例列表）
- testResults（测试执行结果）

你不能看到：
- code（实现代码）
- designDecisions（设计决策）
```

**方式 2: freeze skill 锁定（备选方案）**

如果需要更强的技术保障，可以使用 `freeze` skill 锁定代码文件：
```
Round 1 完成后:
  → freeze --target="src/**/*.ts" --exclude="**/*.test.ts"
  → Navigator Phase 1 尝试读取代码 → ACCESS_DENIED
  → Round 2 Phase 1 完成后 → unfreeze
```

#### 与 test-specification-alignment 的 freeze 区分

| 场景 | 目的 | 机制 | Skill |
|------|------|------|-------|
| xp-consensus Navigator 盲评 | 防止 Navigator 看到 Driver 代码 | Prompt 输入隔离 | 无需 freeze |
| test-specification-alignment Phase 2 | 防止修改测试代码 | 文件系统锁定 | freeze skill |

**这是两个不同的隔离场景，不要混淆。**

---

### 3. code-walkthrough Skill

**目的**: Post-commit 多模型代码走查

**核心流程**:
```
git push
    │
    ▼
pre-push hook
    ├─ 获取 git diff main...HEAD
    ├─ 提取变更摘要
    └─ 触发 Delphi 评审
          │
          ├─ Expert A (Qwen3.5-Plus) 匿名评审
          ├─ Expert B (MiniMax M2.5) 匿名评审
          ├─ 共识检查
          │      ├─ 2/2 APPROVED → 允许推送
          │      ├─ 分歧 → Expert C 仲裁
          │      └─ REQUEST_CHANGES → 阻塞推送
          └─ 返回结果
    │
    └─ 允许/阻塞推送
```

**评审维度**:
- 正确性 — 逻辑是否正确，边界条件是否处理
- 安全性 — 是否有注入、泄露、越权风险
- 可维护性 — 命名、结构、注释是否清晰
- 测试覆盖 — 是否有足够的测试

---

### 4. test-specification-alignment Skill

**目的**: 确保测试准确反映需求和设计

**两阶段执行**:

```
Phase 1: 验证测试与 Specification 对齐 (可修改测试)
├─ 输入: Requirements + Design Docs + Test Code
├─ 验证: 每个 test case 是否正确反映 specification
├─ 输出: Alignment Report + (可选) 修改后的测试
└─ 约束: ✅ 可以修改测试代码

Checkpoint: Alignment Score >= 80%?

Phase 2: 执行测试 (禁止修改测试)
├─ 输入: Aligned Tests + Business Code
├─ ⭐ Pre-Phase 2: 调用 freeze skill 锁定测试目录
├─ 执行: 运行所有测试
├─ 失败处理: 只能修改业务代码
├─ 约束: ❌ 绝对禁止修改测试代码
│        ❌ 绝对禁止删除测试代码
├─ ⭐ Post-Phase 2: 调用 unfreeze skill 解锁测试目录
└─ 输出: Pass Report 或 Fix Required
```

**结构化 Specification 格式**:
```yaml
specification:
  id: "SPEC-XXX-001"
  name: "模块名称"
  version: "1.0.0"
  
  requirements:
    - id: "REQ-XXX-001"
      description: "需求描述"
      acceptance_criteria:
        - id: "AC-XXX-001-01"
          given: "前置条件"
          when: "触发动作"
          then: "期望结果"
      edge_cases:
        - "边界条件1"
```

---

### 5. Git Hooks

#### pre-commit Hook

**Gate 1: Static Analysis (MANDATORY)**
- TypeScript: `tsc --noEmit` + `ESLint`
- Python: `ruff check` (100x faster than Flake8) + `mypy`
- Go: `golangci-lint run`

**Gate 2: Linting**

**Gate 3: Unit Tests (MANDATORY)**

**Gate 4: Coverage (MANDATORY)**

**零容忍原则**: 工具不存在 → BLOCK + 通知用户安装

#### pre-push Hook

**检查项**:
1. OpenCode CLI 可用性
2. code-walkthrough skill 可用性
3. 变更大小 (文件 ≤20, 行数 ≤500)
4. 触发 Delphi 代码走查

**零容忍原则**: 任何能力缺失 → BLOCK + 通知用户

---

## Delphi 方法应用

### 四大核心特性

| 特性 | 实现 |
|------|------|
| **匿名性** | Round 1 专家互不知道对方意见 |
| **迭代数据收集** | 多轮直到共识，不是固定轮数 |
| **参与者反馈** | 每轮看到其他专家意见 |
| **统计共识** | >=91% 问题共识比例 |

### 评审流程

```
Round 1: 匿名独立评审
├─ Expert A ──→ 评审 A (不知道 B 意见)
└─ Expert B ──→ 评审 B (不知道 A 意见)

共识检查
├─ 裁决一致? ──→ YES: 进入下一阶段
└─ NO: Round 2

Round 2: 交换意见
├─ Expert A 看到 B 的评审
└─ Expert B 看到 A 的评审

共识检查
├─ 一致? ──→ YES: 完成
└─ NO: Round 3 / Arbiter

最终裁决
├─ APPROVED → 继续
└─ REQUEST_CHANGES → 修复 → 重新评审
```

---

## 成本控制

| 指标 | 阈值 | 处理 |
|------|------|------|
| 单次 Delphi 评审 | ~$0.02 | 正常执行 |
| 单次 xp-consensus | ~$0.04 | 正常执行 |
| 单任务阈值 | $0.15 | BLOCK + 用户决定 |
| 日阈值 | $1.00 | BLOCK + 用户决定 |

---

## 安全机制

### 零容忍原则

| 场景 | 当前行为 | 期望行为 |
|------|---------|---------|
| 工具不存在 | ⚠️ 跳过 | ❌ **BLOCK + 通知用户** |
| 测试失败 | ⚠️ 跳过 | ❌ **BLOCK + 修复业务代码** |
| 模型不可用 | ⚠️ 降级 | ❌ **BLOCK + 通知用户** |
| 成本超阈值 | ⚠️ 降级 | ❌ **BLOCK + 用户决定** |

### Phase 2 freeze 约束

```yaml
Phase 2 开始前:
  └─ 调用 freeze skill 锁定测试目录

Phase 2 执行中:
  └─ Agent 尝试修改测试 → freeze 拦截 → BLOCKED_ERROR

Phase 2 结束后:
  └─ 调用 unfreeze skill 解锁测试目录
```

---

## 与 OpenCode 集成

### 触发机制

| Skill | 自动触发条件 |
|-------|-------------|
| `delphi-review` | 需求文档提交、设计方案提交、PR 创建 |
| `xp-consensus` | 用户请求实现功能 |
| `code-walkthrough` | git push (pre-push hook) |
| `test-specification-alignment` | xp-consensus Round 1 后、Gate 1 前 |

### Agent 配置

OpenCode 支持的 Agent 类型:
- `build` — 代码实现
- `oracle` — 只读咨询
- `explore` — 代码探索
- `librarian` — 文档检索

---

## 使用指南

### 快速开始

1. **安装 Skills**
   ```bash
   # 将 skills/ 目录复制到 OpenCode 配置目录
   cp -r skills/* ~/.config/opencode/skills/
   ```

2. **安装 Git Hooks**
   ```bash
   # 将 githooks/ 复制到项目 .git/hooks/
   cp githooks/pre-commit .git/hooks/
   cp githooks/pre-push .git/hooks/
   chmod +x .git/hooks/pre-commit .git/hooks/pre-push
   ```

3. **安装工具**
   ```bash
   # Python
   pip install ruff mypy pytest pytest-cov
   
   # TypeScript
   npm install -D typescript eslint jest
   
   # Go
   go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
   ```

4. **创建 Specification**
   ```bash
   # 在项目根目录创建 specification.yaml
   # 参考 skills/test-specification-alignment/references/specification-format.md
   ```

### 工作流示例

```bash
# 1. 用户提出需求
User: "实现用户登录功能"

# 2. AI 自动触发 brainstorming + delphi-review
# 3. 方案达成共识后，触发 xp-consensus
# 4. Driver AI 生成代码 + 测试
# 5. Navigator AI 盲评 + 验证
# 6. test-specification-alignment 验证测试对齐
# 7. Gate 1: pre-commit 检查
# 8. Arbiter 裁决
# 9. Gate 2: pre-push 代码走查
# 10. 发布
```

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| V1.0.0 | 2026-04-07 | 初始版本，完成 XP 12 实践覆盖 |
| V1.1.0 | 2026-04-07 | Delphi Review 通过，修复 C1/C2/C3，质量优先原则固化 |

---

## Delphi Review 状态

**最终裁决**: ✅ APPROVED (Round 3)

**共识报告**: 见 `docs/delphi-consensus-report-final.md`

---

## 许可证

MIT License