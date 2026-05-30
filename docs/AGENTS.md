# DOCUMENTATION KNOWLEDGE BASE

**Generated:** 2026-05-30
**Version:** v0.5.1

## OVERVIEW
Reference guides, design history, and plan docs for XP-Gate project. 30+ design plans archived chronologically.

## STRUCTURE
```
docs/
├── plans/               # 30+ design docs (YYYY-MM-DD-topic.md format)
│   ├── 2026-04-05-delphi-final-consensus-report-xp-12-practices.md
│   ├── 2026-04-05-xp-12-practices-instantiation-plan.md
│   ├── 2026-04-09-v0.0.2-implementation-plan.md
│   ├── 2026-04-12-clean-code-solid-checker-design.md
│   ├── 2026-04-13-quality-gate-enhancement-design.md
│   ├── 2026-04-14-skill-consolidation-design.md
│   ├── 2026-05-04-mutation-testing-gate10.md
│   ├── 2026-05-16-gate8-mutation-testing-precommit.md
│   └── ...              # 30+ total, sorted chronologically
├── skill-validation/    # Skill validation framework docs
│   ├── validation-framework.md
│   ├── validation-methodology.md
│   └── eval-cases/      # Evaluation cases with evals.json
├── gate-validation-guide.md
├── MULTI-MODEL-REVIEW-GUIDE.md
├── performance-benchmark.md
├── principlesrc-configuration.md
├── rename-guide.md
├── skill-validation-framework.md
└── skill-validation-methodology-landscape.md
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Design history | docs/plans/ (sorted by date, oldest to newest) |
| Gate validation | gate-validation-guide.md |
| Multi-model review process | MULTI-MODEL-REVIEW-GUIDE.md |
| Performance data | performance-benchmark.md |
| Principles config | principlesrc-configuration.md |
| Skill validation | skill-validation/ |

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT mix code and documentation changes
- Do NOT create docs-only commits that bypass tests

## NOTES
- Plan docs follow format: `YYYY-MM-DD-topic.md`
- 30+ design decisions archived in docs/plans/
- Historical v0.0.2 documents archived
- Each plan doc corresponds to a Delphi consensus report or implementation plan
