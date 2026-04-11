# SKILLS/CODE-WALKTHROUGH KNOWLEDGE BASE

**Generated:** 2026-04-11
**Commit:** f125a3b
**Branch:** main

## OVERVIEW
Multi-model code walkthrough using Delphi method for post-commit review of git changes before push.

## STRUCTURE
```
skills/code-walkthrough/
├── SKILL.md              # Core walkthrough engine definition
└── references/          # Supporting documentation
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Core Logic | SKILL.md | Main walkthrough flow and rules |
| Integration | references/ | Supporting materials |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| Delphi Review | Review Process | SKILL.md | N/A | Core workflow logic |
| Expert A | AI Model | SKILL.md | N/A | Architecture + design review |
| Expert B | AI Model | SKILL.md | N/A | Implementation + quality review |

## CONVENTIONS
- Anonymous expert A/B reviews (no cross-viewing of opinions)
- Must pass pre-push hook integration
- Maximum 20 files or 500 lines per review cycle
- Zero approval tolerance if critical issues exist

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT allow modification of frozen tests during Phase 2
- Do NOT exceed file/line limits without splitting commits
- Do NOT skip expert review for non-trivial changes

## UNIQUE STYLES
- Dual-expert anonymous review
- Pre-push hook integration
- Freeze/Unfreeze test protection mechanism
- Commit-diff based review triggering

## COMMANDS
```bash
# Trigger code walkthrough manually
/code-walkthrough

# Auto-triggered by pre-push hook
```

## NOTES
- Automatically triggered via git push (pre-push hook)
- Uses Delphi method for consensus building
- Integrates with verification-loop after approval