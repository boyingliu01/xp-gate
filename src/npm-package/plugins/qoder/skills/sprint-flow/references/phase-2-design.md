# Phase 2/6: DESIGN（设计 — 需求探索 + 共识评审）

**执行时机**: Phase 1/6 PREP 完成后、Phase 3/6 BUILD 之前。
**对应旧模型**: Phase 0 THINK + Phase 1 PLAN

## 目标

使用 brainstorming skill 进行结构化需求探索，在设计审批前通过 Qoder 三个 Custom Agent 执行 R1 requirements review，输出经用户批准的设计文档。然后通过 autoplan + R2 delphi-review 达成 ≥90% 共识，生成 specification.yaml。

```
brainstorming → R1 requirements (3 Custom Agents) → 用户审批 → autoplan → R2 delphi-review → to-issues
                    ↓ HARD-GATE                                      ↓ HARD-GATE
          requirements-reviewed.json                         ≥90% design consensus
```

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
6. **Transition to R1** — brainstorming 完成后先执行 requirements mode，不直接进入实现

**sprint-flow 编排层行为**:
- 收到 brainstorming 设计文档后，先执行 R1；R1 与用户审批都通过后自动进入 Part B
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

#### Step 4: R1 requirements review（强制）

```
skill(name="delphi-review", user_message="--mode requirements [需求陈述 + brainstorming 设计上下文]")
```

- 并行执行 Qoder architecture、technical、feasibility 三个 Custom Agent
- 每个 Custom Agent 调用都使用 requirements mode；三次独立执行后由 skill orchestrator 聚合，禁止单进程执行全部模型
- 每份成功结果必须包含 `role`、`verdict: APPROVED`、`result_type: delphi_expert_result` 和非空 trimmed `requested_model`
- 三个角色必须恰好各出现一次，三个 trimmed `requested_model` 必须 distinct
- 聚合 `consensus_ratio` 必须是 `0.90..1`；任一条件失败则 BLOCK 并继续需求澄清
- APPROVED evidence 写入 `.sprint-state/phase-outputs/requirements-reviewed.json`，包含非空 `requirements_hash` 与精确 `git rev-parse HEAD`
- 无法解析 HEAD 时 BLOCK；不得使用 `unknown` 作为可验证身份

```json
{
  "verdict": "APPROVED",
  "timestamp": "2026-08-20T10:30:00Z",
  "requirements_statement": "<被评审的原始需求陈述>",
  "context_file_used": "CONTEXT.md | null",
  "requirements_hash": "<SHA-256 of requirements_statement + context exact UTF-8 content if used + timestamp YYYY-MM-DD>",
  "head_commit": "<exact git rev-parse HEAD>",
  "consensus_ratio": 0.90,
  "expert_verdicts": [
    { "role": "architecture", "verdict": "APPROVED", "result_type": "delphi_expert_result", "requested_model": "provider/model-a" },
    { "role": "technical", "verdict": "APPROVED", "result_type": "delphi_expert_result", "requested_model": "provider/model-b" },
    { "role": "feasibility", "verdict": "APPROVED", "result_type": "delphi_expert_result", "requested_model": "provider/model-c" }
  ]
}
```

Phase 2 的 R2 与产出步骤全部完成后、进入 Phase 3 前运行 `npx xp-gate phase-transition 2 completed`。schema-v2 Sprint 未通过该程序化验证不得进入 Phase 3。

### 可选补充: office-hours（方向验证）

当用户输入非常模糊时（如 "我想做一个 AI 工具" 而不是 "开发用户登录功能"），可以先调用 `office-hours` 验证产品方向，再进入 brainstorming 详细设计。

### 暂停点

| 暂停点 | 触发条件 | 用户操作 | 自动恢复条件 |
|--------|---------|---------|-------------|
| **HARD-GATE** | brainstorming 设计未 APPROVED | 用户审批设计文档 | 设计 APPROVED 后自动进入 Part B |
| **R1 HARD-GATE** | requirements evidence 缺失、陈旧或专家合同无效 | 补充需求并重新执行三专家 R1 | evidence 通过 `phase-transition 2 completed` |

### 输出

- Design Document (`docs/plans/YYYY-MM-DD-<topic>-design.md`)
- Implementation Plan（brainstorming 内部 writing-plans 输出）
- requirements-reviewed.json（Qoder 三 Custom Agent R1 evidence）
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

#### Step 1: 调用 autoplan skill

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
│  → 调用轻量上下文 delphi-review（三个 Custom Agent，最多 5 轮）      │
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
skill(name="delphi-review", user_message="[设计文档 + taste_decisions 确认结果]")
```

- Round 1: architecture、technical、feasibility 三个 Custom Agent 匿名独立评审
- 验证三份成功结果与三个 distinct trimmed `requested_model`
- Round 2+: 三个 Agent 交换意见直到共识，最多 5 轮
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
