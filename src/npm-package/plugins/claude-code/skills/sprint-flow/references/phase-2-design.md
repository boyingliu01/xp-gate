# Phase 2/6: DESIGN（设计 — 需求探索 + 共识评审）

**执行时机**: Phase 1/6 PREP 完成后、Phase 3/6 BUILD 之前。
**对应旧模型**: Phase 0 THINK + Phase 1 PLAN

## 目标

使用 brainstorming skill 进行结构化需求探索，输出经用户批准的设计文档。然后通过 autoplan + delphi-review 达成 ≥90% 共识，生成 specification.yaml。

---

## Part A: THINK（需求探索与设计）

### 调用 Skills

- `brainstorming` (superpowers) — **HARD-GATE**: 设计未批准 → 不可进入实现
- 可选补充：`office-hours` (gstack) — 当用户需求非常模糊、需要先验证产品方向时

**关键变更（ISSUE30）**: 从 `office-hours` 切换到 `brainstorming`，原因:
- brainstorming 有 **HARD-GATE**（设计未批准 → 不可进入实现），防止 "觉得已经理解了就直接开始写代码"
- brainstorming 输出结构化设计文档，可直接作为 Phase 2/6 Part B PLAN 的输入
- office-hours 的 YC 六问适合新产品方向验证，brainstorming 更适合"具体功能实现前设计"的场景

### HARD-GATE 机制

```
DO NOT enter Part B (PLAN) or do any implementation
until the brainstorming design has been APPROVED by the user.
```

brainstorming skill 内部会执行：

1. **Explore project context** — 检查文件、文档、最近 commits
2. **Ask clarifying questions** — 一次一个，理解目的/约束/成功标准
3. **Propose approaches** — 2-3 个方案，含 trade-offs 和建议
4. **Present design** — 分节展示，每节获得用户批准
5. **Write design doc** — 保存到 `docs/plans/YYYY-MM-DD-<topic>-design.md`
6. **Transition to implementation** — brainstorming 自动调用 writing-plans

**sprint-flow 编排层行为**:
- 收到 brainstorming APPROVED 设计文档后，自动进入 Part B
- 如果 brainstorming 未完成（用户未 APPROVED），BLOCK 并等待

### 执行步骤

#### Step 1: 调用 brainstorming skill

```
skill(name="brainstorming", user_message="[需求描述]")
```

#### Step 2: 等待 HARD-GATE APPROVED

```
⚠️ HARD-GATE: 设计未 APPROVED → 不可进入 Part B

等待用户审批 brainstorming 输出的设计文档。
```

#### Step 3: 保存设计文档路径

保存到 `<project-root>/.sprint-state/phase-outputs/design-doc.md`

### 可选补充: office-hours（方向验证）

当用户输入非常模糊时（如 "我想做一个 AI 工具" 而不是 "开发用户登录功能"），可以先调用 `office-hours` 验证产品方向，再进入 brainstorming 详细设计。

### 暂停点

| 暂停点 | 触发条件 | 用户操作 | 自动恢复条件 |
|--------|---------|---------|-------------|
| **HARD-GATE** | brainstorming 设计未 APPROVED | 用户审批设计文档 | 设计 APPROVED 后自动进入 Part B |

### 输出

- Design Document (`docs/plans/YYYY-MM-DD-<topic>-design.md`)
- Implementation Plan（brainstorming 内部 writing-plans 输出）
- 进入 Part B 自动执行（使用设计文档作为输入）

---

## Part B: PLAN（共识评审）

### 调用 Skills

- `autoplan` (gstack) — CEO → Design → Eng 自动流水线
- `delphi-review` — 多轮匿名评审直到共识
- specification.yaml 从 APPROVED 设计文档自动生成（无需独立 skill）

**Web 前端项目额外注入**:
- `design-shotgun` (gstack) — 生成多版 UI 设计变体

**Mobile 项目额外注入** (`--type mobile-flutter` / `mobile-react-native`):
- `design-shotgun` (gstack) — 移动端 UI 设计探索

### 执行步骤

#### Step 0: Web 前端项目 — 调用 design-shotgun（如适用）

**IF project_type is web-nextjs / web-react / web-vue / mobile-flutter / mobile-react-native:**
```
skill(name="design-shotgun", user_message="[Pain Document 内容 + 需求描述]")
```

#### Step 0.5: DESIGN 路由分叉（v0.14.0+ — Issue #306）

根据 Phase 1/6 PREP (AUTO-ESTIMATE) 的 `change_type` 决定走哪条路径：

```
读取 .sprint-state/sprint-state.json → auto_estimate.change_type

IF change_type == "修改已存在代码":
  → 增量优化路径: SKIP autoplan
  → 直接进入 Step 2b: delphi-review (lightweight: 2 专家, 1 轮)
ELSE (change_type == "新增功能" 或 未定义):
  → 标准路径: 继续 Step 1 (autoplan) → Step 2
```

**路由决策表**:

| change_type | 路径 | autoplan | delphi-review |
|------------|------|----------|---------------|
| `修改已存在代码` | 增量优化 | ❌ SKIP | lightweight (2 专家, 1 轮) |
| `新增功能` | 标准 | ✅ 执行 | 标准 (3 专家) |
| `undefined` / 缺失 | 标准 (fail-safe) | ✅ 执行 | 标准 (3 专家) |

**HARD-GATE 不变**: 两条路径最终都必须产出 APPROVED 的 delphi-reviewed.json。

#### Step 1: 调用 autoplan skill（仅标准路径）

**仅当 change_type != "修改已存在代码" 时执行。**

```
skill(name="autoplan", user_message="[Pain Document 内容]")
```

autoplan 自动执行 `plan-ceo-review` → `plan-design-review` → `plan-eng-review`，使用 6 个决策原则自动决策：

```yaml
autoplan_result:
  taste_decisions: [] | [decision1, decision2, ...]
  verdict: "AUTO_APPROVED" | "NEEDS_REVIEW"
```

#### Step 2: 条件分支

```
┌───────────────────────────────────────────────────────────────────┐
│ Phase 2/6: 条件分支逻辑                                            │
├───────────────────────────────────────────────────────────────────┤
│ IF autoplan_result.verdict == "AUTO_APPROVED"                      │
│    AND autoplan_result.taste_decisions == []                       │
│  → 调用 lightweight delphi-review（2 专家、1 轮、2/2 APPROVED）     │
│                                                                    │
│ IF autoplan_result.verdict == "NEEDS_REVIEW"                       │
│    OR autoplan_result.taste_decisions.length > 0                   │
│  → ⚠️ 暂停等待用户确认 taste_decisions                             │
│  → 用户确认后，调用标准 delphi-review（3 专家）                     │
└───────────────────────────────────────────────────────────────────┘
```

#### Step 2a: 如果需要用户确认 taste_decisions

暂停并提示用户决策选项。

#### Step 2b: 调用 delphi-review（强制，orchestrator 直接执行）

```
# 标准路径（3 专家）
skill(name="delphi-review", user_message="[设计文档 + taste_decisions 确认结果]")

# 增量优化路径（2 专家, 1 轮 — 来自 Step 0.5 路由）
skill(name="delphi-review", user_message="[设计文档]", experts=2, max_rounds=1)
```

- **标准路径**: Round 1: 3 专家匿名独立评审
- **增量优化路径**: 2 专家, 1 轮 (来自 Step 0.5 DESIGN 路由分叉)
- Round 2+: 交换意见直到共识
- 输出: APPROVED / REQUEST_CHANGES

**如果 REQUEST_CHANGES**: 暂停等待用户处理 → 修复后重新评审 → 直到 APPROVED

#### Step 3: 从 APPROVED 设计文档提取 specification.yaml

```yaml
specification:
  requirements:
    - id: REQ-001
      description: [需求描述]
      priority: [critical/high/medium/low]
  acceptance_criteria:
    - id: AC-001
      requirement: REQ-001
      criteria: [验收标准]
      test_type: [unit/integration/e2e]
  design_decisions:
    - id: DD-001
      decision: [设计决策]
      rationale: [理由]
      alternatives_considered: [备选方案]
```

#### Step 4: 调用 to-issues

```
skill(name="to-issues")
```
垂直切片 Issue 拆分 → `slices-manifest.json` → Phase 3/6 BUILD 按 execution_order 执行

#### Step 5: 保存 specification.yaml

保存到 `<project-root>/.sprint-state/phase-outputs/specification.yaml`

### 暂停点

| 暂停点 | 触发条件 | 用户操作 |
|--------|---------|---------|
| taste_decisions 确认 | autoplan 无法自动决策 | 用户确认每个决策 |
| delphi-review APPROVED | Round 结果 REQUEST_CHANGES | 用户修复并重新评审 |

### 输出

- specification.yaml
- slices-manifest.json
- 进入 Phase 3/6 BUILD（除非 `--stop-at design`）
