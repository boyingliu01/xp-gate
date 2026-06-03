# Qoder Multi-Model Review Guide for Delphi Review

**Version:** v0.6.0  
**Platform:** Qoder IDE  
**Status:** Active

---

## 1. Overview

Delphi Review requires multi-expert anonymous consensus review using at least 2 different LLM providers. In Qoder, this is achieved through Agent subagent dispatch, leveraging Qoder's built-in multi-model capability.

---

## 2. Expert Configuration

### 2.1 Configuration File

Create `.qoder/delphi-config.json` in project root:

```json
{
  "experts": {
    "A": {
      "role": "architecture",
      "focus": "System design, scalability, maintainability, SOLID principles",
      "model_hint": "deepseek-v4-pro"
    },
    "B": {
      "role": "implementation",
      "focus": "Code quality, testing strategy, error handling, performance",
      "model_hint": "kimi-k2.6"
    },
    "C": {
      "role": "feasibility",
      "focus": "Practical constraints, timeline, team capability, risk assessment",
      "model_hint": "qwen3.6-plus"
    }
  },
  "consensus_threshold": 0.95,
  "max_rounds": 5,
  "providers_required": 2
}
```

### 2.2 Model Selection Rules

- Experts MUST come from **at least 2 different providers**
- **Forbidden**: Anthropic, OpenAI, Google (foreign models)
- **Recommended domestic providers**: DeepSeek, Qwen (Alibaba), Kimi (Moonshot), GLM (Zhipu), MiniMax

---

## 3. Execution Flow in Qoder

### 3.1 Round 1: Independent Anonymous Review

For each expert, dispatch an Agent subagent with the expert's specific prompt:

**Expert A (Architecture) — plan-agent**:
```
Agent(subagent_type="plan-agent", prompt="""
You are Expert A in a Delphi consensus review. Your role: Architecture Reviewer.
Focus: System design, scalability, maintainability, SOLID principles.

Review the following design/code and provide your assessment:
[REVIEW MATERIAL]

Output format:
{
  "expert_id": "A",
  "verdict": "APPROVED|REQUEST_CHANGES|REJECTED",
  "issues": [...],
  "strengths": [...],
  "suggestions": [...]
}
""")
```

**Expert B (Implementation) — CodeReview subagent**:
```
Agent(subagent_type="CodeReview", prompt="""
You are Expert B in a Delphi consensus review. Your role: Implementation Reviewer.
Focus: Code quality, testing strategy, error handling, performance.

Review the following code changes:
[CHANGED FILES]
""")
```

**Expert C (Feasibility) — plan-agent**:
```
Agent(subagent_type="plan-agent", prompt="""
You are Expert C in a Delphi consensus review. Your role: Feasibility Arbiter.
Focus: Practical constraints, timeline, team capability, risk assessment.

Review the following design/code and provide your assessment:
[REVIEW MATERIAL]

Output format:
{
  "expert_id": "C",
  "verdict": "APPROVED|REQUEST_CHANGES|REJECTED",
  ...
}
""")
```

### 3.2 Consensus Aggregation

After all experts respond:
1. Parse each expert's JSON output
2. Compare verdicts:
   - All APPROVED → **Consensus: APPROVED**
   - All REQUEST_CHANGES → Merge issues, present to user
   - Mixed verdicts → **No consensus**, proceed to Round 2
3. Calculate issue consensus ratio: issues agreed by ≥95% of experts → resolved

### 3.3 Round 2+: Controlled Feedback

In subsequent rounds, each expert receives other experts' anonymized opinions:
```
Agent(subagent_type="plan-agent", prompt="""
You are Expert A. In Round 1, your verdict was: REQUEST_CHANGES.
Other experts' anonymized feedback:
- Expert X: APPROVED, noted [strengths]
- Expert Y: REQUEST_CHANGES, noted [issues]

Review your assessment in light of others' feedback. Maintain your independence.
[REVIEW MATERIAL]
""")
```

### 3.4 Terminal States

| Condition | Action |
|-----------|--------|
| All experts APPROVED + ≥95% issue consensus | **APPROVED** — write `.sprint-state/delphi-reviewed.json` |
| Max rounds reached without consensus | **REJECTED** — present disagreement summary |
| Any expert REJECTED with critical issues | **REQUEST_CHANGES** — user must fix and re-review |

---

## 4. Degraded Mode

When multi-model subagent dispatch is unavailable:

### 4.1 Single-Model Multi-Role Mode

The orchestrator plays all expert roles sequentially with different prompts:

```
⚠️ [DEGRADED] 单模型多角色模式
失去跨 provider 匿名性保护，但保留多视角评审结构。
建议：在条件允许时恢复多模型模式重新评审。
```

### 4.2 Degraded Output Format

```json
{
  "mode": "design",
  "verdict": "APPROVED",
  "degraded": true,
  "degradation_reason": "Multi-model subagent unavailable",
  "experts": ["A", "B", "C"],
  "model": "single"
}
```

---

## 5. Integration with Sprint Flow

### 5.1 Phase 1 (Design Review)

- Default: 2 experts (A + B)
- Complex designs: 3 experts (A + B + C)
- Output: `.sprint-state/delphi-reviewed.json` + `specification.yaml`

### 5.2 Phase 3 (Code Walkthrough)

- Default: 2 experts (A + B)
- Use `CodeReview` subagent for Expert B
- Output: `.code-walkthrough-result.json`

### 5.3 HARD-GATE Enforcement

- Phase 2 BUILD cannot start until delphi-review verdict is APPROVED
- In Qoder: Pre-Edit Gate checks `.sprint-state/delphi-reviewed.json`
- See sprint-flow SKILL.md for Pre-Edit Gate details
