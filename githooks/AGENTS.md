# GITHOOKS KNOWLEDGE BASE

**Generated:** 2026-05-30
**Commit:** 4517f2b
**Branch:** main
**Version:** v0.5.1

## OVERVIEW
Git quality gates: pre-commit (6 Gates via 13 language adapters) and pre-push (Gate M mutation + Delphi code-walkthrough). Zero-tolerance policy per QUALITY-GATES-CODE-OF-CONDUCT.md.

## STRUCTURE
```
githooks/
├── pre-commit                    # 70KB monolithic: 6 type-based gates via adapter routing
├── pre-push                      # Gate M mutation + Delphi code-walkthrough (20 files/500 LOC)
├── adapter-common.sh             # detect_project_lang(), route_to_adapter()
├── adapters/                     # 13 language adapters + plugins/
│   ├── typescript.sh, python.sh, go.sh, java.sh, kotlin.sh
│   ├── cpp.sh, swift.sh, objectivec.sh, shell.sh, powershell.sh
│   ├── dart.sh, flutter.sh, iac.sh
│   └── plugins/                  # Third-party extensions
│       ├── p3c-java/             # Alibaba Java coding guidelines
│       ├── whalecloud-java/      # Whalecloud Java rules
│       ├── book299-20132-python/ # Python style rules
│       ├── book299-4081-c/       # C style rules
│       └── book299-4083-javascriptes5/ # ES5 JavaScript rules
├── QUALITY-GATES-CODE-OF-CONDUCT.md  # --no-verify strictly prohibited
├── __tests__/                    # 10 BATS tests
└── TOOL-INSTALLATION-GUIDE.md
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| 6 Gates | pre-commit | Gate 1: Code Quality, Gate 2: Dup Code, Gate 3: CCN, Gate 4: Principles, Gate 5: Tests, Gate 6: Architecture + Boy Scout |
| Language routing | adapter-common.sh | 3-tier resolution: global → project → script dir |
| Adapters | adapters/ | 13 languages: TS/Python/Go/Java/Kotlin/C++/Swift/ObjC/Shell/PS/Dart/Flutter/IaC |
| Plugins | adapters/plugins/ | 5 third-party extensions (p3c-java, whalecloud-java, book299-*) |
| Pre-push | pre-push | Gate M mutation (TS only) + Delphi code-walkthrough |
| Code of Conduct | QUALITY-GATES-CODE-OF-CONDUCT.md | Zero-tolerance, --no-verify prohibited |
| Tests | __tests__/ | 10 BATS tests (gate validation, adapter tests) |

## CONVENTIONS
- **6-gate** pre-commit: Code Quality(1+2+5), Dup Code(2), Complexity(3), Principles(4), Tests(3+4), Architecture(6)
- Tool unavailable → SKIP for that language, NOT block
- Zero-tolerance: hooks block if tools unavailable for detected language
- CCN thresholds: >5 warn, >10 block
- Pre-push: max 20 files or 500 LOC per push
- Pre-push skipped for main/master pushes (code-walkthrough only)
- Boy Scout Rule: new files zero-tolerance; modified files cannot increase warnings; ≤5 baseline warnings must clear to zero
- Adapter plugins extend language checks (installable per-project)

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT use `--no-verify` to bypass gate failures
- Do NOT skip pre-push walkthrough for code changes
- Do NOT push large commits exceeding size limits
- Do NOT hardcode tool paths — use adapter routing (detect_project_lang)
- Do NOT bypass delphi-review guard (delphi-review-guard.sh in claude-code plugin)

## UNIQUE STYLES
- 70KB monolithic pre-commit script (all 6 gates in one file)
- 13 language adapters + 5 plugin extensions (extensible)
- 3-tier adapter resolution: global (~/.config/xp-gate/adapters) → project (githooks/) → script dir
- Pre-push Gate M: mutation testing for TypeScript only
- Code-walkthrough result stored in .code-walkthrough-result.json
- Graceful degradation: plugin hooks always exit 0

## COMMANDS
```bash
# Install hooks
bash githooks/install.sh [--force]

# Verify installation
bash githooks/verify.sh

# Test hooks (BATS)
cd githooks/__tests__ && bats *.bats
```

## NOTES
- Adapters duplicated in src/npm-package/adapters/ — known tech debt
- Pre-push hook reads .code-walkthrough-result.json for commit hash verification
- Plugin adapters (p3c-java, whalecloud-java, book299-*) are third-party extensions
- Main branch: pre-push Gate M skips code-walkthrough (by design)