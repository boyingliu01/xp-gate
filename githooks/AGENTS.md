# GITHOOKS KNOWLEDGE BASE

**Generated:** 2026-04-13
**Commit:** 281ee00
**Branch:** main

## OVERVIEW
Git quality gates implementation with pre-commit and pre-push hooks for enforcing automated code standards.

## STRUCTURE
```
githooks/
├── pre-commit            # 7 Gates quality check before commit
├── pre-push             # Code walkthrough trigger before push  
└── TOOL-INSTALLATION-GUIDE.md  # Setup and configuration documentation
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Pre-commit Gates | pre-commit:60-820 | Gate 1-7: static, lint, test, coverage, shell, principles, CCN |
| CCN Thresholds | pre-commit:727-728 | CCN_THRESHOLD=5, CCN_ERROR_THRESHOLD=10 |
| Pre-push Review | pre-push:117-287 | Delphi code walkthrough via OpenCode CLI |
| Tool Installation | TOOL-INSTALLATION-GUIDE.md | Setup instructions |

## CONVENTIONS
- Zero-tolerance principle: Hooks block if tools unavailable
- Must install required tools for language stack before committing
- Gate 6: Clean Code & SOLID principles (14 rules, 7 adapters)
- Gate 7: Cyclomatic complexity (CCN >5 warn, CCN >10 block)
- Pre-push hook checks for max 20 files and 500 LOC changes
- Documentation-only projects skip code analysis but verify specs

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT skip pre-commit checks (linting, type checks, tests)
- Do NOT bypass pre-push walkthrough for code changes
- Do NOT push large commits exceeding size limits

## UNIQUE STYLES
- 7-gate pre-commit structure (Gate 6: Principles, Gate 7: CCN)
- Fail-fast approach (blocks if tools not available)
- Automated integration with OpenCode CLI
- Multi-language stack detection
- Size-limited change reviews (20 files, 500 LOC)

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