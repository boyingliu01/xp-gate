---
name: delphi-review
description: "Use when asked to review a design, plan, or architecture; before implementation starts; or when multi-expert consensus is needed. Triggers: 'review this design', '评审这个需求', 'design review', '多专家评审', 'consensus review', 'code walkthrough', 'push review', 'architecture review', 'PR review', or any request for multi-expert evaluation of requirements, design docs, or PRs."
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

### 模型选择策略（强制）

**MUST 使用国产开源模型**，**严禁** Anthropic/GPT/Gemini 等国外模型。

| 厂家 | 可用模型 |
|------|---------|
| 深度求索 DeepSeek | `deepseek-v4-pro`, `deepseek-v4-lite` |
| 月之暗面 Kimi | `kimi-k2.6`, `kimi-k2.5` |
| 阿里 Qwen | `qwen3.6-plus`, `qwen3.5-plus` |
| 智谱 GLM | `glm-5.1`, `glm-5.0` |
| MiniMax | `minimax-m2.7`, `minimax-m2.5` |

**关键原则**：
- ✅ 三个专家必须来自 **至少 2 家不同厂家**
- ❌ 禁止使用 Anthropic、OpenAI、Google 等国外模型
- ❌ 禁止三个专家全部使用同一厂家模型

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

**Round 模板**（匿名评审/交换意见/最终立场/修复报告格式）→ 详见 `references/round-templates.md`

**Orchestrator 自动调度规则**（#218 subagent 内部自动多轮循环）→ 详见 `references/orchestrator-dispatch.md`

**Automatic re-review**: 对于常见可控问题（措辞模糊、AC 缺失、格式问题），subagent 应自行修复后自动重评审，无需等待用户。

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

| 借口 | 现实 |
|------|------|
| "这只是小变更" | 所有变更都需要评审 |
| "Round 1 就够了" | 不够，必须多轮直到共识 |
| "2/3 同意就是共识" | 还要检查问题共识比例 >=90% |

---

## 成功标准

1. ✅ 所有专家裁决 APPROVED
2. ✅ 问题共识 >=90%
3. ✅ 所有 Critical Issues 已修复验证 + Major Concerns 已处理
4. ✅ 共识报告已生成，用户已确认
5. ✅ 状态文件已写入

**缺少任何一项 = 未完成**
