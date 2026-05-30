# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-30
**Commit:** 4517f2b
**Branch:** main
**Version:** v0.5.1

## OVERVIEW
XP-Gate — 6质量门禁（合并自原版9个）+ AI多专家评审的自动化开发工作流 + npm 零安装分发 + 跨平台插件系统（Claude Code + OpenCode）。Implements Sprint Flow (7-phase pipeline), Delphi review (design + code-walkthrough), test-specification alignment, Boy Scout Rule enforcement, multi-language principles checker (14 rules × 13 language adapters), Gate M mutation testing, and cross-platform plugin distribution.

## STRUCTURE
```
./
├── src/
│   ├── npm-package/    # npm distribution (v0.5.1, 8 CLI commands)
│   │   ├── bin/xp-gate.js   # CLI entry: init/uninstall/doctor/migrate/install-skill
│   │   ├── adapters/        # 13 language adapters (duplicated from githooks/)
│   │   ├── hooks/           # Hook infrastructure scripts
│   │   ├── lib/             # init.js, install-skill.js, doctor.js, migrate.js, uninstall.js, ui-detector.ts
│   │   └── scripts/         # sync-package-content.js (prepack skill/plugin bundling)
│   ├── principles/     # Clean Code (9 rules) + SOLID (5 rules), 9 language adapters
│   ├── architecture/   # Architecture validation (version-parser.ts)
│   ├── debugger/       # Trace collection + summarizer (NEW)
│   ├── mutation/       # Gate M mutation testing + AI-test detection (NEW)
│   ├── rules/          # Shared rule index
│   └── _wip/           # Reference / staging area
├── plugins/            # Cross-platform plugins (v0.4.0+, NEW)
│   ├── claude-code/    # JSON manifest + bash hooks + bin wrapper + 7 skills
│   ├── opencode/       # TS module with 3 tools (gate-check, gate-principles, gate-arch)
│   └── shared/         # Common documentation
├── githooks/           # Pre-commit (6 Gates) and pre-push hooks
│   ├── pre-commit      # 70KB monolithic script: 6 type-based gates via language adapter routing
│   ├── pre-push        # Gate M mutation + Delphi code-walkthrough validator
│   ├── adapter-common.sh  # detect_project_lang(), route_to_adapter()
│   ├── adapters/       # 13 language adapters: TS/Python/Go/Java/Kotlin/C++/Swift/ObjC/Shell/PS/Dart/Flutter/IaC
│   └── adapters/plugins/  # Third-party extensions: p3c-java, whalecloud-java, book299-python/c/js
├── skills/             # AI workflow skills (SKILL.md, not executable)
│   ├── sprint-flow/    # 7-phase pipeline: THINK→PLAN→BUILD→REVIEW→USER ACC→FEEDBACK→SHIP
│   ├── delphi-review/  # Multi-expert consensus (design + code-walkthrough modes)
│   ├── test-specification-alignment/  # 2-phase test-spec verification
│   ├── ralph-loop/     # REQ-level iterative build (Phase 2 default, saves 40-67% tokens)
│   ├── test-driven-development/  # TDD enforcement
│   ├── improve-codebase-architecture/  # Architecture health checks
│   ├── to-issues/      # Vertical slice issue splitting
│   └── admin-template-guidelines/
├── scripts/            # Build/install scripts (15 files)
│   ├── build-plugin.sh  # Unified plugin builder (--platform claude-code|opencode)
│   ├── copy-skills.sh   # Copies full skill directories (not just SKILL.md)
│   ├── sync-version.sh  # VERSION → 4 package.json files
│   └── test-plugins.sh  # 28 plugin integration tests
├── dashboard/          # Quality web dashboard (serve.js, dashboard.js)
├── .github/workflows/  # 8 CI pipelines: quality-gates(953 lines), npm-publish, cross-platform, sonarqube, security, llm-security, mutation-test, promptfoo-eval
├── specification.yaml  # Req (auto-generated from APPROVED design docs)
├── architecture.yaml   # Arch rules (ARCH-001 to ARCH-014)
├── VERSION             # Single source of truth (MAJOR.MINOR.PATCH.MICRO format)
└── .warnings-baseline.json  # Boy Scout Rule history
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| npm Package | ./src/npm-package/ | Zero-install distribution: hooks + adapters + CLI, v0.5.1 |
| CLI Entry | src/npm-package/bin/xp-gate.js | 8 commands: init, setup-global, install-skill, update-skill, uninstall-skill, uninstall, migrate, doctor |
| CLI lib | src/npm-package/lib/ | init.js, install-skill.js, doctor.js, migrate.js, uninstall.js, rollback.js, ui-detector.ts |
| Claude Code Plugin | ./plugins/claude-code/ | JSON manifest + bash hooks + bin wrapper (7 skills, graceful degradation) |
| OpenCode Plugin | ./plugins/opencode/ | TS module with 3 tools (gate-check, gate-principles, gate-arch) |
| Plugin Build | ./scripts/build-plugin.sh | Unified --platform claude-code\|opencode |
| Plugin Skill Copy | ./scripts/copy-skills.sh | Copies full skill directories (preserves references/, templates/) |
| Plugin Integration Tests | ./scripts/test-plugins.sh | 28 tests: structure, manifests, versions, builds, packaging |
| Git Quality Gates | ./githooks/pre-commit | 6 Gates: Code Quality, Dup Code, Complexity, Principles, Tests, Architecture |
| Language Adapters | ./githooks/adapters/ | 13 language adapters + 5 plugin extensions |
| Gate Code of Conduct | ./githooks/QUALITY-GATES-CODE-OF-CONDUCT.md | Zero-tolerance policy, --no-verify prohibition |
| Sprint Flow | ./skills/sprint-flow/ | 7-phase pipeline with ralph-loop default build mode |
| Delphi Review | ./skills/delphi-review/ | 3-expert consensus, ≥91% threshold, domestic models only |
| Test Alignment | ./skills/test-specification-alignment/ | 2-phase: align (modify allowed) → execute (frozen) |
| Boy Scout Rule | ./src/principles/boy-scout.ts | Differential warning enforcement |
| Principles Checker | ./src/principles/ | 14 rules × 9 language adapters, SARIF 2.1.0 output |
| Mutation Testing | ./src/mutation/ | Gate M incremental mutation + AI-test detection |
| Architecture | ./src/architecture/ | Layer boundary validation (ARCH-001 to ARCH-014) |
| Version Sync | ./scripts/sync-version.sh | VERSION → root/npm-package/claude-plugin/opencode package.json |
| Quality Dashboard | ./dashboard/ | `npm run dashboard` → localhost:3333 |
| CI Workflows | .github/workflows/ | 8 pipelines, quality-gates.yml is 953 lines |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| Pre-commit hook | Bash script | githooks/pre-commit | N/A | 6 Gates via language adapter routing |
| adapter-common.sh | Bash | githooks/adapter-common.sh | N/A | detect_project_lang(), route_to_adapter() |
| Pre-push hook | Bash script | githooks/pre-push | N/A | Gate M + Delphi code-walkthrough (20 files/500 LOC limit) |
| analyze | Function | src/principles/analyzer.ts | N/A | Rule orchestration engine |
| getAllRules | Function | src/principles/index.ts | N/A | CLI entry, 14 rules |
| GateM | Class | src/mutation/gate-m.ts | N/A | Incremental mutation testing gate |
| detectAiTest | Function | src/mutation/detect-ai-test.ts | N/A | AI-generated test detection |
| TraceCollector | Class | src/debugger/trace-collector.ts | N/A | Execution trace collection |
| Summarizer | Class | src/debugger/summarizer.ts | N/A | Trace summarization |

## CONVENTIONS
- **6 Gates now** (was 9): Code Quality(1+2+5), Dup Code(new), Complexity(7), Principles(6), Tests(3+4), Architecture(8+9)
- All gates zero-tolerance — tool unavailable → SKIP for that language, NOT block
- **No bypassing gates**: `--no-verify` strictly prohibited
- Custom thresholds via `.principlesrc`: long-function 50, god-class 15, deep-nesting 4
- Magic numbers whitelist: [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024]
- Coverage threshold: 80% (vitest enforced)
- Push limits: max 20 files or 500 LOC per push
- Boy Scout Rule: auto-baseline on first touch; modified files cannot increase warnings
- Test annotations mandatory: `@test`, `@intent`, `@covers` JSDoc tags in every test file
- VERSION file: single source of truth (MAJOR.MINOR.PATCH.MICRO), sync-version.sh propagates to 4 package.json files
- Delphi review: ≥91% consensus, 3 experts from ≥2 different providers, domestic models only
- ralph-loop: Phase 2 BUILD default mode, REQ-level iteration, saves 40-67% tokens vs parallel
- promptfoo/ and promptpressure/ directories **removed** — test infra moved to .github/workflows/

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT bypass quality gates via `--no-verify`
- Do NOT claim Delphi review complete without APPROVED verdict
- Do NOT skip Boy Scout Rule — always runs
- Do NOT hardcode tool paths — use adapter routing (detect_project_lang)
- Do NOT add print() to source code (use logging)
- Do NOT use `as any`, `@ts-ignore`, `@ts-expect-error` in production code
- Do NOT leave empty catch blocks
- Do NOT skip quality gates via flags
- Do NOT modify frozen tests in Phase 2
- Do NOT use skill-cert on main branch without worktree isolation
- Do NOT duplicate adapter files between githooks/adapters/ and src/npm-package/adapters/ (known tech debt)
- Do NOT skip delphi-review before coding — HARD-GATE blocks implementation
- Do NOT use foreign models (Anthropic/OpenAI/Google) in Delphi review

## UNIQUE STYLES
- Skills are SKILL.md (markdown), not executable code
- Output Contract section required in every SKILL.md (machine-readable JSON)
- Language adapters route to TS/Py/Go/Shell specific tools automatically
- Lightweight spec.yaml auto-generated from APPROVED design docs
- SARIF 2.1.0 output for IDE/CI integration
- Cross-platform plugin system: Claude Code (JSON manifest + bash) + OpenCode (TS module) share same skills
- VERSION file as SSoT — 4-digit format, auto-converted to npm semver (3-digit)
- No Makefile — npm scripts + bash scripts only
- Inline test mocks only — no separate fixture files
- Adapter duplication: githooks/adapters/ and src/npm-package/adapters/ contain copies (maintenance risk)

## COMMANDS
```bash
# Git workflow
git commit  # → pre-commit (6 Gates via adapter routing)
git push    # → pre-push (Gate M mutation + Delphi code walkthrough)

# AI review tools
/delphi-review                              # Design review (3 experts, ≥91% consensus)
/delphi-review --mode code-walkthrough      # Code walkthrough (push review)
/sprint-flow "开发用户登录"                   # One-shot 7-phase sprint
/test-specification-alignment               # Test-spec alignment (2-phase)

# Principles checker
npx tsx src/principles/index.ts --files "src/**/*.ts" --format console
npx tsx src/principles/index.ts --files "src/**/*.ts" --format sarif

# Testing
npm test                    # vitest run
npm run test:coverage       # vitest run --coverage (80% threshold)
npm run test:mutation       # stryker run
npm run test:plugins        # 28 plugin integration tests

# Build
npm run build               # tsc
npm run build:plugins       # Build both Claude Code + OpenCode plugins
bash scripts/build-plugin.sh --platform claude-code  # Single platform

# Version management
bash scripts/sync-version.sh  # VERSION → all package.json files

# Quality dashboard
npm run dashboard           # localhost:3333

# xp-gate CLI
xp-gate init                # Install hooks + adapters
xp-gate doctor              # Diagnose installation state
xp-gate uninstall           # Complete removal (reverse of init)
xp-gate migrate             # Clean up v0.4.x残留 (GitHub Packages → npm)
```

## NOTES
- skill-cert/ is an external Python subproject (separate install, own pyproject.toml + venv)
- promptfoo/ and promptpressure/ directories no longer exist — CI workflows replaced them
- .worktrees/ contains sprint and windows-compat worktrees
- coverage/ directory contains vitest HTML reports (not committed)
- dashboard/ contains static web dashboard files
- stryker.conf.json: thresholds high=80, low=60, break=40
- .delphi-config.json is gitignored (contains model API keys)

## LEARNINGS (from retrospectives)

### 2026-05-28 Retro

1. **Systematic global scan before closing bug fixes** — When fixing a bug reported in a single file (e.g., `process.env.HOME` usage), always scan the **entire codebase** for the same pattern before committing. The `/sprint-flow` bug (#73) report only listed 2 files, but a full scan revealed 4 additional files with the same issue. Rule: `grep -rn 'process.env.HOME' src/` should run **before** claiming a fix complete.
2. **main branch pre-push Gate M skips code-walkthrough** — Delphi code-walkthrough pre-push gate is intentionally skipped when pushing to `main`/`master`. This is **by design** (avoids blocking main pushes on review file checks), but means main has one fewer quality gate. Mitigation: always ship via feature branch + PR so pre-push review still triggers on the feature branch.