# SKILLS/XPMODULES KNOWLEDGE BASE

**Generated:** 2026-04-11
**Commit:** f125a3b
**Branch:** main

## OVERVIEW
XP Consensus Engine - Driver + Navigator + Arbiter decision-tree for AI pair programming workflows using Delphi method consensus.

## STRUCTURE
```
skills/xp-consensus/
├── SKILL.md              # Core consensus engine definition
├── arbiter-prompt.md     # Arbiter AI decision tree and logic
├── driver-prompt.md      # Driver AI implementation instructions
├── navigator-phase1-prompt.md  # Navigator blind review (phase 1)
├── navigator-phase2-prompt.md  # Navigator verification (phase 2)
├── state-schema.md      # TypeScript interfaces for state management
└── references/          # Supporting documentation and templates
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Core Logic | SKILL.md | Main consensus flow and rules |
| Arbiter AI | arbiter-prompt.md | Decision tree for final approval |
| Implementation | driver-prompt.md | Instructions for code generation |
| Verification | navigator-phase1-prompt.md | Blind review logic |
| Validation | navigator-phase2-prompt.md | Verification after code unlock |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| Consensus Flow | State Machine | SKILL.md | N/A | Core workflow logic |
| Driver AI | Prompt Template | driver-prompt.md | N/A | Implementation agent |
| Navigator AI | Prompt Template | navigator-prompt.md | N/A | Review agent (2 phases) |
| Arbiter AI | Prompt Template | arbiter-prompt.md | N/A | Decision agent |

## CONVENTIONS
- Must maintain blind review principle (Navigator Phase 1 cannot see code)
- Minimum 80% alignment threshold for test-specification verification
- All critical issues must be resolved before approval
- Zero tolerance for specification misalignment

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT skip Gate 1 static analysis before Arbiter
- Do NOT allow Navigator to see code in Phase 1
- Do NOT approve with confidence <8 threshold

## UNIQUE STYLES
- YAML specification-driven test alignment
- Two-phase verification (blind + validation)
- Confidence-based decision making
- Circuit breaker for cost overruns

## COMMANDS
```bash
# Trigger XP consensus
/xp-consensus

# Check state machine
# See state-schema.md for complete state definitions
```

## NOTES
- Follows Delphi method for consensus building
- Integrates with test-specification-alignment flow
- Includes circuit breaker functionality for cost control