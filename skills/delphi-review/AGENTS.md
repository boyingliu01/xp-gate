# SKILLS/DEPHI-REVIEW KNOWLEDGE BASE

**Generated:** 2026-04-11
**Commit:** f125a3b
**Branch:** main

## OVERVIEW
Delphi Consensus Review - Multi-round anonymous review system to reach expert consensus on code changes and design decisions.

## STRUCTURE
```
skills/delphi-review/
└── SKILL.md              # Core Delphi review methodology
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Core Logic | SKILL.md | Main Delphi methodology and workflow |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| Delphi Method | Review Process | SKILL.md | N/A | Anonymous multi-round consensus |

## CONVENTIONS
- Experts work anonymously in Round 1 to avoid bias
- Iterative review till consensus reached (>=91% agreement)
- Zero tolerance quality checks required
- No skipping rounds when disagreement occurs

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT terminate before achieving true consensus
- Do NOT reveal other experts' opinions during Round 1
- Do NOT accept partial agreement without resolution

## UNIQUE STYLES
- Anonymous expert reviews
- Multiple rounds until full agreement
- Statistical consensus measurement (>=91% threshold)
- Mandatory agreement before approval

## COMMANDS
```bash
# Trigger Delphi review
/delphi-review
```

## NOTES
- Implements traditional Delphi method for anonymous expert consensus
- Used by code-walkthrough mode