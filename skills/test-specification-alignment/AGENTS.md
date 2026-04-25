# SKILLS/TEST-SPECIFICATION-ALIGNMENT KNOWLEDGE BASE

**Generated:** 2026-04-11
**Commit:** f125a3b
**Branch:** main

## OVERVIEW
Test-Specification Alignment Engine - Two-stage validation ensuring tests accurately reflect requirements and design specs.

## STRUCTURE
```
skills/test-specification-alignment/
├── SKILL.md              # Core alignment engine definition
└── references/          # Supporting documentation
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Core Logic | SKILL.md | Main alignment workflow |
| Two-Stage Flow | SKILL.md | Phase 1 (align) + Phase 2 (execute) |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| Phase 1 | Align Verification | SKILL.md | N/A | Test alignment with specification |
| Phase 2 | Execute Tests | SKILL.md | N/A | Test execution with freezes |
| Freeze Mechanism | Constraint | SKILL.md | N/A | Prevent test modifications during Phase 2 |

## CONVENTIONS
- Phase 1 allows test modifications to align with specification
- Phase 2 prohibits any test modifications (freeze enforced)
- Minimum 80% alignment score required to pass
- All @test, @intent, @covers tags must be present

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT modify tests during Phase 2 execution
- Do NOT proceed with low alignment score (<80%)
- Do NOT skip specification validation if specification exists

## UNIQUE STYLES
- Two-phase separation (modify vs. execute)
- Freeze/unfreeze test protection
- YAML specification-driven validation
- Structured JSDoc tag requirements

## COMMANDS
```bash
# Trigger test-specification alignment
/test-specification-alignment

# Check specification alignment
/verify-tests
```

## NOTES
- Integrates with BUILD (TDD + review) before Arbiter review
- Mandated before gstack-ship release
- Uses freeze skill to lock test directories during Phase 2