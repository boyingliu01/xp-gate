# Replace cross-model-review with delphi code-walkthrough — Design

**Issue**: #26
**Date**: 2026-05-04
**Priority**: P0
**Status**: DESIGN

---

## Problem

Sprint-flow Phase 3 references `cross-model-review` — a skill that:
1. Is NOT installed in the project (not in `~/.claude/skills/gstack/` or opencode skills)
2. Would violate the domestic model policy (requires 2 different AI models, likely Anthropic/OpenAI)
3. Is functionally redundant with `delphi-review --mode code-walkthrough`

## Comparison

| Capability | cross-model-review | delphi code-walkthrough |
|-----------|-------------------|------------------------|
| Multi-model review | Requires 2 different AI models | 2-3 domestic models (DeepSeek/Kimi/Qwen) |
| Multi-round | Alternating writer/reviewer, max 8 rounds | Anonymous multi-round, >=91% consensus |
| Consensus | Binary agree/disagree | Statistical consensus (>=91%) |
| Anonymity | Not anonymous | Round 1 fully anonymous |
| Gate integration | None | ✅ pre-push `.code-walkthrough-result.json` |
| Domestic model compliance | ❌ Needs foreign models | ✅ Domestic-only enforced by policy |
| Cost | 2 foreign models × multi-round | 2-3 domestic models × multi-round |

## Decision

**Replace `cross-model-review` with `delphi-review --mode code-walkthrough` in sprint-flow Phase 3.**

Both provide multi-model adversarial review. Delphi code-walkthrough is superior:
- Already works with our domestic model policy (DeepSeek-v4-pro + Kimi-K2.6)
- Pre-push gate integration already exists (`.code-walkthrough-result.json`)
- Multi-round consensus mechanism is more rigorous than binary agree/disagree
- Anonymous Round 1 prevents anchoring bias

## What about codex challenge?

`codex challenge` provides single-pass adversarial review from a different perspective (GPT). It's complementary, not a replacement. Decision: **Do NOT add codex challenge to sprint-flow** because:
1. Requires OpenAI API key (not universally available)
2. Single-pass — no consensus mechanism
3. Delphi code-walkthrough already provides adversarial multi-round review
4. Would violate the domestic model policy if used as a mandatory gate

## Implementation

### Files to modify

1. `~/.config/opencode/skills/sprint-flow/SKILL.md` — Phase 3 line 56, 122-123
2. `~/.config/opencode/skills/sprint-flow/references/phase-3-review.md` — Complete rewrite of Step 1

### Phase 3 New Flow

```
Phase 3: REVIEW → delphi-review --mode code-walkthrough → test-specification-alignment → browse
```

Step 1 changes from:
```
cross-model-review (Alternating mode, max 8 rounds)
→ plan-final.md output
```
To:
```
delphi-review --mode code-walkthrough (2-3 domestic experts, >=91% consensus)
→ .code-walkthrough-result.json output
→ IF APPROVED → continue to test-specification-alignment
→ IF REQUEST_CHANGES → pause for user, fix issues, re-review
```
