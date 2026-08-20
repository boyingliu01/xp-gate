# Phase 2/6: DESIGN（设计 — 需求探索 + 双点评审）

**执行时机**: Phase 1/6 PREP 完成后、Phase 3/6 BUILD 之前。
**对应旧模型**: Phase 0 THINK + Phase 1 PLAN

## 目标

使用 grill-with-docs 进行结构化需求探索（含 CONTEXT.md/ADR 沉淀），经 R1 需求评审验证需求完整性，输出经用户批准的设计文档。然后通过 batch-grill-me 批量前置决策 + R2 delphi-review 达成 ≥90% 共识，生成 specification.yaml。

**新链（v0.18.0+，零外部依赖，双点评审）**:
```
grill-with-docs → R1 需求评审(轻量) → 原生设计文档+APPROVAL门 → batch-grill-me → R2 delphi-review(设计维度) → to-issues
     ↓                ↓ #368                 ↓ HARD-GATE              ↓              ↓ HARD-GATE
 CONTEXT.md+ADR   需求完整性/AC覆盖     用户审批设计文档      批量前置决策     ≥90% 共识
```

---

## Part A: THINK（需求探索 + 需求评审）

### Step 0: CONTEXT.md 预检（v0.14.9+ — Issue #322）

在进入 grill 访谈前，检查 `CONTEXT.md` 是否已存在：

```
IF CONTEXT.md 存在于项目根目录:
  → 读取已有设计上下文
  → SKIP grill-with-docs 访谈（设计上下文已存在，避免重复探索）
  → ⚠️ R1 需求评审仍执行（Round 1 修订：CONTEXT.md 可能陈旧，快速路径同样需要需求评审）
  → 评审对象为 CONTEXT.md + 本次需求陈述
  → 输出: "[sprint-flow] CONTEXT.md 已存在，跳过需求访谈，进入 R1 需求评审"
ELSE:
  → 继续执行 Step 1（结构化需求探索）
```

**CONTEXT.md 预检路由表**:

| CONTEXT.md 状态 | grill-with-docs | R1 需求评审 | 输入到 Part B | 说明 |
|----------------|-----------------|-------------|---------------|------|
| 不存在 | ✅ 执行 | ✅ 执行 | grill 输出 + R1 结论 | 标准路径 |
| 存在 | ❌ SKIP | ✅ 执行 | 已有 CONTEXT.md + R1 结论 | 快速路径 (Issue #322) |

### Step 1: 调用 grill-with-docs（需求访谈）

**仅当 CONTEXT.md 不存在时执行。**

```
skill(name="grill-with-docs", user_message="[需求描述]")
```

grill-with-docs 执行：
1. **逐个追问决策树** — 每题附推荐答案；事实自行探查，决策留给用户
2. **同步维护 CONTEXT.md** — 项目上下文沉淀（`domain-modeling` 内置）
3. **同步维护 ADR** — `docs/adr/ADR-NNNN-*.md` 架构决策记录
4. **达成共享理解** — 需求边界、用户场景、验收标准清晰化

### Step 2: R1 需求评审（#368 恢复的第一点评审）

grill 访谈达成共享理解后（或 CONTEXT.md 快速路径下读取已有上下文后）、设计文档生成前，调用需求评审：

```
/delphi-review --mode requirements
```

这是 Agent skill 调用，不是 `xp-gate` npm CLI 子命令。Skill orchestrator 必须分别调用 per-expert runner 三次，每次保留 `--expert <architecture|technical|feasibility> --mode requirements`，再聚合三份结果；禁止用一个 runner 进程执行全部模型。

**评审配置**：
- 复用现有 3 专家（architecture/feasibility/technical），`--mode requirements` 切换评审焦点提示词
- 所有路径固定使用 3 专家，Round 1 独立执行并验证 distinct model IDs，最多 5 轮
- force level 只调整上下文深度与迭代预算；所有路径都执行 R1，不减少专家数

**评审焦点**：
- 用户场景遗漏
- 验收标准覆盖度与可测试性
- 用户画像清晰度
- 需求边界

**阻塞语义（程序化）**：

输出 `.sprint-state/phase-outputs/requirements-reviewed.json`：

```json
{
  "verdict": "APPROVED | GAPS_FOUND",
  "timestamp": "<ISO 8601>",
  "requirements_statement": "<被评审的原始需求陈述>",
  "context_file_used": "CONTEXT.md | null",
  "requirements_hash": "<SHA-256 of requirements_statement + context file exact UTF-8 content if used + timestamp YYYY-MM-DD>",
  "head_commit": "<git rev-parse HEAD>",
  "consensus_ratio": 1.0,
  "expert_verdicts": [
    { "role": "architecture", "verdict": "APPROVED", "result_type": "delphi_expert_result", "requested_model": "provider/model-a" },
    { "role": "technical", "verdict": "APPROVED", "result_type": "delphi_expert_result", "requested_model": "provider/model-b" },
    { "role": "feasibility", "verdict": "APPROVED", "result_type": "delphi_expert_result", "requested_model": "provider/model-c" }
  ],
  "rounds": 1,
  "gaps": []
}
```

**GAPS_FOUND 处理**：
- 回到 Step 1 补充访谈（或补充 CONTEXT.md 内容）
- 最多 5 轮循环后升级给用户决策

**程序化校验**：
- `phase-transition 2 completed` 校验 schema-v2 必填字段、`verdict=APPROVED`、三份专家证据、`consensus_ratio`、当前 HEAD，并从需求陈述、可选 context 文件和 timestamp 日期重新计算 `requirements_hash`
- 不匹配 → BLOCK（防陈旧绑定）

### Step 3: 原生设计文档生成

orchestrator 基于访谈记录 + CONTEXT.md + R1 评审结论生成设计文档：

**路径**: `docs/plans/YYYY-MM-DD-<topic>-design.md`

**内容结构**:
1. 需求摘要（来自 grill 访谈 + R1 评审结论）
2. 2–3 候选方案与 trade-offs
3. 推荐方案
4. 成功标准

### Step 4: HARD-GATE — 用户审批设计文档

```
⚠️ HARD-GATE: 设计未 APPROVED → 不可进入 Part B

等待用户审批设计文档。
用户 APPROVE 前，禁止进入 Part B (PLAN) 或任何实现。
```

**sprint-flow 编排层行为**:
- 收到用户 APPROVED 后，自动进入 Part B
- 如果用户未 APPROVED，BLOCK 并等待

### 暂停点

| 暂停点 | 触发条件 | 用户操作 | 自动恢复条件 |
|--------|---------|---------|-------------|
| R1 GAPS_FOUND | 需求评审发现缺口 | 补充访谈/上下文 | 重新 R1 评审（最多 5 轮） |
| **HARD-GATE** | 设计文档未 APPROVED | 用户审批设计文档 | 设计 APPROVED 后自动进入 Part B |

### 输出

- CONTEXT.md（项目上下文沉淀）
- ADR 文件（`docs/adr/ADR-NNNN-*.md`）
- requirements-reviewed.json（`.sprint-state/phase-outputs/`）
- Design Document（`docs/plans/YYYY-MM-DD-<topic>-design.md`）
- 进入 Part B 自动执行（使用设计文档作为输入）

---

## Part B: PLAN（共识评审）

### Step 5: 路由分叉（v0.14.0+ — Issue #306, #322）

根据 Phase 1/6 PREP (AUTO-ESTIMATE) 的 `change_type` 决定路径：

```
读取 .sprint-state/sprint-state.json → auto_estimate.change_type

IF change_type == "修改已存在代码":
  → 增量优化路径: SKIP batch-grill-me
   → 直接进入 Step 7: R2 delphi-review（3 专家，最多 5 轮）
ELSE (change_type == "新增功能" 或 未定义):
  → 标准路径: 继续 Step 6 (batch-grill-me) → Step 7
```

**路由决策表**:

| change_type | batch-grill-me | R2 delphi-review |
|------------|----------------|------------------|
| `修改已存在代码` | ❌ SKIP | 3 专家，最多 5 轮 |
| `新增功能` | ✅ 执行 | 标准 (3 专家) |
| `undefined` / 缺失 | ✅ 执行 | 标准 (3 专家) |

**HARD-GATE 不变**: 两条路径最终都必须产出 APPROVED 的 delphi-reviewed.json。

### Step 6: 调用 batch-grill-me（仅标准路径）

**仅当 change_type != "修改已存在代码" 时执行。**

```
skill(name="batch-grill-me", user_message="[设计文档 + 待确认决策列表]")
```

batch-grill-me 替代 autoplan 的 taste_decisions 功能：
- 前置已确定决策整批提出
- 用户一轮确认
- 输出批量决策结果

### Step 7: R2 设计评审（delphi-review，原生 HARD-GATE）

```
# 标准路径（3 专家）
skill(name="delphi-review", user_message="[设计文档 + batch-grill-me 决策结果]")

# 增量优化路径（3 专家，最多 5 轮）
skill(name="delphi-review", user_message="[设计文档]", experts=3, max_rounds=5)
```

- **标准路径**: Round 1: 3 专家匿名独立评审 → Round 2+: 交换意见直到共识
- **增量优化路径**: 3 专家，最多 5 轮
- ≥90% 共识 + APPROVED 才通过
- 输出: APPROVED / REQUEST_CHANGES

**如果 REQUEST_CHANGES**: 暂停等待用户处理 → 修复后重新评审 → 直到 APPROVED

### Step 8: 调用 to-issues（原生保留）

```
skill(name="to-issues")
```

垂直切片 Issue 拆分 → `slices-manifest.json`（格式不变，ralph-loop 零改动）

to-issues 原生能力：blocked_by/dependency_graph/DAG 循环检测/拓扑排序 → Phase 3/6 BUILD 按 execution_order 执行

### Step 9: 生成 specification.yaml

从 APPROVED 设计文档提取：

```yaml
specification:
  requirements:
    - id: REQ-001
      description: [需求描述]
      priority: [critical/high/medium/low]
  acceptance_criteria:
    - id: AC-001
      requirement: REQ-001
      criteria: [验收标准]    # #368: 每个 REQ 必须含清晰验收标准
      test_type: [unit/integration/e2e]
  design_decisions:
    - id: DD-001
      decision: [设计决策]
      rationale: [理由]
      alternatives_considered: [备选方案]
```

### Step 10: 保存产出物

保存到 `<project-root>/.sprint-state/phase-outputs/`:
- `specification.yaml`
- `slices-manifest.json`（to-issues 输出）

### Web 前端项目额外注入

**IF project_type is web-nextjs / web-react / web-vue / mobile-flutter / mobile-react-native:**

OPTIONAL: 若检测到 `design-shotgun` skill 已安装，可生成多版 UI 设计变体辅助设计评审。未安装则 SKIP。

### 暂停点

| 暂停点 | 触发条件 | 用户操作 |
|--------|---------|---------|
| batch-grill-me 决策确认 | 批量决策需要用户确认 | 用户一轮确认所有决策 |
| R2 delphi-review APPROVED | Round 结果 REQUEST_CHANGES | 用户修复并重新评审 |

### 输出

- specification.yaml（每 REQ 含验收标准 — #368）
- slices-manifest.json
- 进入 Phase 3/6 BUILD（除非 `--stop-at design`）

---

## 证据文件汇总

| 证据文件 | 路径 | 校验时机 | 防陈旧绑定 |
|----------|------|----------|-----------|
| requirements-reviewed.json | `.sprint-state/phase-outputs/` | `phase-transition 2 completed` | `requirements_hash`（SHA-256） |
| delphi-reviewed.json | `.sprint-state/` | DELPHI-GATE (Phase 2→3) | verdict + timestamp |
| specification.yaml | `.sprint-state/phase-outputs/` | `phase-transition 3 in_progress` | slice↔REQ 一致性 |
| slices-manifest.json | `.sprint-state/phase-outputs/` | `phase-transition 3 in_progress` | schema + REQ 引用校验 |
