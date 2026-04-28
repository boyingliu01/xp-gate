# GITHOOKS KNOWLEDGE BASE

**Generated:** 2026-04-14
**Commit:** 324d7ce
**Branch:** main

## OVERVIEW
Git quality gates: pre-commit (6 Gates) and pre-push (Delphi code walkthrough via `--mode code-walkthrough`) for enforcing automated standards. Zero-tolerance policy enforced by QUALITY-GATES-CODE-OF-CONDUCT.md.

## STRUCTURE
```
githooks/
├── pre-commit                    # 6 Gates quality check before commit
├── pre-push                      # Code walkthrough validator before push
├── QUALITY-GATES-CODE-OF-CONDUCT.md  # Zero-tolerance enforcement policy
├── __tests__/                    # Bats tests
└── TOOL-INSTALLATION-GUIDE.md    # Setup documentation
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Pre-commit Gates | pre-commit:60-2000+ | Gate 1-6: Code Quality, Dup Code, Complexity, Principles, Tests, Architecture |
| Gate 6 Architecture | pre-commit | archlint, Deply, goarchtest, ArchUnit language-specific |
| Gate 6 Boy Scout | pre-commit:1769+ | Differential warning enforcement via boy-scout.ts CLI |
| CCN Thresholds | pre-commit | CCN_THRESHOLD=5, CCN_ERROR_THRESHOLD=10 |
| Pre-push Review | pre-push | Delphi code walkthrough via `delphi-review --mode code-walkthrough` |
| Zero-Tolerance Policy | QUALITY-GATES-CODE-OF-CONDUCT.md | Prohibits --no-verify bypass |
| Tool Installation | TOOL-INSTALLATION-GUIDE.md | Setup instructions |

## CONVENTIONS
- **Zero-tolerance**: Hooks block if tools unavailable
- Must install required tools for language stack before committing
- Gate 6: Architecture quality (Clean Architecture boundary validation)
- Gate 3: Cyclomatic complexity (CCN >5 warn, CCN >10 block)
- Gate 6: Boy Scout Rule (unified — auto-initializes baseline when missing)
- Pre-push hook checks for size limits (max 20 files, 500 LOC)
- Documentation-only projects skip code analysis but verify specs
- Boy Scout Rule: new files zero-tolerance; modified files cannot increase warnings; ≤5 warnings must clear to zero

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT skip pre-commit checks (linting, type checks, tests)
- Do NOT bypass pre-push walkthrough for code changes
- Do NOT push large commits exceeding size limits
- Do NOT use `--no-verify` to bypass gate failures (per CODE-OF-CONDUCT.md)

## UNIQUE STYLES
- **6-gate** pre-commit structure (Gate 4: Principles, Gate 7: CCN, Gate 6: Boy Scout, Gate 6: Architecture)
- Fail-fast approach (blocks if tools not available)
- Automated integration with OpenCode CLI
- Multi-language stack detection (9 language adapters)
- Size-limited change reviews (20 files, 500 LOC)
- Boy Scout Rule differential enforcement via TypeScript CLI (auto-baseline initialization)
- Quality Gates Code of Conduct (zero-tolerance for --no-verify bypass)

## COMMANDS
```bash
# Install hooks (manual process)
cp githooks/pre-commit .git/hooks/pre-commit
cp githooks/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-commit .git/hooks/pre-push
```

## NOTES
- Pre-commit hook performs static analysis, testing, and architecture validation
- Pre-push hook triggers Delphi code walkthrough review
- Enforces both tool availability and code quality standards
- `--no-verify` strictly prohibited when tools report errors