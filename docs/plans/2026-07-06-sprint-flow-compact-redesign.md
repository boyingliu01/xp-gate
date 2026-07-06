# Sprint Flow Compact Redesign: 11-Phase → 6-Phase

**Date**: 2026-07-06
**Issue**: #290
**Status**: RFC (needs approval before implementation)

## Motivation

Current Sprint Flow has 11 phases (-1, -0.5, 0, 1, 2, 3, 4, 5, 6, 7, 8). User feedback:

> "流程比较长，要经历11个环节，导致我经常想不起来当前执行到哪个环节了。"

Previous fix (#289) only fixed Phase ordering consistency; #272 identified the same "step adherence 65%" issue but was never truly resolved.

## Goals

1. **6 phases max** — reduce cognitive load from 11 to ≤6
2. **Affordance naming** — each phase name tells you what ACTION it produces
3. **Progress visibility** — every phase transition prints `Phase X/N: doing Y → next: Z`
4. **No capability loss** — compact ≠ crippled. All functionality preserved, some auto-skipped
5. **Backward compatible sprint-state.json** — existing state files parseable

## Proposed 6-Phase Structure

| # | Name | Maps From (current) | Key Action | Auto-Skip Rule |
|---|------|---------------------|------------|----------------|
| 1 | **PREP** | -1 ISOLATE + -0.5 AUTO-ESTIMATE | Worktree isolation + sizing | `--no-isolate` or root fix branch |
| 2 | **DESIGN** | 0 THINK + 1 PLAN | Brainstorming → autoplan → Delphi consensus | `--spec <file>` already exists |
| 3 | **BUILD** | 2 BUILD (unchanged) | ralph-loop + TDD + test-align | — (always runs) |
| 4 | **VERIFY** | 3 REVIEW + 4 FEEDBACK | Code-walkthrough + QA + retro + learn | Lightweight changes skip QA/benchmark |
| 5 | **SHIP** | 5 SHIP + 6 LAND | PR → squash-merge → deploy → canary | No deploy target → skip LAND |
| 6 | **CLOSE** | 7 USER ACCEPT + 8 CLEANUP | Manual UAT → emergent issues → cleanup | — (HARD-GATE: UAT mandatory) |

### Why These Mergers

| Merger | Rationale |
|--------|-----------|
| -1 + -0.5 → **PREP** | Both are setup with no user-facing output. ISOLATE (worktree) + ESTIMATE (sizing) together → "ready to design". |
| 0 + 1 → **DESIGN** | THINK → PLAN is a conceptual unit: "explore then validate". The HARD-GATE (Delphi consensus) is internal to this phase. |
| 3 + 4 → **VERIFY** | REVIEW (code-walkthrough) → FEEDBACK (retro/learn) are both "post-build analysis". Feedback is retro, not a separate ship. |
| 5 + 6 → **SHIP** | SHIP → LAND is one user-facing action: "get code to production". PR creation → merge → deploy → canary is a single workflow. |
| 7 + 8 → **CLOSE** | UAT → CLEANUP is the hand-off: "user says OK → clean up". UAT is the HARD-GATE; cleanup is automatic after approval. |

## Progress Visibility

Every phase transition MUST print:

```
┌─────────────────────────────────────────────┐
│  Sprint Flow                     2026-07-06 │
├─────────────────────────────────────────────┤
│  Phase 1/6: PREP        ← worktree+sizing   │
│  Phase 2/6: DESIGN      ← brainstorming     │
│  Phase 3/6: BUILD       → ralph-loop (now)  │
│  Phase 4/6: VERIFY      ← review+test       │
│  Phase 5/6: SHIP        ← PR+deploy         │
│  Phase 6/6: CLOSE       ← UAT+cleanup       │
│                                             │
│  Next: Phase 4: VERIFY                      │
└─────────────────────────────────────────────┘
```

Implementation: `sprint-state.json` already tracks current phase + history. The render just needs to read it and print the dashboard. The `sprint-progress-template.md` already exists — just needs the compact phase names.

## Key Design Decisions

### Decision 1: HARD-GATE stays between DESIGN → BUILD

The Delphi gate (Phase 1→2 in current, Phase 2→3 in new) is the most important guardrail. **Must keep.** The redesign hides it as an internal check within the DESIGN phase, not a separate phase.

### Decision 2: UAT is Phase 6/6, same HARD-GATE as before

USER ACCEPTANCE is mandatory manual — cannot be automated. By putting it last (CLOSE), the user always knows "after CLOSE, the sprint is done".

### Decision 3: CLI params unchanged

All current `--stop-at`, `--resume-from`, `--phase` params keep working — they map to the new phase names internally. Legacy params (e.g., `--stop-at think`) map to their new equivalent (e.g., `design`). **Backward compatible.**

### Decision 4: Phase output format

New mandatory format:

```markdown
## Phase 1/6: PREP (准备工作)
## Phase 2/6: DESIGN (设计)
## Phase 3/6: BUILD (构建)
## Phase 4/6: VERIFY (验证)
## Phase 5/6: SHIP (发布)
## Phase 6/6: CLOSE (收尾)
```

First line on trigger:
```
Sprint Flow: PREP → DESIGN → BUILD → VERIFY → SHIP → CLOSE
```

## Implementation Plan

### Phase 1: SKILL.md + References Update

| File | Change |
|------|--------|
| `skills/sprint-flow/SKILL.md` | Replace all 11-phase references with 6-phase structure |
| `skills/sprint-flow/references/phase-*-*.md` | Merge: create `phase-1-prep.md` (from -1 + -0.5), `phase-2-design.md` (from 0 + 1), `phase-4-verify.md` (from 3 + 4), `phase-5-ship.md` (from 5 + 6), `phase-6-close.md` (from 7 + 8) |
| `skills/sprint-flow/references/phase-2-build.md` | Keep as-is (BUILD unchanged) |
| `skills/sprint-flow/references/force-levels.md` | Update phase names |
| `skills/sprint-flow/references/components/` | Update if referencing phase numbers |
| `skills/sprint-flow/templates/` | Update phase name references |

### Phase 2: sprint-state.json Schema

Current:
```json
{
  "currentPhase": "build",
  "history": [
    {"phase": "isolate", "status": "completed"},
    {"phase": "auto-estimate", "status": "completed"},
    ...
  ]
}
```

New (`phase` values mapped to new names):
```json
{
  "currentPhase": "build",
  "history": [
    {"phase": "prep", "status": "completed"},
    {"phase": "design", "status": "completed"},
    ...
  ]
}
```

**Backward compat**: If `sprint-state.json` uses old phase names, the dashboard renders them as-is. No breakage.

### Phase 3: Mirrors + Docs

| File | Change |
|------|--------|
| `plugins/claude-code/skills/sprint-flow/SKILL.md` | Copy from canonical |
| `plugins/opencode/skills/sprint-flow/SKILL.md` | Copy from canonical |
| `plugins/qoder/skills/sprint-flow/SKILL.md` | Copy from canonical |
| `src/npm-package/skills/sprint-flow/SKILL.md` | Copy from canonical |
| `README.md` | Update 11-phase → 6-phase diagram |
| `CAPABILITIES.md` | Update |
| Root `AGENTS.md` | Update Sprint Flow section |

## Migration Path

Old sprint-state.json files remain readable. The `sprint-status` command renders whatever phases it finds. If a mid-sprint upgrade happens, the user resumes with old phase names but the dashboard still works.

## Risks

| Risk | Mitigation |
|------|------------|
| Users accustomed to "Phase -1" naming get confused | Phase output includes both: `## Phase 1/6: PREP (isolate + sizing)` |
| Auto-skip rule is too aggressive (skips things user wanted) | Print skip reason: `⏭️  SKIP: VERIFY QA (--lightweight)` |
| Emergent requirement capture gets lost | CLOSE phase still has explicit UAT with emergent issues template |

## Open Questions

1. Should `--stop-at` and `--resume-from` accept both old and new phase names for transition? (Proposal: yes, map via lookup table)
2. Should `--phase` param values also accept old names? (Proposal: yes, same lookup)

## Next Steps

1. ✅ Review this design document (you are here)
2. Update `skills/sprint-flow/SKILL.md` with new 6-phase structure
3. Update reference files (create merged phase docs, keep `phase-2-build.md`)
4. Update `sprint-state.json` schema
5. Update mirror copies
6. Update README + CAPABILITIES.md + AGENTS.md
