---
name: delphi-review
description: "Use when asked to review a design, plan, or architecture; before implementation starts; or when multi-expert consensus is needed. See ## Triggers for trigger phrases."
auto_continue: true
---

# Delphi Consensus Review

## Scope

**In Scope:**
- Multi-round anonymous expert consensus review (design + code-walkthrough modes)
- 2-3 experts from different providers with statistical consensus (>= 90%)
- Structured verdict: APPROVED / PASS_WITH_CAVEATS / REQUEST_CHANGES
- Domestic models only (no Anthropic/OpenAI/Google)

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
- PR review

## 工作流程

1. Input Validation: 检查输入是否包含可评审内容（设计文档/代码/spec），空输入阻断
2. Expert Assignment: 分配 2-3 位专家，至少来自 2 家不同厂商（国产模型）
3. Round 1: 匿名独立评审 — 各专家互不知对方意见，独立输出 verdict JSON
4. Consensus Check: 共识检查 — 共识 ≥90% 且全部 APPROVED 则完成
5. Round 2: 交换意见 — 未达成共识时，专家查看他人意见后重新评审
6. Round 3: 最终立场 — 仍未达成共识时，输出最终立场和分歧点
7. Fix & Re-Review: REQUEST_CHANGES → 修复 Critical+Major → 从 Round 2 重新评审
8. Generate Output: 生成共识报告 + specification.yaml + delphi-reviewed.json

## Activation
**MANDATORY**: Every delphi-review response MUST begin with `[DelphiReview]` as the first line.
This marker is required for skill-cert L1 trigger detection.

Permitted variants (all satisfy L1 trigger):
- `[DelphiReview]` — standard entry
- `[DelphiReview:BLOCKED]` — Step 0 input validation failure
- `[DelphiReview:WARNING]` — red flag detected (reserved)

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

**Code Walkthrough 模式**的完整规范 → 详见 `references/code-walkthrough.md`

---

## 参数配置

### 专家配置

| 配置 | 专家 | 适用场景 |
|------|------|---------|
| 2 专家（默认） | A(架构) + B(实现) | 代码变更、小型设计 |
| 3 专家 | A(架构) + B(实现) + C(可行性) | 架构决策、需求文档 |

### 模型选择策略（Qoder — 从 .delphi-config.json 读取 + 外部 API 调用）

**MUST 从 `.delphi-config.json` 读取 API 配置**，通过 Bash 工具调用 `delphi-external-review.cjs` 脚本实现真正的跨模型评审。

**配置定位优先级**：
1. 当前项目 `skills/delphi-review/.delphi-config.json`（Qoder 已安装 skill）
2. `~/.qoder/skills/delphi-review/.delphi-config.json`（全局安装）

**脚本定位优先级**：
1. `node_modules/@boyingliu01/xp-gate/scripts/delphi-external-review.cjs`（npm 安装后）
2. `$(npm root -g)/@boyingliu01/xp-gate/scripts/delphi-external-review.cjs`（全局安装）
3. xp-gate 仓库中的 `scripts/delphi-external-review.cjs`（开发环境）

**关键原则**：
- ✅ 三个专家必须来自 **至少 2 家不同 provider**（按 `base_url` 判断）
- ✅ 支持混合模式：`provider: "local"` 表示由 Orchestrator 自身模型扮演
- ❌ 禁止三个专家全部使用同一 provider 的模型（除非使用混合模式）

**配置示例**（参考 `.delphi-config.json.example`）：
```json
{
  "active_profile": "default",
  "profiles": {
    "default": {
      "providers": {
        "deepseek": { "base_url": "https://api.deepseek.com/v1", "api_key": "sk-xxx" },
        "zhipu": { "base_url": "https://open.bigmodel.cn/api/paas/v4", "api_key": "yyy" }
      },
      "experts": {
        "architecture": { "provider": "deepseek", "model": "deepseek-chat" },
        "technical": { "provider": "zhipu", "model": "glm-5.2" },
        "feasibility": { "provider": "local" }
      }
    }
  }
}
```
> 上例中 2 个外部 provider（deepseek + zhipu）+ 1 个 local fallback，满足跨 provider 要求。

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
3. **无输入**（仅触发词，无文档/代码）→ 输出以下阻断响应，记入步骤完成：

**Detection heuristics for Step 0**:
- **Complete**: Contains ≥1 structural element (e.g., `##`, `requirement`, `AC-`, `function`, `class`, `interface`, YAML frontmatter, code block with language tag) AND ≥50 non-whitespace characters of actual content (not placeholder brackets like `[...]`, `{...}`, `<insert here>`).
- **Partial**: Contains descriptive text referencing a design/code artifact BUT lacks substantive structure (e.g., "I need to review my login module" with no actual code/design attached), OR contains obvious placeholders like `[...]`, `(content)`, `<insert here>`, `TODO`.
- **None**: Only trigger words (`/delphi-review`, "review this") with zero additional content, OR content that is exclusively questions about the review process itself ("how does delphi work?").

**Partial input constraint**: When input is PARTIAL, cap review to 1 round with `confidence=low` annotation. Do NOT proceed with full multi-round review on insufficient input.

**File path validation**: If user provides a file path (e.g., `--spec specification.yaml`):
- Verify the file exists and is non-empty
- If path is invalid → output: `[DelphiReview:BLOCKED] File not found: [path]. Please verify the path.`
- If file is empty → output: `[DelphiReview:BLOCKED] File is empty: [path]. Please provide valid content.`

```
[DelphiReview:BLOCKED] 需要设计文档或代码内容才能启动评审。

请提供以下之一：
- 设计文档（design doc / specification）
- 代码变更（code diff / PR link）
- specification.yaml 文件路径
- 架构设计说明

评审输入示例：
/delphi-review "Design Doc: [your content here]"
/delphi-review --spec specification.yaml
/delphi-review --mode code-walkthrough
REMAINING STEPS: N/A (input validation failed)
```

在此状态下，BLOCKED 视为步骤已完成（后续步骤标记为 N/A）。

**重要**: 内嵌在 prompt 中的文档内容（如 "Design Doc: [content]"或代码片段）应视为"有完整输入"，直接进入评审。

**执行方式（Qoder）**：
1. 将评审内容写入临时文件（使用 `os.tmpdir()` 确保跨平台）
2. 通过 Bash 工具并行调用 3 个 `delphi-external-review.cjs` 脚本
3. 对 `fallback: true` 的专家，Orchestrator 自身模型扮演该角色
4. 收集 verdict JSON，计算共识度，决定是否需要下一轮

**Round 模板**（匿名评审/交换意见/最终立场/修复报告格式）→ 详见 `references/round-templates.md`

**Orchestrator 自动调度规则**（#218 subagent 内部自动多轮循环）→ 详见 `references/orchestrator-dispatch.md`

**Automatic re-review**: 对于常见可控问题（措辞模糊、AC 缺失、格式问题），应自行修复后自动重评审，无需等待用户。

### ⭐ 自动延续规则（MANDATORY — 防止流程卡住）

当 Delphi Review 启动多轮评审（Round 2+）时，**orchestrator 必须自动延续流程，不得等待用户输入**。

**触发条件**：
- Round N 完成，但未达到终止条件（100% approved + ≥90% consensus + 所有 Critical/Major 已处理）
- 存在待处理的背景任务（subagent  dispatched tasks）

**自动延续动作**：
1. **收集背景任务结果**：等待 `<system-reminder>` 通知后，立即调用 `background_output(task_id="bg_...")` 获取所有 subagent 输出
2. **合成 Round N 总结**：汇总专家意见、共识度、待处理问题
3. **自动启动 Round N+1**：立即 dispatch 新一轮 subagent 任务，携带上一轮总结作为上下文
4. **循环直至终止**：重复步骤 1-3，直到达到终止条件

**终止条件**（满足全部）：
- ✅ 所有专家状态 = APPROVED
- ✅ 共识度 ≥ 90%
- ✅ 所有 Critical 级别问题已解决
- ✅ 所有 Major 级别问题已处理（或已记录为已知问题）

**例外情况**（直接输出，不进入下一轮）：
- Round 1 即达到 100% approved + 100% consensus → 直接输出最终报告
- 已达最大轮数（5 轮）→ 输出"未达成共识"报告，标记为 PROCESS_BLOCK

**禁止行为**：
- ❌ 询问用户"要继续吗？"
- ❌ 等待用户手动触发 Round N+1
- ❌ 在未达到终止条件时停止流程

**错误处理**：
- 背景任务超时（>10min）→ 标记为 TIMEOUT，输出部分结果并终止
- 背景任务失败（subagent 错误）→ 重试 1 次，仍失败则输出错误报告并终止

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

## Output Format (MANDATORY)

**Single 模式简化输出**: 当 single reviewer 模式（非 Multi-Expert）时，可使用简化输出格式：
- verdict + confidence + issues_list（合并 critical/major/minor）+ summary
- 完整 JSON 格式保留用于 multi-expert 多轮评审场景

**Single 模式简化模板**:
```
[DelphiReview] verdict=APPROVED | REQUEST_CHANGES | BLOCKED
confidence=N/10
issues=[critical: N, major: N, minor: N]
summary: [1-2 sentence verdict summary]
```

**⚠️ Single vs Multi-Expert Output**:
- **Multi-Expert Mode (default)**: MUST use the full JSON schema below. Each expert outputs independently; the orchestrator aggregates into `consensus_report`. DO NOT use the simplified template.
- **Single Reviewer Mode** (explicitly invoked with `--single`): MAY use the simplified text template above.
- **Never mix formats**. If you are one of multiple experts in the same round, output JSON only.

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

**Anti-patterns mapping:**
- `Round 1 → "评审完成"` → MUST NOT have `verdict: APPROVED` if `critical_issues` exist
- `只处理 Critical，忽略 Major` → MUST include `major_concerns` array
- `用户说"时间紧急"就跳过` → MUST include `round` field proving multi-round process

---

## Terminal State Checklist

- [ ] Phase 0 完成（文档验证 + 专家分配）
- [ ] Round 1-3 完成（所有专家评审）
- [ ] 问题共识比例 >=90%
- [ ] 所有 Critical Issues 已解决，Major Concerns 已处理
- [ ] 最终裁决是 **APPROVED** 或 **APPROVED_WITH_MINOR**
- [ ] 共识报告生成并保存
- [ ] IF REQUEST_CHANGES → 已修复 → 已重新评审 → APPROVED
- [ ] ⭐ **IF APPROVED (design mode): 生成 specification.yaml**（自动或用户确认后）
- [ ] ⭐ **状态文件**: 写入 `.sprint-state/delphi-reviewed.json`（`verdict`, `consensus_ratio`, `timestamp`）
- [ ] **Code-walkthrough mode**: 写入 `.code-walkthrough-result.json`（commit hash 匹配 HEAD）

**IF REQUEST_CHANGES/REJECTED → CANNOT claim complete**
**IF 任何条件未满足 → MUST BLOCK**

### 状态文件格式

**Design mode APPROVED** → `.sprint-state/delphi-reviewed.json`:
```json
{"mode":"design","timestamp":"...","verdict":"APPROVED","consensus_ratio":1.0,"specification_path":".sprint-state/phase-outputs/specification.yaml"}
```

**Code-walkthrough mode APPROVED** → `.sprint-state/delphi-reviewed.json`:
```json
{"mode":"code-walkthrough","commit":"abc123...","timestamp":"...","verdict":"APPROVED","consensus_ratio":1.0}
```

> Phase 2 BUILD 入口检查 (DELPHI-GATE) 读取此文件。`verdict != "APPROVED"` → 禁止编码。

---

## Anti-Patterns

| ❌ 错误 | ✅ 正确 |
|---------|---------|
| Round 1 未 APPROVED 就"评审完成" | 迭代直到 APPROVED，修复后重新评审 |
| 只处理 Critical，忽略 Major | 零容忍：Critical/Major 全部必须处理 |
| 单专家自评 | 至少 2 位不同 provider 的专家 |
| 用户说"时间紧急"就跳过 | 评审是投资不是开销 |
| "专家几乎一致"就通过 | "几乎" = 不一致，继续到 >=90% |
| 使用 Anthropic/GPT/Gemini | 必须使用国产开源模型 |
| 三个专家同一厂家 | 必须来自至少 2 家不同厂家 |

**Code-walkthrough 专属 Anti-Patterns** → 详见 `references/code-walkthrough.md`

---

## Red Flags

### 检测触发器（模型可执行检测）

| 用户输入模式 | 触发词 | 响应动作 |
|-------------|--------|---------|
| 要求跳过评审 | "skip review", "不用评审", "跳过评审", "直接提交", "不评审" | → 提醒: `[DelphiReview] 评审是投资而非开销。Delphi 设计要求多轮共识(>=90%)，不可快速跳过。` |
| 时间压力 | "来不及", "时间紧", "emergency", "赶时间", "deadline" | → 提醒: `[DelphiReview] 时间紧迫正是需要评审的时刻。跳过评审省 30 分钟，后期修复可能花 3 天。` |
| 提前终止 | Round 1 后用户说 "可以了", "够了", "enough" | → BLOCK: `[DelphiReview:BLOCKED] 评审未达终止条件。仍需 [共识>=90% + 所有 Critical/Major 已处理]。` |
| 单专家自评 | 用户仅指定 1 个专家 或 说 "我自己看了" | → 提醒: `[DelphiReview] 至少需要 2 位不同 provider 的专家参与评审。` |
| 无文档输入 | 仅触发词，无设计/代码内容 | → 输出 `[DelphiReview:BLOCKED]` 阻断响应（见 Step 0） |

### 原则性声明

| 借口 | 现实 |
|------|------|
| "这只是小变更" | 所有变更都需要评审 |
| "Round 1 就够了" | 不够，必须多轮直到共识 |
| "生成报告就完成了" | APPROVED 才算完成 |
| "2/3 同意就是共识" | 还要检查问题共识比例 >=90% |

---

## 成功标准

1. ✅ 所有专家裁决 APPROVED
2. ✅ 问题共识 >=90%
3. ✅ 所有 Critical Issues 已修复验证 + Major Concerns 已处理
4. ✅ 共识报告已生成，用户已确认
5. ✅ 状态文件已写入

**缺少任何一项 = 未完成**
