# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-29
**Commit:** 9715a21
**Branch:** main

## OVERVIEW
XGate — 6质量门禁（合并自原版9个）+ AI多专家评审的自动化开发工作流 + Skill-Cert 评测引擎。Implements Sprint Flow, Delphi review (design + code-walkthrough), test-specification alignment, Boy Scout Rule enforcement, multi-language principles checker, and a Python-based skill certification system.

## STRUCTURE
```
./
├── githooks/         # Pre-commit (6 Gates) and pre-push hooks
│   ├── pre-commit    # Refactored: 6 type-based gates using language adapters
│   ├── adapter-common.sh        # Language detection & routing
│   └── adapters/     # TypeScript/Python/Go/Shell analysis scripts
├── skills/           # AI workflow skills (SKILL.md, not executable)
│   ├── sprint-flow/
│   ├── delphi-review/
│   └── test-specification-alignment/
├── skill-cert/       # Python skill evaluation engine (NEW)
│   ├── engine/       # analyzer, simulator, evaluator, runner, replay
│   ├── tests/        # Mock-first tests, zero real LLM calls
│   ├── configs/      # User profiles (clear/vague/chaotic)
│   └── prompts/      # Judge templates
├── src/
│   ├── principles/   # Clean Code (9 rules) + SOLID (5 rules), 9 language adapters
│   ├── architecture/ # Architecture validation
│   ├── rules/        # Shared rule index
│   └── _wip/         # Reference / staging area
├── docs/             # Design docs and implementation plans
├── scripts/          # Component install scripts
├── specification.yaml  # Req (auto-generated)
├── architecture.yaml   # Arch rules
└── .warnings-baseline.json  # Boy Scout Rule history
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Git Quality Gates | ./githooks/pre-commit | 6 Gates: Code Quality, Dup Code, Complexity, Principles, Tests, Architecture |
| Language Adapters | ./githooks/adapters/ | TS/Python/Go/Shell specific static analysis + lint + test |
| Gate Code of Conduct | ./githooks/QUALITY-GATES-CODE-OF-CONDUCT.md | Zero-tolerance policy, --no-verify prohibition |
| Sprint Flow | ./skills/sprint-flow/ | Think → Plan → Build → Review → Ship |
| Delphi Review | ./skills/delphi-review/ | Multi-expert consensus (design + code-walkthrough modes) |
| Test Alignment | ./skills/test-specification-alignment/ | Test-specification verification |
| Skill-Cert Engine | ./skill-cert/engine/ | Python: self-generating eval cases, 5-dim scoring |
| Boy Scout Rule | ./src/principles/boy-scout.ts | Differential warning enforcement |
| Principles Checker | ./src/principles/ | 14 rules × 9 language adapters |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| Pre-commit hook | Bash script | githooks/pre-commit | N/A | 6 Gates via language adapter routing |
| adapter-common.sh | Bash | githooks/adapter-common.sh | N/A | detect_project_lang(), route_to_adapter() |
| UserSimulator | Python class | skill-cert/engine/simulator.py | N/A | 3 user profiles (clear/vague/chaotic) |
| DialogueEvaluator | Python class | skill-cert/engine/dialogue_evaluator.py | N/A | 5-dim heuristic scoring |
| DialogueRunner | Python class | skill-cert/engine/dialogue_runner.py | N/A | Multi-turn execution orchestrator |
| HistoryReplay | Python class | skill-cert/engine/replay.py | N/A | JSONL session import + comparison |
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
- Do NOT use skill-cert on main branch without worktree isolation

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

# Skill-Cert (Python)
cd skill-cert && PYTHONPATH=. python3 scripts/run_uat.py --skill /path/to/SKILL.md --mode dialogue
```

## NOTES
- Local commits (9715a21) ahead of origin/main (244b225) by 12 commits — push needed
- skill-cert/ is a Python subproject with own pyproject.toml and venv
- promptpressure/ and promptfoo/ are test infrastructure, not core