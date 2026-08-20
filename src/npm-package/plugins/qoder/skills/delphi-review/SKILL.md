---
name: delphi-review
version: 1.1.0
description: >
  Performs multi-round anonymous expert consensus review using the Delphi method. Supports
  design review (default), code-walkthrough (--mode code-walkthrough), and requirements
  (--mode requirements) modes. Uses exactly 3
  successfully executed experts with distinct model IDs and a >=90% statistical consensus threshold.
  Outputs structured verdict (APPROVED/PASS_WITH_CAVEATS/REQUEST_CHANGES/BLOCKED).

  WHAT: Anonymous multi-expert review with iterative consensus building for designs, plans,
  architecture, code changes, and PRs. NOT a single-reviewer pass, NOT a linter, NOT a test runner.
  WHEN: User explicitly requests a review, design validation, multi-expert consensus, code walkthrough
  before push, architecture evaluation, or "/delphi-review".
  NOT WHEN: Asking HOW to review something (educational), mentioning "review" in passing without intent,
  requesting a simple code check or lint, asking about the Delphi process itself, or mentioning
  "review" as part of a different workflow (e.g., "code review" without multi-expert intent),
  asking for review guidelines/checklists/formats, individual peer review, or casual review requests.

  TRIGGERS: "/delphi-review", "review this design", "评审这个需求", "评审这个设计", "design review",
  "多专家评审", "consensus review", "code walkthrough", "push review", "architecture review",
  "delphi review", "run delphi", "start delphi", "评审这个架构", "review this architecture",
  "评审PR", "review this PR with delphi", "delphi评审", "delphi 评审", "run delphi review",
  "执行delphi", "启动delphi评审".
  NEGATIVE TRIGGERS: "how does delphi work", "what is delphi review", "code review checklist",
  "review my code quickly", "can you review this", "peer review", "I need a review",
  "explain the review process", "review guidelines", "how to review a design",
  "code review template", "review format", "PR review", "帮我review一下",
  "just review this", "quick review", "review steps".
maturity: beta
auto_continue: true
triggers:
  - "/delphi-review"
  - "review this design"
  - "评审这个需求"
  - "评审这个设计"
  - "design review"
  - "多专家评审"
  - "consensus review"
  - "code walkthrough"
  - "push review"
  - "architecture review"
  - "delphi review"
  - "run delphi"
  - "start delphi"
  - "评审这个架构"
  - "review this architecture"
  - "评审PR"
  - "review this PR with delphi"
  - "delphi评审"
  - "delphi 评审"
  - "run delphi review"
  - "执行delphi"
  - "启动delphi评审"
triggers_negative_examples:
  - "how does delphi work"       # educational question about the process
  - "what is delphi review"      # asking for explanation, not execution
  - "code review checklist"      # asking for a checklist, not running review
  - "review my code quickly"     # single-pass quick review, not Delphi multi-round
  - "can you review this"        # ambiguous — could be casual peer review
  - "peer review"                # different process from Delphi
  - "I need a review"            # too vague, casual request
  - "explain the review process" # educational, not executional
  - "review guidelines"          # asking about guidelines, not executing
  - "how to review a design"     # educational
  - "PR review"                  # single-reviewer PR check, not multi-expert Delphi
  - "review my PR"               # informal PR review request, not Delphi
  - "帮我review一下"             # casual Chinese review request, no multi-expert intent
  - "just review this"           # casual, single-pass review request
  - "quick review"               # explicitly contradicts multi-round Delphi process
  - "review steps"               # asking for review instructions, not running review
  - "code review template"       # asking for a template, not executing review
  - "review format"              # asking about format, not executing
  - "show me how to review"      # educational request about reviewing
  - "review checklist example"   # asking for examples, not running review
triggers_negative_test_cases:
  - input: "how does delphi work"
    expect: "NOT triggered"
  - input: "code review checklist"
    expect: "NOT triggered"
  - input: "review my code quickly"
    expect: "NOT triggered"
  - input: "can you review this"
    expect: "NOT triggered"
  - input: "peer review"
    expect: "NOT triggered"
  - input: "I need a review"
    expect: "NOT triggered"
  - input: "explain the review process"
    expect: "NOT triggered"
  - input: "review guidelines"
    expect: "NOT triggered"
  - input: "/delphi-review"
    expect: "triggered"
  - input: "review this design"
    expect: "triggered"
  - input: "评审这个需求"
    expect: "triggered"
  - input: "评审这个设计"
    expect: "triggered"
  - input: "design review"
    expect: "triggered"
  - input: "多专家评审"
    expect: "triggered"
  - input: "consensus review"
    expect: "triggered"
  - input: "code walkthrough"
    expect: "triggered"
  - input: "architecture review"
    expect: "triggered"
  - input: "delphi review"
    expect: "triggered"
  - input: "评审这个架构"
    expect: "triggered"
  - input: "delphi 评审"
    expect: "triggered"
  - input: "run delphi review"
    expect: "triggered"
  - input: "review my PR"
    expect: "NOT triggered"
  - input: "帮我review一下"
    expect: "NOT triggered"
  - input: "just review this"
    expect: "NOT triggered"
  - input: "quick review"
    expect: "NOT triggered"
  - input: "review steps"
    expect: "NOT triggered"
  - input: "code review template"
    expect: "NOT triggered"
  - input: "run delphi"
    expect: "triggered"
workflow_steps:
  - "Step 0: Input Validation → Output: [DelphiReview] or [DelphiReview:BLOCKED]"
  - "Round 1: Anonymous Independent Review → Output: [DelphiReview Round 1] expert JSON verdicts"
  - "Consensus Check → Output: consensus_ratio, verdict summary"
  - "Round 2: Exchange Opinions (if needed) → Output: [DelphiReview Round 2] revised verdicts"
  - "Round 3: Final Positions (if needed) → Output: [DelphiReview Round 3] final verdicts"
  - "Fix & Re-Review (if REQUEST_CHANGES) → restart from Round 2"
  - "Generate Output: consensus report + specification.yaml (design) or .code-walkthrough-result.json (walkthrough)"
hooks:
  security:
    - "/careful": "Safety guardrails for destructive commands — ensure review is read-only"
    - "/freeze": "Restrict edits to review scope — prevent accidental changes during review"
    - "/guard": "Full safety mode combining careful + freeze for maximum protection"
  operational:
    - "/context-save": "Save review context before pause or handoff"
    - "/context-restore": "Restore review context on resume"
tools_allowed:
  - "Read"                       # read design docs, code, configs, specification.yaml
  - "Glob"                       # find files by pattern
  - "Grep"                       # search code content
  - "Bash"                       # read-only: git diff, git log, file stats
  - "Task(subagent_type=oracle)" # dispatch oracle for deep analysis
  - "Task(subagent_type=delphi-reviewer-architecture)"    # dispatch architecture expert
  - "Task(subagent_type=delphi-reviewer-technical)"     # dispatch technical expert
  - "Task(subagent_type=delphi-reviewer-feasibility)"   # dispatch feasibility expert
  - "Write(specification.yaml, .code-walkthrough-result.json, delphi-reviewed.json)"  # write output artifacts only
  - "Skill"                      # invoke related skills for context
  - "Question"                   # ask user at decision points
tools_denied:
  - "Edit(source code)"           # NEVER edit implementation code during review
  - "Write(source code)"          # NEVER write implementation code
  - "Bash(git commit, git push)"  # NEVER commit or push during review
  - "Task(category=*, subagent_type=build)"  # NEVER delegate build/implementation
---

# Delphi Consensus Review

## Scope

**In Scope:**
- Multi-round anonymous expert consensus review (design + requirements + code-walkthrough modes)
- Exactly 3 experts with distinct trimmed executable model IDs and statistical consensus (>= 90%)
- Structured verdict: APPROVED / PASS_WITH_CAVEATS / REQUEST_CHANGES
- Provider, vendor, gateway, country, and model nationality are unrestricted; any expert execution failure blocks approval

**Out of Scope:**
- Does NOT implement code changes (review only, implementation is separate)
- Does NOT replace testing or CI/CD verification
- Does NOT handle deployment or release decisions

## Triggers

- /delphi-review
- review this design
- 评审这个需求
- 评审这个设计
- design review
- 多专家评审
- consensus review
- code walkthrough
- push review
- architecture review
- delphi review
- run delphi
- start delphi
- 评审这个架构
- review this architecture
- 评审PR
- review this PR with delphi
- delphi评审
- delphi 评审
- run delphi review
- 执行delphi
- 启动delphi评审

**NOT triggered by:**
- "how does delphi work" (educational)
- "code review checklist" (asking for a list)
- "review my code quickly" (single-pass, not multi-expert)
- "can you review this" (ambiguous casual review)
- "peer review" (different process)
- "I need a review" (too vague)
- "explain the review process" (educational)
- "review guidelines" (asking about guidelines)
- "PR review" (single-reviewer PR check)
- "review my PR" (informal PR review)
- "帮我review一下" (casual Chinese request)
- "just review this" (casual single-pass)
- "quick review" (contradicts multi-round process)
- "review steps" (asking for instructions)
- "code review template" (asking for template)
- "review format" (asking about format)
- "show me how to review" (educational)

## Workflow

1. **Step 0: Input Validation** — Check input contains reviewable content (design doc/code/spec/diff). Empty input → `[DelphiReview:BLOCKED]`.
2. **Round 1: Anonymous Independent Review** — Launch the architecture, technical, and feasibility Custom Agents independently. Record three successful `delphi_expert_result` records and each `requested_model`.
3. **Execution Verification** — Require all three records and three distinct trimmed requested model IDs. Model provider, vendor, gateway, and nationality are unrestricted.
4. **Consensus Check** — Aggregate all three results; consensus >=90% AND all APPROVED → complete.
5. **Rounds 2-5** — Exchange evidence and re-evaluate with all three Custom Agents until approved or five rounds are exhausted.
6. **Failure Handling** — Missing/failed agents, duplicate model IDs, or no consensus after Round 5 → BLOCK; never reduce the expert count.
7. **Generate Output** — Consensus report + specification.yaml (design) or `.code-walkthrough-result.json` (walkthrough) + `delphi-reviewed.json`.

## Activation (MANDATORY for L1 Trigger Detection)

Every delphi-review response MUST begin with an activation marker as the first line:

| Marker | Meaning |
|--------|---------|
| `[DelphiReview]` | Standard entry — review proceeding |
| `[DelphiReview:BLOCKED]` | Step 0 input validation failure |
| `[DelphiReview:WARNING]` | Red flag detected (reserved) |

## Round Markers (MANDATORY for L3 Step Adherence)

Each round MUST output a structured round marker:

```
[DelphiReview Round 1] Anonymous Independent Review
[DelphiReview Round 2] Exchange Opinions
[DelphiReview Round 3] Final Positions
```

**Rules**:
- Every round marker MUST appear as a separate, identifiable line
- Round numbering MUST be sequential (1 through at most 5)
- After each round, output consensus summary: `consensus_ratio=N/N`, `verdict_status: converging | stable | diverging`
- Final round MUST output verdict: `APPROVED | PASS_WITH_CAVEATS | REQUEST_CHANGES | PROCESS_BLOCK`

## 核心原则

**Delphi 方法只有一个目的：得到所有专家一致认可的可行方案。**

| 特性 | 说明 |
|------|------|
| **匿名性** | Round 1 专家互不知道对方意见 |
| **迭代** | 多轮直到共识，不是固定轮数 |
| **受控反馈** | 每轮看到其他专家意见 |
| **统计共识** | >=90% 一致才算共识 |
| **Token 是投资** | 相比后期修复成本，评审消耗微不足道 |
| **零容忍** | Critical/Major 全部必须处理，不可跳过 |

---

## 评审模式

| 模式 | 触发 | 用途 | 输出 |
|------|------|------|------|
| `design`（默认） | `/delphi-review` | 需求/设计/架构/PR 评审 | 共识报告 + specification.yaml |
| `code-walkthrough` | `--mode code-walkthrough` | git push 前代码走查 | `.code-walkthrough-result.json` |
| `requirements` | `--mode requirements` | Phase 2 R1 需求完整性评审 | `.sprint-state/phase-outputs/requirements-reviewed.json` |

**Code Walkthrough 模式**的完整规范 → 详见 `references/code-walkthrough.md`

### Requirements 模式（Qoder Custom Agents）

在 Phase 2 需求探索完成、设计审批前，并行运行 Qoder 的 architecture、technical、feasibility 三个 Custom Agent。Round 1 保持匿名；任一 Agent 未成功返回、任一裁决不是 `APPROVED`、三个 trimmed `requested_model` 不互异，或聚合 `consensus_ratio < 0.90` 时，R1 必须 BLOCK，不能减少专家数或使用仲裁结果代替。

APPROVED 后读取 `git rev-parse HEAD` 的精确结果并写入 `.sprint-state/phase-outputs/requirements-reviewed.json`。无法解析 HEAD 时不得写 APPROVED 证据：

```json
{
  "mode": "requirements",
  "verdict": "APPROVED",
  "requirements_hash": "<non-empty SHA-256 hex digest>",
  "head_commit": "<exact git rev-parse HEAD>",
  "consensus_ratio": 0.90,
  "expert_verdicts": [
    { "role": "architecture", "verdict": "APPROVED", "result_type": "delphi_expert_result", "requested_model": "provider/model-a" },
    { "role": "technical", "verdict": "APPROVED", "result_type": "delphi_expert_result", "requested_model": "provider/model-b" },
    { "role": "feasibility", "verdict": "APPROVED", "result_type": "delphi_expert_result", "requested_model": "provider/model-c" }
  ]
}
```

`confidence` 可以由 Custom Agent 提供，但不是 R1 evidence contract 的必需字段。Phase 2 全部步骤完成、进入 Phase 3 前必须执行 `npx xp-gate phase-transition 2 completed`；schema-v2 Sprint 只有通过程序化校验才能继续。

---

## 参数配置

### 专家配置

| 配置 | 专家 | 适用场景 |
|------|------|---------|
| 3 专家（强制） | A(架构) + B(实现) + C(可行性) | 所有评审模式 |

### 模型选择策略（强制 — 平台适配）

**关键原则**：
- ✅ 三个专家必须成功执行且使用 **三个 distinct trimmed model IDs**
- ❌ 禁止 hardcode 模型名称
- ✅ Provider、vendor、gateway 和模型国籍不受限制
- ❌ `provider: local` fallback 不能计为成功执行

#### Qoder 平台（推荐 — Custom Agent 模式）

Qoder 环境下使用 **Custom Agent** 机制，每个专家是一个独立的 custom agent，配置不同的 Qoder 内置模型：

| 专家 | Agent 文件 | 模型 | Credits 费率 |
|------|-----------|------|-------------|
| Architecture (A) | `.qoder/agents/delphi-architecture.md` | Qwen3.7-Max | 0.5× |
| Technical (B) | `.qoder/agents/delphi-technical.md` | GLM-5.2 | 0.6× |
| Feasibility (C) | `.qoder/agents/delphi-feasibility.md` | DeepSeek-V4-Pro | 0.5× |

**执行方式**：通过 Agent tool 并行启动 3 个 subagent（type=GeneralPurpose），每个 agent 使用自己配置的模型独立评审，主 orchestrator 收集结果后计算共识。

**优势**：无需外部 API key，直接使用 Qoder Credits，模型由平台统一管理。

#### OpenCode 平台（External API 模式）

OpenCode 环境下通过 `opencode.json` 的 agent 配置 + `.delphi-config.json` 调用外部 API：
- **MUST 从 `opencode.json` 的 agent 配置中读取模型**
- 通过 `scripts/delphi-external-review.cjs` 调用各 provider 的 OpenAI 兼容 API
- 需要用户自行配置 API key（环境变量注入）

### 共识阈值

| 阈值 | 说明 |
|------|------|
| **>=90%** | 推荐默认 |
| 100% | 完全一致（更严格） |

---

## 评审执行过程

```
Phase 0: 准备 → Round 1: 匿名独立评审 → 共识检查
    │
    ├─ 一致 + >=90% + APPROVED → ✅ 完成
    │
    └─ 不一致 或 <90% 或 REQUEST_CHANGES
          │
          ▼
       Round 2: 交换意见 → 共识检查
          │
          ├─ 一致 + >=90% + APPROVED → ✅ 完成
          │
          └─ 仍分歧 或 REQUEST_CHANGES
                │
                ▼
             Round 3: 最终立场 → 共识检查
                │
                ├─ APPROVED → ✅ 完成
                │
                └─ REQUEST_CHANGES → 修复方案 → 回到 Round 2 重新评审
```

### Step 0: Input Validation (MANDATORY — 必须在任何评审前执行)

检查用户 prompt 中是否包含可评审内容（设计文档、代码、specification.yaml、PR diff）：

1. **有完整输入** → 直接进入 Phase 0（准备阶段），开始 Round 1
2. **有部分输入**（占位符、描述性文本）→ 按输入内容执行评审，标注 `[INPUT: PARTIAL]`，但继续执行
3. **无输入**（仅触发词，无文档/代码）→ 输出阻断响应

**Detection heuristics**:
- **Complete**: >=1 structural element (##, requirement, AC-, function, class, interface, YAML frontmatter, code block) AND >=50 non-whitespace chars.
- **Partial**: Descriptive text referencing a design/code artifact BUT lacks structure, OR contains placeholders.
- **None**: Only trigger words with zero additional content, OR questions about the review process itself.

**Partial input constraint**: Cap review to 1 round with `confidence=low` annotation.

---

## 修复与重新评审

如果最终裁决是 REQUEST_CHANGES 或 REJECTED：
1. 修复所有 Critical Issues + 处理所有 Major Concerns
2. 重新评审（从 Round 2 起步，不是 Round 1）
3. 迭代直到 APPROVED

---

## 终止条件

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `max_review_rounds` | 5 | 超过后生成"未达成共识报告"，交人决策 |
| `timeout` | 60min | 单次评审超时 |

---

## Output Format (MANDATORY for L3)

Every Delphi mode MUST use the full JSON schema below. Each of the three Qoder Custom Agents outputs independently and the orchestrator aggregates only after execution verification. There is no single-reviewer Delphi approval path.

```json
{
  "expert_id": "A|B|C",
  "round": 1,
  "mode": "design",
  "verdict": "APPROVED|REQUEST_CHANGES|REJECTED",
  "confidence": 9,
  "critical_issues": ["..."],
  "major_concerns": ["..."],
  "minor_concerns": ["..."],
  "consensus_report": {
    "agreed_items": ["..."],
    "disagreed_items": ["..."],
    "final_verdict": "APPROVED|REQUEST_CHANGES",
    "consensus_ratio": 0.95
  }
}
```

**For code-walkthrough mode**, output follows `.code-walkthrough-result.json` schema (see `references/code-walkthrough.md`).

**For requirements mode**, output follows the Requirements 模式 schema above and includes exact HEAD plus all three successful Custom Agent results.

**Anti-patterns mapping:**
- `Round 1 → "评审完成"` → MUST NOT have `verdict: APPROVED` if `critical_issues` exist
- `只处理 Critical，忽略 Major` → MUST include `major_concerns` array
- `用户说"时间紧急"就跳过` → MUST include `round` field proving multi-round process

---

## Terminal State Checklist

- [ ] Phase 0 完成（文档验证 + 专家分配）
- [ ] 已完成所需轮次（最多 5 轮，每轮三个 Custom Agent 均执行）
- [ ] 问题共识比例 >=90%
- [ ] 所有 Critical Issues 已解决，Major Concerns 已处理
- [ ] 最终裁决是 **APPROVED** 或 **APPROVED_WITH_MINOR**
- [ ] 共识报告生成并保存
- [ ] IF REQUEST_CHANGES → 已修复 → 已重新评审 → APPROVED
- [ ] ⭐ **IF APPROVED (design mode): 生成 specification.yaml**
- [ ] ⭐ **状态文件**: 写入 `.sprint-state/delphi-reviewed.json`

**IF REQUEST_CHANGES/REJECTED → CANNOT claim complete**

### 状态文件格式

**Design mode APPROVED** → `.sprint-state/delphi-reviewed.json`:
```json
{"mode":"design","timestamp":"...","verdict":"APPROVED","consensus_ratio":1.0,"specification_path":".sprint-state/phase-outputs/specification.yaml"}
```

**Code-walkthrough mode APPROVED** → `.sprint-state/delphi-reviewed.json`:
```json
{"mode":"code-walkthrough","commit":"abc123...","timestamp":"...","verdict":"APPROVED","consensus_ratio":1.0}
```

**Requirements mode APPROVED** → `.sprint-state/delphi-reviewed.json`:
```json
{"mode":"requirements","timestamp":"...","verdict":"APPROVED","consensus_ratio":1.0}
```

---

## Anti-Patterns

| ❌ 错误 | ✅ 正确 |
|---------|---------|
| Round 1 未 APPROVED 就"评审完成" | 迭代直到 APPROVED，修复后重新评审 |
| 只处理 Critical，忽略 Major | 零容忍：Critical/Major 全部必须处理 |
| 单专家自评 | 三个 distinct executable models 全部成功执行 |
| 用户说"时间紧急"就跳过 | 评审是投资不是开销 |
| "专家几乎一致"就通过 | "几乎" = 不一致，继续到 >=90% |
| 按 provider 或模型国籍限制选择 | 仅强制三个 distinct trimmed model IDs |
| `provider: local` fallback 计入 | fallback 不算成功执行证据 |

**Code-walkthrough 专属 Anti-Patterns** → 详见 `references/code-walkthrough.md`

---

## Red Flags

| 用户输入模式 | 触发词 | 响应动作 |
|-------------|--------|---------|
| 要求跳过评审 | "skip review", "不用评审", "跳过评审" | → 提醒评审是投资而非开销 |
| 时间压力 | "来不及", "时间紧", "emergency" | → 提醒时间紧迫正是需要评审的时刻 |
| 提前终止 | Round 1 后用户说 "可以了", "够了" | → BLOCK: 评审未达终止条件 |
| 单专家自评 | 用户仅指定 1 个专家 | → BLOCK：必须执行 architecture、technical、feasibility 三个 Custom Agent |
| 无文档输入 | 仅触发词，无设计/代码内容 | → `[DelphiReview:BLOCKED]` |

---

## 成功标准

1. ✅ 所有专家裁决 APPROVED
2. ✅ 问题共识 >=90%
3. ✅ 所有 Critical Issues 已修复验证 + Major Concerns 已处理
4. ✅ 共识报告已生成，用户已确认
5. ✅ 状态文件已写入

**缺少任何一项 = 未完成**

## References

> **Path convention**: `@references/` resolves relative to the skill directory (`skills/delphi-review/`).

| File | Content |
|------|---------|
| `@references/code-walkthrough.md` | Code-walkthrough mode specification |
| `@references/orchestrator-dispatch.md` | Orchestrator auto-dispatch rules (#218 subagent multi-round loop) |
| `@references/round-templates.md` | Round templates (anonymous/exchange/final/fix report formats) |
