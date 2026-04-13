# CODE REVIEWER SKILL

**Generated:** 2026-04-13
**Commit:** 281ee00

## OVERVIEW
Principles-aware code review combining Clean Code/SOLID analysis with AI-powered review. Outputs console + SARIF for IDE integration.

## STRUCTURE
```
skills/code-reviewer/
├── SKILL.md       # Core skill definition with Delphi workflow
└── AGENTS.md      # This file
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Skill Definition | SKILL.md | Full workflow + SARIF format spec |
| SARIF Implementation | src/principles/reporter.ts | formatSARIF() function |

## CONVENTIONS
- SARIF 2.1.0 schema for IDE/GitHub Actions compatibility
- Rule descriptions mapped in getRuleDescription()
- Severity levels: error, warning, note
- Performance metrics tracked in SKILL.md

## ANTI-PATTERNS
- Do NOT output generic advice - must be project-specific
- Do NOT repeat violations in summary if already in results
- Do NOT skip principles checker phase

## PERFORMANCE
| Metric | Target | Actual |
|--------|--------|--------|
| 100 files | <5s | ~340ms (est.) |
| Full scan | <10s | ~2.6s |
| Memory | <50MB | ~102MB (Node.js baseline) |

## NOTES
- Integrates with delphi-review for multi-expert consensus
- SARIF upload via `github/codeql-action/upload-sarif@v2`