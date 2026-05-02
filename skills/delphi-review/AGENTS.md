# SKILLS/DEPHI-REVIEW KNOWLEDGE BASE

**Generated:** 2026-05-02
**Commit:** 1f6bc7d
**Branch:** main

## OVERVIEW
Delphi Consensus Review - Multi-round anonymous review system to reach expert consensus on code changes and design decisions.

## STRUCTURE
```
skills/delphi-review/
├── SKILL.md              # Core Delphi review methodology
├── INSTALL.md            # Setup instructions
├── references/           # Code walkthrough mode specification
└── .delphi-config.json.example  # 3-expert config template
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