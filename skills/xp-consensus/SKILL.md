---
name: xp-consensus
description: "XP Pair Programming AI 共识引擎。Driver + Navigator 双阶段评审 + Arbiter 决策树 + Gate 1 集成。MANDATORY before any code implementation. 自动触发：用户提出需求后启动共识流程。TRIGGER: 'implement X', 'build Y', 'create Z', 'add feature', 'refactor', 或用户明确请求共识。"
---

# XP Consensus Engine

## 核心原则

**只有一个目的：得到 Driver + Navigator + Arbiter 一致认可的可行实现方案。**

### 五大特性

1. **盲评 (Blind Review)** — Navigator Phase 1 不能看到 Driver 的代码
2. **迭代验证** — Gate 1 失败自动修复 → 回退 → 重新执行
3. **置信度阈值** — Arbiter confidence ≥8 才可 APPROVE
4. **零容忍** — 所有 Critical Issues 必须在共识前解决
5. **零降级 (Zero Degradation)** — 环境/成本问题必须阻断，通知用户解决

---

## 触发条件

### 自动触发

- 用户提出新需求
- 用户请求实现功能
- 用户请求重构代码
- 用户说 "implement X", "build Y", "create Z"

### 手动触发

- `/xp-consensus` 命令

### ⚠️ 前置条件检查 (MANDATORY)

**在 Round 1 开始前必须检查 specification.yaml 是否存在：**

```
xp-consensus Round 1 开始前
    │
    ├─ 检查 specification.yaml 是否存在
    │      ├─ 存在 → 使用作为 requirements 输入 ✅
    │      └─ 不存在 → BLOCK
    │              → 提示: "先完成需求评审流程"
    │              → 流程: brainstorming → delphi-review → specification-generator
    │
    ▼
Driver AI 输入:
    ├─ requirements: specification.yaml 的 requirements 部分
    ├─ acceptance_criteria: specification.yaml 的 AC 部分
    ├─ design_decisions: specification.yaml 的 DD 部分
```

---

## 输入来源

### specification.yaml 结构

Driver AI 从 `specification.yaml` 解析以下内容：

| 输入字段 | 来源 | 用途 |
|----------|------|------|
| `requirements[].id` | REQ-XXX-XXX | 测试命名依据 |
| `requirements[].description` | 需求描述 | Driver 理解需求 |
| `requirements[].acceptance_criteria` | AC-XXX-XX | 测试断言依据 |
| `requirements[].edge_cases` | 边界条件 | 边界测试生成 |
| `requirements[].security_considerations` | 安全要点 | 安全测试生成 |
| `design_decisions` | DD-XXX | 实现决策依据 |
| `api_contracts` | API 定义 | API 测试生成 |

---

## 核心流程

```
┌─────────────────────────────────────────────────────────────┐
│              XP Consensus Flow (V2.5)                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Round 1: Driver AI (build agent)                           │
│  ├─ 🔴 TDD Phase 1: 先写测试 (RED)                           │
│  ├─ 🟢 TDD Phase 2: 再写代码 (GREEN)                         │
│  ├─ 输入: 需求 + 上下文                                      │
│  └─ 输出: sealed{code, decisions} + public{tests, results}  │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🔒 FREEZE: 锁定 sealed.code                          │    │
│  │    调用 freeze skill 锁定实现文件                     │    │
│  │    Navigator Phase 1 将无法访问                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  Round 2 Phase 1: Navigator 盲评 (oracle agent)             │
│  ├─ 输入: requirements + testCases + testResults            │
│  │          ⚠️ sealed.code 被 freeze 锁定，不可访问          │
│  ├─ 自检: 100% coverage + min 3 edge cases                  │
│  ├─ 输出: checkList                                          │
│  └────────────────────────────────┘                          │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🔓 UNFREEZE: 解锁 sealed.code                        │    │
│  │    调用 unfreeze skill 解锁实现文件                   │    │
│  │    Navigator Phase 2 将可以访问                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  Round 2 Phase 2: Navigator 验证 (oracle agent)             │
│  ├─ 输入: code (解锁) + checkList                            │
│  ├─ 输出: verdict + confidence                               │
│  └────────────────────────────────┘                          │
│                          │                                   │
│                          ▼                                   │
│  Gate 1: Pre-Arbiter Static Analysis                        │
│  ├─ TypeScript strict + ESLint + Test execution             │
│  ├─ 失败: 自动修复 (max 3) → 回退 Round 1                   │
│  └─ 通过: 进入 Arbiter                                       │
│                          │                                   │
│                          ▼                                   │
│  Round 3: Arbiter AI (oracle agent)                         │
│  ├─ 输入: Driver output + Navigator verdict + Gate 1 result │
│  ├─ 置信度阈值: ≥8 APPROVE, <6 REQUEST_CHANGES              │
│  ├─ 输出: APPROVED / REQUEST_CHANGES / ESCALATE_TO_HUMAN    │
│  └────────────────────────────────┘                          │
│                          │                                   │
│              ┌───────────┴───────────┐                       │
│              │                       │                       │
│          APPROVED           REQUEST_CHANGES                  │
│              │                       │                       │
│              ▼                       ▼                       │
│     Gate 2: Security Scan   修复 → 重新共识                  │
│     (gstack-ship 集成)                                      │
│              │                                               │
│              ▼                                               │
│     READY_FOR_RELEASE                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Sealed Code 隔离机制 (MANDATORY)

### 为什么需要隔离？

Navigator Phase 1 的核心是**盲评**——Navigator 不能看到 Driver 的实现代码，只能看到测试和测试结果。这确保：

1. Navigator 独立思考，不受 Driver 实现细节影响
2. Navigator 基于需求和测试生成检查清单，而不是"检查代码是否符合代码"
3. 真正的结对编程效果：独立视角 + 相互验证

### 隔离实现方案

**方案 A: freeze skill 锁定代码文件 (推荐)**

```
Round 1 完成 (Driver 输出 sealed + public)
    │
    ▼
freeze --target="src/**/*.ts" --exclude="**/*.test.ts"
    │   └─ 锁定所有业务代码文件，排除测试文件
    │
    ▼
Round 2 Phase 1: Navigator 盲评
    │   └─ Navigator 尝试读取代码 → freeze 拦截 → ACCESS_DENIED
    │   └─ Navigator 只能访问测试文件
    │
    ▼
Round 2 Phase 1 完成
    │
    ▼
unfreeze --target="src/**/*.ts"
    │   └─ 解锁代码文件
    │
    ▼
Round 2 Phase 2: Navigator 验证 (可以访问代码)
```

**freeze 调用时机**:

| 时机 | 操作 | 目的 |
|------|------|------|
| Round 1 后 | `freeze` | 锁定 sealed.code |
| Round 2 Phase 1 执行中 | 拦截读取 | 防止 Navigator 看到 code |
| Round 2 Phase 1 完成 | `unfreeze` | 允许 Phase 2 访问 |

**方案 B: 独立 Session 隔离**

```
Session A (Driver):
    └─ 生成 sealed + public
    └─ 只将 public 传递给 Session B

Session B (Navigator Phase 1):
    └─ 输入: requirements + testCases + testResults
    └─ ⚠️ 没有 Session A 的 sealed.code 访问权限
    └─ 输出: checkList
```

**当前实现**: 方案 B（独立 Session）

**改进方向**: 方案 A（freeze skill）提供更强的技术保障

### 隔离验证

在 Navigator Phase 1 开始时，系统应该验证：

```yaml
验证项:
  - sealed.code 文件被 freeze 锁定
  - Navigator 无法通过 Read/Edit/Write 访问 sealed.code
  - Navigator 只能访问 public 数据

如果验证失败:
  → BLOCK 共识流程
  → 提示用户：sealed code isolation 未正确配置
```

---

## Agent 配置

| 角色 | Agent | 模型 | Skills |
|------|-------|------|--------|
| Driver | `build` | GLM-5 | coding-standards, tdd-workflow |
| Navigator Phase 1 | `oracle` | MiniMax M2.5 | review |
| Navigator Phase 2 | `oracle` | MiniMax M2.5 | review, security-review |
| Arbiter | `oracle` | GLM-5 | - |

---

## Agent 可用性检查 (MANDATORY)

### 启动前检查

```
BEFORE Round 1:
  ├─ 检查 build agent 可用性
  ├─ 检查 oracle agent 可用性
  ├─ 检查模型 API 连通性 (Qwen3.5-Plus, MiniMax M2.5)
  └─ 检查 Gate 1 工具可用性 (tsc/ESLint/Ruff/golangci-lint)

IF 任何检查失败:
  → BLOCK 共识流程
  → 通知用户具体缺失项
  → 提供修复指引
  → ❌ 禁止跳过检查直接执行
```

### Agent 不可用处理

| 情况 | 处理 |
|------|------|
| build agent 配置错误 | BLOCK + 提示用户检查 config |
| oracle agent 不可用 | BLOCK + 提示用户安装 oracle skill |
| 模型 API 错误 | BLOCK + 提示用户检查 API key/网络 |
| Gate 1 工具缺失 | BLOCK + 提示用户安装工具 |

**设计原则**: 环境问题由用户解决，AI 不能自动跳过或降级。

---

## 状态机 (17 States)

| State | 名称 | 说明 |
|-------|------|------|
| 0 | IDLE | 初始状态 |
| 1 | ROUND1_RUNNING | Driver 执行中 |
| 2 | ROUND1_COMPLETE | sealed + public 输出完成 |
| 3 | ROUND2_PHASE1_RUNNING | Navigator Phase 1 执行中 |
| 4 | ROUND2_PHASE1_COMPLETE | checkList 生成 |
| 5 | ROUND2_PHASE2_RUNNING | Navigator Phase 2 执行中 |
| 6 | ROUND2_PHASE2_COMPLETE | verdict + confidence |
| 7 | GATE1_RUNNING | Static Analysis 执行中 |
| 8 | GATE1_COMPLETE | 通过 |
| 9 | GATE1_FAILED | 失败（触发修复/回退） |
| 10 | ARBITER_RUNNING | Arbiter 执行中 |
| 11 | APPROVED | 共识达成 |
| 12 | REQUEST_CHANGES | 需要修复 |
| 13 | GATE2_RUNNING | Security Scan |
| 14 | GATE2_COMPLETE | 安全检查通过 |
| 15 | READY_FOR_RELEASE | 可发布 |
| 16 | ROLLBACK_TO_ROUND1 | 回退到 Driver |
| 17 | CIRCUIT_BREAKER_TRIGGERED | 熔断 |

---

## 与现有 Skills 集成

### 集成点 1: 共识完成 → verification-loop

Gate 1 内置在共识流程中，但 Gate 1 通过后自动触发 verification-loop 完整流程。

### 集成点 2: Gate 1 通过 → gstack-ship

Gate 2 (Security Scan) 集成到 gstack-ship 流程。

### 集成点 3: 成本超阈值 → BLOCK (零降级原则)

```
IF 成本超阈值 ($0.15 单任务 / $1.00 日):
  → 熔断 → CIRCUIT_BREAKER_TRIGGERED
  → BLOCK consensus → NOT notify user
  → 用户必须决定：继续共识 或 调整预算
  → ❌ 禁止自动降级到单 build agent
```

**设计原则**: 
- 降级 = 跳过共识检查 = 质量风险泄露到后续阶段
- 用户有权决定是否接受风险，AI 不能自动降级

---

## 成本控制

| 阈值 | 值 | 处理 |
|------|-----|------|
| 单次共识 | ~$0.04 | 正常执行 |
| 单任务阈值 | $0.15 | BLOCK + 提示用户决定 |
| 日阈值 | $1.00 | BLOCK + 提示用户决定 |
| 周阈值 | $5.00 | 生成报告 + BLOCK |

**重要**: 成本超阈值时，必须 BLOCK 并通知用户，由用户决定是否继续。
AI 不能自动降级或跳过共识检查。

---

## Prompt Templates

见 `references/` 目录：
- `driver-prompt.md` — Driver AI 指令
- `navigator-phase1-prompt.md` — Navigator 盲评指令
- `navigator-phase2-prompt.md` — Navigator 验证指令
- `arbiter-prompt.md` — Arbiter 决策树
- `state-schema.md` — TypeScript interfaces

---

## Terminal State Checklist

<MANDATORY-CHECKLIST>

### 只能在以下条件全部满足后声明 "xp-consensus complete":

**Pre-requisites:**
- [ ] Round 1 完成: Driver 输出 sealed + public
- [ ] Round 2 Phase 1 完成: Navigator 生成 checkList + 自检通过
- [ ] Round 2 Phase 2 完成: Navigator 输出 verdict + confidence
- [ ] Gate 1 通过: Static Analysis 无 Critical 错误

**CRITICAL - Arbiter 裁决:**
- [ ] Arbiter confidence ≥ 8
- [ ] 裁决是 **APPROVED**

**Final Requirements:**
- [ ] Gate 2 (Security Scan) 通过（如需发布）
- [ ] 成本在阈值内
- [ ] 输出报告生成

**IF 裁决是 REQUEST_CHANGES:**
- **CANNOT claim complete**
- **MUST 修复并重新执行共识**

</MANDATORY-CHECKLIST>

---

## 熔断判定

### 无进展定义

- Issue severity 分布连续 2 轮相同
- Confidence 变化 < 0.5
- 无新发现问题

### 熔断触发

- 连续 2 轮无进展
- 成本超阈值
- Agent 不可用（模型 API 错误、配置错误）

### 熔断处理 (零降级原则)

```
State → CIRCUIT_BREAKER_TRIGGERED

→ BLOCK 共识流程
→ 生成熔断报告（包含原因、当前状态、剩余问题）
→ 通知用户

用户选项:
  A. 继续共识（手动解决环境问题后）
  B. 暂停任务（等待资源/预算）
  C. 用户明确授权跳过共识（需书面确认风险）

❌ 禁止自动降级到单 build agent
❌ 禁止自动跳过共识检查
```

**设计原则**:
- 熔断 = 环境/资源问题 = 需要用户介入
- AI 不能自动决定跳过质量检查
- 降级会把问题泄露到后续阶段

---

## Anti-Patterns

| 错误 | 正确 |
|------|------|
| Round 1 → Navigator → APPROVED（跳过 Gate 1） | Gate 1 必须在 Arbiter 前执行 |
| Navigator Phase 1 可以看到 code | Phase 1 必须盲评，code sealed |
| Arbiter confidence = 6 就 APPROVED | Confidence ≥ 8 才可 APPROVE |
| Gate 1 失败直接报告人 | 自动修复 max 3 次 → 回退 Round 1 |
| 成本无限制 | 成本超阈值 BLOCK + 用户决定 |
| **成本超阈值自动降级** | **BLOCK + 通知用户，由用户决定** |
| **熔断后自动降级到单 agent** | **BLOCK + 通知用户，禁止自动降级** |
| **Agent 不可用时跳过共识** | **BLOCK + 提示用户修复环境** |
| **Gate 1 工具缺失时跳过** | **BLOCK + 提示用户安装工具** |