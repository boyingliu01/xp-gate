# SKILLS/SPRINT-FLOW KNOWLEDGE BASE

**Generated:** 2026-06-17
**Commit:** 673e8cb
**Branch:** fix/qoder-compat-227-228-229
**Version:** 0.8.20.0

## OVERVIEW
**11-phase** development pipeline: ISOLATE → AUTO-ESTIMATE → THINK → PLAN → BUILD → REVIEW → USER ACCEPTANCE → FEEDBACK → SHIP → LAND → CLEANUP. Phase 2 default build mode is **ralph-loop** (REQ-level iteration, 40-67% token savings vs parallel). HARD-GATE in Phase 1: design must pass Delphi review (≥90% consensus) before any coding.

> **Doc drift**: README/CAPABILITIES still describe a "7-phase" pipeline. The canonical 11-phase model lives in `SKILL.md` and is what actually executes. See root `AGENTS.md` → "Known Drift" #4.

## STRUCTURE
```
skills/sprint-flow/
├── SKILL.md              # 11-phase pipeline definition (canonical)
├── AGENTS.md             # This file (mirrored to 7 other locations — DO NOT edit mirrors)
├── evals/                # Evaluation test cases
├── evolution-history.json
├── evolution-log.md
├── references/
│   ├── phase-minus-0-5-auto-estimate.md  # Phase -0.5: AUTO-ESTIMATE
│   ├── phase-0-think.md                   # Phase 0: brainstorming → CONTEXT.md + ADR
│   ├── phase-1-plan.md                    # Phase 1: autoplan + delphi-review (HARD-GATE)
│   ├── phase-2-build.md                   # Phase 2: ralph-loop default + TDD + test-align
│   ├── phase-3-review.md                  # Phase 3: code-walkthrough + QA + benchmark
│   ├── phase-4-uat.md                     # Phase 4: USER ACCEPTANCE
│   ├── phase-5-feedback.md                # Phase 5: retro + debugging + learn
│   ├── phase-6-ship.md                    # Phase 6: finishing-dev-branch + PR
│   ├── phase-7-land.md                    # Phase 7: land + deploy
│   ├── phase-8-cleanup.md                 # Phase 8: sprint branch cleanup
│   ├── force-levels.md                    # Phase forcing rules
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
| Pipeline definition | SKILL.md | 11 phases with HARD-GATE between Phase 1 and Phase 2 |
| Auto-estimate phase | references/phase-minus-0-5-auto-estimate.md | Sizing pass before THINK |
| THINK phase | references/phase-0-think.md | brainstorming → CONTEXT.md + ADR |
| PLAN phase + HARD-GATE | references/phase-1-plan.md | autoplan → delphi-review → specification.yaml |
| BUILD phase | references/phase-2-build.md | ralph-loop (default) vs parallel |
| Force-level rules | references/force-levels.md | Defines when each phase becomes mandatory |
| Templates | templates/ | Auto-estimate, sprint progress/summary, pain doc, emergent issues |

## THE 11 PHASES

| Phase | Name | Key Action | Hard Gate |
|-------|------|-----------|-----------|
| -1 | ISOLATE | Isolate working tree / worktree creation | — |
| -0.5 | AUTO-ESTIMATE | Sizing pass; emits estimate template | — |
| 0 | THINK | brainstorming → CONTEXT.md + ADR | — |
| 1 | PLAN | autoplan → delphi-review → specification.yaml | **HARD-GATE**: design must reach ≥90% Delphi consensus |
| 2 | BUILD | ralph-loop (REQ-level, default) + TDD + test-spec-alignment | — |
| 3 | REVIEW | code-walkthrough + QA + benchmark | — |
| 4 | USER ACCEPTANCE | Manual verification | — |
| 5 | FEEDBACK | retro + debugging + `learn` (Sprint-level) | — |
| 6 | SHIP | finishing-a-development-branch → PR | — |
| 7 | LAND | land + deploy + canary | — |
| 8 | CLEANUP | Sprint branch cleanup (per `docs/plans/2026-06-06-sprint-branch-cleanup-design.md`) | — |

## CONVENTIONS
- **ralph-loop is Phase 2 default**. Each REQ runs in a clean context (no linear accumulation), saving 40-67% tokens vs parallel mode.
- **delphi-review HARD-GATE in Phase 1**: design must reach ≥90% consensus across ≥2 model providers, domestic models only. Unapproved → BLOCK coding.
- **`learn` is called twice**: once per REQ in Phase 2 (ralph-loop internal, `progress.log` permanent/contextual classification) and once in Phase 5 (Sprint-level retro).
- **Phase isolation**: each phase has explicit entry/exit criteria documented in its `references/phase-*.md` file.
- **Emergent Requirements** discovered in Phase 4 (USER ACCEPTANCE) are explicitly captured via `templates/emergent-issues-template.md` — never silently merged.
- **Auto-detection**: Phase 0 uses `src/npm-package/lib/ui-detector.ts` to pick the right tech-stack templates.

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT skip `delphi-review` in Phase 1 — HARD-GATE blocks implementation.
- Do NOT use parallel build mode unless explicitly requested. Ralph-loop is the default for a reason.
- Do NOT enter Phase 1 (PLAN) without completing Phase 0 (THINK).
- Do NOT implement before design is APPROVED — Phase 1 must reach Delphi consensus first.
- Do NOT merge an Emergent Requirement into the original Sprint silently — capture it via the template.
- Do NOT terminate Delphi review before ≥90% consensus or 5 rounds, whichever first.

## UNIQUE STYLES
- **11 phases** including negative-numbered pre-phases (-1, -0.5) — intentional, captures the work that happens before "real" coding starts.
- **HARD-GATE** between PLAN and BUILD is enforced both in the SKILL.md instructions and in the Claude Code plugin's PreToolUse hook (`plugins/claude-code/bin/delphi-review-guard.sh`).
- **Per-REQ clean context in ralph-loop** = the core efficiency mechanism. Sprint-flow specifically chooses this over parallel mode.
- **Tech-stack auto-detection** via `--type` and `--lang` flags or `ui-detector.ts`.

## COMMANDS
```bash
/sprint-flow "开发用户登录"                                     # Full 11-phase pipeline
/sprint-flow "开发用户登录" --type web-nextjs --lang typescript # Pin tech stack
/sprint-flow "开发用户登录" --phase build-only                  # Skip planning (advanced)
/sprint-flow "开发用户登录" --mode parallel                     # Legacy all-at-once (NOT default)
/delphi-review "开发用户登录" --type web-nextjs --lang typescript
```

## NOTES
- Integrates: brainstorming, autoplan, delphi-review, TDD, test-specification-alignment, qa, design-review, benchmark, systematic-debugging, retro, learn, finishing-a-development-branch.
- ralph-loop's internal learnings are persisted via `progress.log` (permanent vs contextual classification).
- Phase 5 calls `gstack/learn` for Sprint-level retrospective.
- Phase 8 cleanup behavior is governed by `docs/plans/2026-06-06-sprint-branch-cleanup-design.md`.
- This `AGENTS.md` is the canonical version. **7 byte-identical mirrors** exist at:
  - `plugins/claude-code/skills/sprint-flow/AGENTS.md`
  - `plugins/opencode/skills/sprint-flow/AGENTS.md`
  - `plugins/qoder/skills/sprint-flow/AGENTS.md`
  - `src/npm-package/skills/sprint-flow/AGENTS.md`
  - `src/npm-package/plugins/claude-code/skills/sprint-flow/AGENTS.md`
  - `src/npm-package/plugins/opencode/skills/sprint-flow/AGENTS.md`
  - `src/npm-package/plugins/qoder/skills/sprint-flow/AGENTS.md`
  Mirrors are updated by `scripts/copy-skills.sh`. Do NOT edit them by hand.

