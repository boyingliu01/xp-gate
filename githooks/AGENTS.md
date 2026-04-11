# GITHOOKS KNOWLEDGE BASE

**Generated:** 2026-04-11
**Commit:** f125a3b
**Branch:** main

## OVERVIEW
Git quality gates implementation with pre-commit and pre-push hooks for enforcing automated code standards.

## STRUCTURE
```
githooks/
├── pre-commit            # Quality gates check before commit
├── pre-push             # Code walkthrough trigger before push  
└── TOOL-INSTALLATION-GUIDE.md  # Setup and configuration documentation
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Pre-commit Checks | pre-commit | Static analysis, linting, testing |
| Pre-push Hooks | pre-push | Multi-model code review automation |
| Tool Installation | TOOL-INSTALLATION-GUIDE.md | Setup instructions |

## CONVENTIONS
- Zero-tolerance principle: Hooks block if tools unavailable
- Must install required tools for language stack before committing
- Pre-push hook checks for max 20 files and 500 LOC changes
- Documentation-only projects skip code analysis but verify specs

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT skip pre-commit checks (linting, type checks, tests)
- Do NOT bypass pre-push walkthrough for code changes
- Do NOT push large commits exceeding size limits

## UNIQUE STYLES
- Fail-fast approach (blocks if tools not available)
- Automated integration with OpenCode CLI
- Multi-language stack detection
- Size-limited change reviews

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