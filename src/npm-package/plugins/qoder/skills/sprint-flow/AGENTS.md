# SKILLS/SPRINT-FLOW KNOWLEDGE BASE

**Generated:** 2026-07-21
**Commit:** dd0d7fc
**Branch:** main
**Version:** 0.14.20.0

## OVERVIEW
**6-phase** development pipeline (v2.0 compact redesign, Issue #290): PREP → DESIGN → BUILD → VERIFY → SHIP → CLOSE. Phase 3/6 BUILD default build mode is **ralph-loop** (REQ-level iteration, 40-67% token savings vs parallel). HARD-GATE between DESIGN (2/6) and BUILD (3/6): design must pass Delphi review (≥90% consensus) before any coding.

> **v2.0 Compact Redesign (Issue #290)**: Merged from 11 phases to 6. PREP = old ISOLATE + AUTO-ESTIMATE. DESIGN = old THINK + PLAN. BUILD = old BUILD. VERIFY = old REVIEW + FEEDBACK. SHIP = old SHIP + LAND. CLOSE = old USER ACCEPTANCE + CLEANUP.

## STRUCTURE
```
skills/sprint-flow/
├── SKILL.md              # 6-phase pipeline definition (canonical, v2.0)
├── AGENTS.md             # This file (mirrored to 7 other locations — DO NOT edit mirrors)
├── evals/                # Evaluation test cases
├── evolution-history.json
├── evolution-log.md
├── references/
│   ├── phase-1-prep.md                    # Phase 1/6: PREP (worktree isolation + sizing)
│   ├── phase-2-design.md                  # Phase 2/6: DESIGN (brainstorming + delphi-review HARD-GATE)
│   ├── phase-3-build.md                   # Phase 3/6: BUILD (ralph-loop default + TDD + test-align)
│   ├── phase-4-verify.md                  # Phase 4/6: VERIFY (code-walkthrough + QA + feedback)
│   ├── phase-5-ship.md                    # Phase 5/6: SHIP (PR + merge + deploy + canary)
│   ├── phase-6-close.md                   # Phase 6/6: CLOSE (UAT + cleanup)
│   ├── force-levels.md                    # Phase forcing rules
│   ├── orchestration-rules.md             # Agent dispatch, context inheritance, transition rules
│   └── components/                        # Reusable phase building blocks
└── templates/
    ├── auto-estimate-output-template.md
    ├── auto-estimate-learning-log.md
    ├── pain-document-template.md
    ├── sprint-progress-template.md
    ├── sprint-summary-template.md
    └── emergent-issues-template.md
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Pipeline definition | SKILL.md | 6 phases with HARD-GATE between DESIGN (2/6) and BUILD (3/6) |
| PREP phase | references/phase-1-prep.md | worktree isolation + sizing pass |
| DESIGN phase + HARD-GATE | references/phase-2-design.md | brainstorming + autoplan + delphi-review → specification.yaml |
| BUILD phase | references/phase-3-build.md | ralph-loop (default) vs parallel |
| VERIFY phase | references/phase-4-verify.md | code-walkthrough + QA + retro + learn |
| SHIP phase | references/phase-5-ship.md | PR + merge + deploy + canary |
| CLOSE phase | references/phase-6-close.md | UAT + cleanup |
| Force-level rules | references/force-levels.md | Defines when each phase becomes mandatory |
| Orchestration rules | references/orchestration-rules.md | Agent dispatch, context inheritance, transition gates |
| Templates | templates/ | Auto-estimate, sprint progress/summary, pain doc, emergent issues |

## THE 6 PHASES (v2.0)

| Phase | Name | Maps From (old 11) | Key Action | Hard Gate |
|-------|------|-------------------|------------|-----------|
| 1/6 | PREP | ISOLATE + AUTO-ESTIMATE | Worktree isolation + sizing | — |
| 2/6 | DESIGN | THINK + PLAN | brainstorming → autoplan → Delphi consensus | **HARD-GATE**: design must reach ≥90% Delphi consensus |
| 3/6 | BUILD | BUILD | ralph-loop (default) + TDD + test-spec-alignment | — |
| 4/6 | VERIFY | REVIEW + FEEDBACK | code-walkthrough + QA + retro + learn | HARD-GATE: feedback-log.md must exist |
| 5/6 | SHIP | SHIP + LAND | PR → squash-merge → deploy → canary | — |
| 6/6 | CLOSE | USER ACCEPT + CLEANUP | Manual UAT → emergent issues → cleanup | HARD-GATE: UAT mandatory manual |

## CONVENTIONS
- **ralph-loop is Phase 3/6 BUILD default**. Each REQ runs in a clean context, saving 40-67% tokens.
- **delphi-review HARD-GATE in Phase 2/6 DESIGN**: design must reach ≥90% consensus across ≥2 model providers, domestic models only. Unapproved → BLOCK coding.
- **`learn` is called twice**: once per REQ in Phase 3/6 (ralph-loop internal) and once in Phase 4/6 VERIFY (Sprint-level retro).
- **Phase isolation**: each phase has explicit entry/exit criteria documented in its `references/phase-*.md` file.
- **Emergent Requirements** discovered in Phase 6/6 CLOSE (USER ACCEPTANCE) are explicitly captured via `templates/emergent-issues-template.md` — never silently merged.
- **Auto-detection**: Phase 2/6 DESIGN uses `src/npm-package/lib/ui-detector.ts` to pick the right tech-stack templates.

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT skip `delphi-review` in Phase 2/6 DESIGN — HARD-GATE blocks implementation.
- Do NOT use parallel build mode unless explicitly requested. Ralph-loop is the default for a reason.
- Do NOT enter Phase 2/6 DESIGN (PLAN) without completing DESIGN (brainstorming).
- Do NOT implement before design is APPROVED — Phase 2/6 DESIGN must reach Delphi consensus first.
- Do NOT merge an Emergent Requirement into the original Sprint silently — capture it via the template in Phase 6/6 CLOSE.
- Do NOT terminate Delphi review before ≥90% consensus or 5 rounds, whichever first.

## UNIQUE STYLES
- **6 phases** (v2.0 Issue #290) — compact design with merged phases (1-6 numbering)
- **HARD-GATE** between DESIGN and BUILD enforced both in SKILL.md and Claude Code plugin's PreToolUse hook.
- **Per-REQ clean context in ralph-loop** = the core efficiency mechanism.
- **Tech-stack auto-detection** via `--type` and `--lang` flags or `ui-detector.ts`.

## COMMANDS
```bash
/sprint-flow "开发用户登录"                                     # Full 6-phase pipeline
/sprint-flow "开发用户登录" --type web-nextjs --lang typescript # Pin tech stack
/sprint-flow "开发用户登录" --phase build-only                  # Skip design (advanced)
/sprint-flow "开发用户登录" --mode parallel                     # Legacy all-at-once (NOT default)
/sprint-flow "开发用户登录" --stop-at design                    # Stop after DESIGN phase
/delphi-review "开发用户登录" --type web-nextjs --lang typescript
```

## NOTES
- Integrates: brainstorming, autoplan, delphi-review, TDD, test-specification-alignment, qa, design-review, benchmark, systematic-debugging, retro, learn, finishing-a-development-branch, land-and-deploy.
- ralph-loop's internal learnings are persisted via `progress.log` (permanent vs contextual classification).
- Phase 4/6 VERIFY calls `gstack/learn` for Sprint-level retrospective.
- Phase 6/6 CLOSE cleanup behavior is governed by `docs/plans/2026-06-06-sprint-branch-cleanup-design.md`.
- This `AGENTS.md` is the canonical version. **7 byte-identical mirrors** exist.
  Mirrors are updated by `scripts/copy-skills.sh`. Do NOT edit them by hand.
