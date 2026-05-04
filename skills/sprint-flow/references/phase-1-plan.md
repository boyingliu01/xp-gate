# Phase 1: PLAN（共识评审）

## 目标

多模型评审，达成 APPROVED 共识。后续步骤自动从 APPROVED 设计文档提取 specification.yaml。

---

## 调用 Skills

- `autoplan` (gstack) — CEO → Design → Eng 自动流水线
- `delphi-review` — 多轮匿名评审直到共识
- specification.yaml 从 APPROVED 设计文档自动生成（无需独立 skill）

**Web 前端项目额外注入**:
- `design-shotgun` (gstack) — 生成多版 UI 设计变体，用于探索不同的设计方案

---

## 执行步骤

### Step 0: Web 前端项目 — 调用 design-shotgun（如适用）

**IF project_type is web-nextjs / web-react / web-vue:**

```bash
skill(name="design-shotgun", user_message="[Pain Document 内容 + 需求描述]")
```

design-shotgun 执行：
- 生成多个 AI 设计变体
- 打开比较板展示不同设计方案
- 收集结构化反馈并迭代

输出: 多个设计方案（用于 autoplan 的 plan-design-review）

**IF backend project:** 跳过此步骤，直接进入 Step 1。

### Step 1: 调用 autoplan skill

```bash
skill(name="autoplan", user_message="[Pain Document 内容]")
```

autoplan 自动执行：
- `plan-ceo-review` — CEO 视角评审
- `plan-design-review` — Design 视角评审  
- `plan-eng-review` — Eng 视角评审

使用 6 个决策原则自动决策，输出：

```yaml
autoplan_result:
  taste_decisions: [] | [decision1, decision2, ...]
  verdict: "AUTO_APPROVED" | "NEEDS_REVIEW"
```

---

### Step 2: 条件分支（关键设计）

```
┌───────────────────────────────────────────────────────────────────┐
│ Phase 1: 条件分支逻辑                                             │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│ IF autoplan_result.verdict == "AUTO_APPROVED"                      │
│    AND autoplan_result.taste_decisions == []                       │
│  → 跳过 delphi-review，直接进入 Step 3                            │
│  → 场景: autoplan 所有决策自动通过，无关键分歧                     │
│                                                                    │
│ IF autoplan_result.verdict == "NEEDS_REVIEW"                       │
│    OR autoplan_result.taste_decisions.length > 0                   │
│  → ⚠️ 暂停等待用户确认 taste_decisions                             │
│  → 用户确认后，调用 delphi-review                                  │
│  → 场景: 存在关键决策分歧或 autoplan 未完全自动通过                │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

---

### Step 2a: 如果需要用户确认 taste_decisions

暂停并提示用户：

```
⚠️ autoplan 发现以下关键决策无法自动决定，请确认：

Decision 1: [决策描述]
  Option A: [选项A] - [优缺点]
  Option B: [选项B] - [优缺点]
  
Decision 2: [决策描述]
  Option A: [...]
  Option B: [...]

请选择每个决策的选项，或提供您的观点。
```

用户确认后，继续 Step 2b。

---

### Step 2b: 调用 delphi-review（如需要）

```bash
skill(name="delphi-review", user_message="[设计文档 + taste_decisions 确认结果]")
```

delphi-review 执行：
- Round 1: 3 专家匿名独立评审
- Round 2+: 交换意见直到共识
- 输出: APPROVED / REQUEST_CHANGES

**如果 REQUEST_CHANGES**:
- ⚠️ 暂停等待用户修复
- 修复后重新评审（从 Round 2 起步）
- 直到 APPROVED

**如果 APPROVED**:
- 自动进入 Step 3

---

### Step 3: 从 APPROVED 设计文档提取 specification.yaml

设计文档 APPROVED 后，自动提取需求 + AC 生成轻量 specification.yaml（无需独立 skill）：

```
# 自动完成: 读取设计文档 → 提取 requirements → 生成 specification.yaml
# specification.yaml 用于 test-spec-alignment 验证
```

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

---

### Step 4: 保存 specification.yaml

保存到 `<project-root>/.sprint-state/phase-outputs/specification.yaml`

---

## 暂停点

| 暂停点 | 触发条件 | 用户操作 |
|--------|---------|---------|
| taste_decisions 确认 | autoplan 无法自动决策 | 用户确认每个决策 |
| delphi-review APPROVED | Round 结果 REQUEST_CHANGES | 用户修复并重新评审 |

---

## 输出

- specification.yaml
- 进入 Phase 2 自动执行（除非 `--stop-at plan`）