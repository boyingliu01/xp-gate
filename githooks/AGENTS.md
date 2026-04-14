# GITHOOKS KNOWLEDGE BASE

**Generated:** 2026-04-14
**Commit:** 324d7ce
**Branch:** main

## OVERVIEW
Git quality gates implementation with pre-commit (8 Gates) and pre-push hooks for enforcing automated code standards.

## STRUCTURE
```
githooks/
├── pre-commit            # 8 Gates quality check before commit
├── pre-push             # Code walkthrough trigger before push  
├── __tests__/           # Bats tests for gate implementations
└── TOOL-INSTALLATION-GUIDE.md  # Setup and configuration documentation
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Pre-commit Gates | pre-commit:60-1500 | Gate 1-8: static, lint, test, coverage, shell, principles, CCN, Boy Scout |
| Gate 8 Boy Scout | pre-commit:1480+ | Differential warning enforcement via boy-scout.ts CLI |
| CCN Thresholds | pre-commit | CCN_THRESHOLD=5, CCN_ERROR_THRESHOLD=10 |
| Pre-push Review | pre-push:117-287 | Delphi code walkthrough via OpenCode CLI |
| Tool Installation | TOOL-INSTALLATION-GUIDE.md | Setup instructions |

## CONVENTIONS
- Zero-tolerance principle: Hooks block if tools unavailable
- Must install required tools for language stack before committing
- Gate 6: Clean Code & SOLID principles (14 rules, 9 adapters)
- Gate 7: Cyclomatic complexity (CCN >5 warn, CCN >10 block)
- Gate 8: Boy Scout Rule (when .warnings-baseline.json exists)
- Pre-push hook checks for max 20 files and 500 LOC changes
- Documentation-only projects skip code analysis but verify specs

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT skip pre-commit checks (linting, type checks, tests)
- Do NOT bypass pre-push walkthrough for code changes
- Do NOT push large commits exceeding size limits

## UNIQUE STYLES
- 8-gate pre-commit structure (Gate 6: Principles, Gate 7: CCN, Gate 8: Boy Scout)
- Fail-fast approach (blocks if tools not available)
- Automated integration with OpenCode CLI
- Multi-language stack detection (9 language adapters)
- Size-limited change reviews (20 files, 500 LOC)
- Boy Scout Rule differential enforcement via TypeScript CLI

## COMMANDS
```bash
# Install hooks (manual process)
# Copy githooks/pre-commit .git/hooks/pre-commit
# Copy githooks/pre-push .git/hooks/pre-push
# chmod +x .git/hooks/pre-commit .git/hooks/pre-push

# Install missing tools (per project language stack)
# Refer to TOOL-INSTALLATION-GUIDE.md in this directory
```

## NOTES
- Pre-commit hook performs static analysis and testing
- Pre-push hook triggers multi-model code review via OpenCode
- Enforces both tool availability and code quality standards