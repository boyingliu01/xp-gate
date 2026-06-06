# SKILLS/SPRINT-FLOW KNOWLEDGE BASE

**Generated:** 2026-05-30
**Version:** v0.5.1

## OVERVIEW
7-phase development pipeline: THINK→PLAN→BUILD→REVIEW→USER ACCEPT→FEEDBACK→SHIP, with ralph-loop default build mode.

## STRUCTURE
```
skills/sprint-flow/
├── SKILL.md              # 7-phase pipeline definition
├── evals/                # Evaluation test cases
├── evolution-history.json # Skill evolution tracking
├── evolution-log.md      # Change history
├── references/           # Phase reference docs
│   ├── phase-0-think.md  # THINK phase guidelines
│   └── ...               # Other phase docs
└── templates/            # Sprint templates
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Pipeline def | SKILL.md | 7 phases with hard gates |
| THINK phase | references/phase-0-think.md | brainstorming → CONTEXT.md + ADR |
| Build mode | SKILL.md | ralph-loop (default) vs parallel |

## 7 PHASES
| Phase | Name | Key Action | Hard Gate |
|-------|------|-----------|-----------|
| 0 | THINK | brainstorming, CONTEXT.md, ADR | — |
| 1 | PLAN | autoplan → delphi-review → specification.yaml | HARD-GATE: design must pass |
| 2 | BUILD | ralph-loop (REQ-level iteration) + TDD + test-align | — |
| 3 | REVIEW | code-walkthrough + QA + benchmark | — |
| 4 | USER ACCEPT | Manual verification | — |
| 5 | FEEDBACK | Retro + debugging + learn | — |
| 6 | SHIP | finishing-dev-branch + PR/merge | — |

## CONVENTIONS
- ralph-loop is Phase 2 **default** mode (saves 40-67% tokens vs parallel)
- delphi-review HARD-GATE in Phase 1: design unapproved → BLOCK coding
- Each REQ in ralph-loop gets clean context (no linear accumulation)
- `learn` called at Phase 5 + each REQ completion

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT skip delphi-review in Phase 1 — HARD-GATE blocks implementation
- Do NOT use parallel build mode unless explicitly requested
- Do NOT enter Phase 1 (PLAN) without completing THINK phase
- DO NOT implement before design approval

## UNIQUE STYLES
- Auto-detects UI framework (ui-detector.ts in npm-package/lib/)
- Supports --type and --lang flags for tech stack selection
- Phase isolation: each phase has specific entry/exit criteria
- Emergent Requirements acknowledged: user acceptance phase built in

## COMMANDS
```bash
/delphi-review "开发用户登录" --type web-nextjs --lang typescript
/sprint-flow "开发用户登录" --phase build-only
/sprint-flow "开发用户登录" --mode parallel  # Legacy all-at-once
```

## NOTES
- Integrates brainstorming, autoplan, delphi-review, TDD, test-specification-alignment
- ralph-loop internal learnings via progress.log (permanent/contextual classification)
- Phase 5 calls gstack/learn for Sprint-level retrospective
