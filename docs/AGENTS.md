# DOCUMENTATION KNOWLEDGE BASE

**Version:** 0.0.6

## OVERVIEW
Reference guides and design history for XGate project.

## STRUCTURE
```
docs/
├── plans/               # Design documents and consensus reports (by date)
├── skill-validation/    # Skill validation framework docs
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
- Historical v0.0.2 documents archived in docs/plans/
