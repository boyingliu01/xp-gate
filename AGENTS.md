# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-20
**Commit:** dd43e00
**Branch:** main

## OVERVIEW
XP-Gate — 6质量门禁（合并自原版9个）+ AI多专家评审的自动化开发工作流 + npm 零安装分发 + Skill-Cert 评测引擎（外部子项目）。Implements Sprint Flow, Delphi review (design + code-walkthrough), test-specification alignment, Boy Scout Rule enforcement, multi-language principles checker, and a Python-based skill certification system (separate install).

## STRUCTURE
```
./
├── src/npm-package/   # npm distribution package
│   ├── package.json   # npm publish config
│   ├── bin/xp-gate.js   # CLI entry point
│   ├── hooks/         # pre-commit, pre-push hooks
│   ├── adapters/      # 13 language adapters
│   └── lib/           # init.js, install-skill.js, etc.
├── plugins/           # Cross-platform plugins (v0.4.0+)
│   ├── claude-code/   # Claude Code plugin (plugin.json + skills + hooks)
│   │   ├── .claude-plugin/plugin.json  # Plugin manifest
│   │   ├── hooks/hooks.json            # PostToolUse + Stop hooks
│   │   ├── bin/xp-gate-check           # Bash wrapper, graceful degradation
│   │   └── skills/                     # Auto-populated by build script
│   ├── opencode/      # OpenCode plugin (TypeScript module)
│   │   ├── index.ts                    # Plugin entry, 3 tools (gate-check, gate-principles, gate-arch)
│   │   ├── package.json                # @opencode-ai/plugin dependency
│   │   ├── tsconfig.json               # ESNext + bundler moduleResolution
│   │   └── skills/                     # Auto-populated by build script
│   └── shared/        # Common documentation
├── githooks/          # Pre-commit (6 Gates) and pre-push hooks
 │   ├── pre-commit    # Refactored: 6 type-based gates using language adapters
│   ├── adapter-common.sh        # Language detection & routing
│   └── adapters/     # TypeScript/Python/Go/Shell analysis scripts
├── skills/           # AI workflow skills (SKILL.md, not executable)
│   ├── sprint-flow/
│   ├── delphi-review/
│   └── test-specification-alignment/
├── src/
│   ├── principles/   # Clean Code (9 rules) + SOLID (5 rules), 9 language adapters
│   ├── architecture/ # Architecture validation
│   ├── rules/        # Shared rule index
│   └── _wip/         # Reference / staging area
├── docs/             # Design docs and implementation plans
├── scripts/          # Component install scripts
├── promptfoo/        # Promptfoo eval config (test infrastructure)
├── promptpressure/   # Prompt drift detection (test infrastructure)
├── specification.yaml  # Req (auto-generated)
├── architecture.yaml   # Arch rules
└── .warnings-baseline.json  # Boy Scout Rule history
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| npm Package | ./src/npm-package/ | Zero-install distribution: hooks + adapters + CLI |
| CLI Entry | src/npm-package/bin/xp-gate.js | `xp-gate init`, `install-skill`, `update-skill` |
| npm lib | src/npm-package/lib/ | init.js, install-skill.js, detect-deps.js, rollback.js |
| Claude Code Plugin | ./plugins/claude-code/ | JSON manifest + bash hooks + bin wrapper (v0.4.0+) |
| OpenCode Plugin | ./plugins/opencode/ | TS module with 3 tools (gate-check, gate-principles, gate-arch) |
| Plugin Build Script | ./scripts/build-plugin.sh | Unified --platform claude-code|opencode |
| Plugin Skill Copy | ./scripts/copy-skills.sh | Copies full skill directories (not just SKILL.md) |
| Plugin Integration Tests | ./scripts/test-plugins.sh | 28 tests covering structure, manifests, versions, builds, packaging |
| Git Quality Gates | ./githooks/pre-commit | 6 Gates: Code Quality, Dup Code, Complexity, Principles, Tests, Architecture |
| Language Adapters | ./githooks/adapters/ | TS/Python/Go/Shell specific static analysis + lint + test |
| Gate Code of Conduct | ./githooks/QUALITY-GATES-CODE-OF-CONDUCT.md | Zero-tolerance policy, --no-verify prohibition |
| Sprint Flow | ./skills/sprint-flow/ | Think → Plan → Build → Review → Ship |
| Delphi Review | ./skills/delphi-review/ | Multi-expert consensus (design + code-walkthrough modes) |
| Test Alignment | ./skills/test-specification-alignment/ | Test-specification verification |
| Skill-Cert Engine | ~/.config/opencode/skills/skill-cert/ | External subproject: Python, self-generating eval cases, 5-dim scoring |
| Boy Scout Rule | ./src/principles/boy-scout.ts | Differential warning enforcement |
| Principles Checker | ./src/principles/ | 14 rules × 9 language adapters |
| Architecture | ./src/architecture/ | Layer boundary validation (ARCH-001 to ARCH-014) |
| Install Scripts | ./scripts/ | Per-component installer scripts |
| Skill Validation | ./promptfoo/ | Promptfoo regression tests for skills |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| Pre-commit hook | Bash script | githooks/pre-commit | N/A | 6 Gates via language adapter routing |
| adapter-common.sh | Bash | githooks/adapter-common.sh | N/A | detect_project_lang(), route_to_adapter() |
| pre-push hook | Bash script | githooks/pre-push | N/A | Code walkthrough validator (20 files/500 LOC limit) |
| UserSimulator | Python class | skill-cert/engine/simulator.py | N/A | 3 user profiles (clear/vague/chaotic) — EXTERNAL |
| DialogueEvaluator | Python class | skill-cert/engine/dialogue_evaluator.py | N/A | 5-dim heuristic scoring — EXTERNAL |
| DialogueRunner | Python class | skill-cert/engine/dialogue_runner.py | N/A | Multi-turn execution orchestrator — EXTERNAL |
| HistoryReplay | Python class | skill-cert/engine/replay.py | N/A | JSONL session import + comparison — EXTERNAL |
| analyze | Function | src/principles/analyzer.ts | N/A | Rule orchestration engine |
| getAllRules | Function | src/principles/index.ts | N/A | CLI entry, 14 rules |

## CONVENTIONS
- **6 Gates now** (was 9): Code Quality(1+2+5), Dup Code(new), Complexity(7), Principles(6), Tests(3+4), Architecture(8+9)
- All gates zero-tolerance — tool unavailable → SKIP for that language, NOT block
- **No bypassing gates**: `--no-verify` strictly prohibited
- Custom thresholds via `.principlesrc`: long-function 50, god-class 15, deep-nesting 4
- Magic numbers whitelist: [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024]
- Coverage threshold: 80%
- Push limits: max 20 files or 500 LOC per push
- Boy Scout Rule: auto-baseline on first touch; modified files cannot increase warnings
- Skill-Cert: Mock-first testing, all eval cases use AsyncMock, zero real LLM in tests

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


## AI CODING DISCIPLINE (Karpathy Principles)

**原则 3: Surgical Changes（外科手术式改动）**
- 只碰必须碰的代码。只清理自己制造的混乱。
- 编辑现有代码时，不"优化"相邻代码、注释或 formatting
- 不重构没坏的东西
- 匹配现有代码风格，即使 AI 更喜欢另一种
- 发现无关的死代码 → 提及但不要删除（除非用户明确要求）
- 自己的改动产生的 orphaned import/variable/function → 必须清理
- 判定标准: 每一行改动都应能直接追溯到用户的请求

**原则 4: Goal-Driven Execution（目标驱动执行）**
- 定义成功标准。循环直到验证。
- 把指令转化为可验证目标：
  - "加验证" → "写测试 → 让测试通过"
  - "修 bug" → "写复现测试 → 让测试通过"
  - "重构 X" → "确保重构前后测试都通过"
- 多步骤任务列出验证点
- 改完任何代码后必须运行测试确认无 regression

## UNIQUE STYLES
- Skills are SKILL.md (markdown), not executable code
- Output Contract section required in every SKILL.md (machine-readable JSON)
- Skill-Cert self-generates eval cases via LLM → review → fill-gaps loop
- Language adapters route to TS/Py/Go/Shell specific tools automatically
- Lightweight spec.yaml auto-generated from APPROVED design docs
- SARIF 2.1.0 output for IDE/CI integration

## COMMANDS
```bash
# Git workflow
git commit  # → pre-commit (6 Gates via adapter routing)
git push    # → pre-push (Delphi code walkthrough)

# AI review tools
/delphi-review                              # Design review
/delphi-review --mode code-walkthrough      # Code walkthrough (push review)
/sprint-flow "开发用户登录"                   # One-shot sprint
/test-specification-alignment               # Test-spec alignment

# Principles checker
npx tsx src/principles/index.ts --files "src/**/*.ts" --format console
npx tsx src/principles/index.ts --files "src/**/*.ts" --format sarif

# Skill-Cert (Python — external subproject)
# Install separately: see skill-cert/ project docs
```

## NOTES
- skill-cert/ is a Python subproject with own pyproject.toml and venv
- promptpressure/ and promptfoo/ are test infrastructure, not core

## LEARNINGS (from retrospectives)

### 2026-05-28 Retro

1. **Systematic global scan before closing bug fixes** — When fixing a bug reported in a single file (e.g., `process.env.HOME` usage), always scan the **entire codebase** for the same pattern before committing. The `/sprint-flow` bug (#73) report only listed 2 files, but a full scan revealed 4 additional files with the same issue. Rule: `grep -rn 'process.env.HOME' src/` should run **before** claiming a fix complete.
2. **main branch pre-push Gate M skips code-walkthrough** — Delphi code-walkthrough pre-push gate is intentionally skipped when pushing to `main`/`master`. This is **by design** (avoids blocking main pushes on review file checks), but means main has one fewer quality gate. Mitigation: always ship via feature branch + PR so pre-push review still triggers on the feature branch.