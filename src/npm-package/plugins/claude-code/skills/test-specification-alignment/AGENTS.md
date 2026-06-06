# SKILLS/TEST-SPECIFICATION-ALIGNMENT KNOWLEDGE BASE

**Generated:** 2026-05-30
**Commit:** 4517f2b
**Branch:** main
**Version:** v0.5.1

## OVERVIEW
Test-Specification Alignment Engine — two-stage validation ensuring tests accurately reflect requirements and design specs.

## STRUCTURE
```
skills/test-specification-alignment/
├── SKILL.md              # Core alignment workflow (2-phase)
├── AGENTS.md             # This file
├── evals/                # Evaluation test cases
└── references/           # Supporting documentation
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Core workflow | SKILL.md | Phase 1 (align) + Phase 2 (execute) |
| Freeze mechanism | SKILL.md | Prevents test modifications during Phase 2 |

## CONVENTIONS
- Phase 1 (Align): test modifications ALLOWED to align with specification
- Phase 2 (Execute): test modifications FORBIDDEN (freeze enforced)
- Minimum 80% alignment score required to pass
- All `@test`, `@intent`, `@covers` JSDoc tags mandatory in test files
- Test annotations trace to REQ-XXX and AC-XXX

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT modify tests during Phase 2 execution
- Do NOT proceed with low alignment score (<80%)
- Do NOT skip specification validation if specification exists
- Do NOT delete test files in Phase 2 (freeze intercepts)
- Do NOT modify assertions when tests fail (modify business code instead)
- Missing @test tags → test rejected

## UNIQUE STYLES
- Two-phase separation (modify vs. execute)
- Freeze/unfreeze test protection mechanism
- YAML specification-driven validation (specification.yaml)
- Structured JSDoc tag requirements (@test, @intent, @covers)

## COMMANDS
```bash
/test-specification-alignment   # Run alignment check
```

## NOTES
- Runs during BUILD (Phase 2) after TDD
- Mandatory before gstack-ship release
- Integrates with test-driven-development skill
- Uses freeze skill to lock test directories during Phase 2