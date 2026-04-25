# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-14
**Commit:** 324d7ce
**Branch:** main

## OVERVIEW
XP Workflow Automation project - AI-powered development workflow tools with consensus engines and quality gates. Implements Sprint Flow (One-Shot Sprint 自动流水线), Delphi review with dual modes (design + code-walkthrough), test-specification alignment, lightweight specification auto-generation, Boy Scout Rule enforcement, multi-language principles checker, and Zero-Tolerance quality gate enforcement.

## STRUCTURE
```
./
├── docs/          # Documentation files and version specs
├── githooks/      # Pre-commit (9 Gates) and pre-push quality gate scripts
├── skills/        # AI workflow automations and consensus engines
│   ├── sprint-flow/            # One-Shot Sprint 自动流水线 (Think → Plan → Build → Review → Ship)
│   │   ├── SKILL.md            # Main skill definition
│   │   ├── references/         # Phase-specific execution instructions (7 phases)
│   │   └── templates/          # Output templates (pain document, emergent issues, sprint summary)
│   ├── delphi-review/          # Delphi consensus methodology (design + code-walkthrough dual modes)
│   ├── specification-generator/# Lightweight spec auto-generation from APPROVED design docs
│   ├── test-specification-alignment/  # Test-requirement alignment verification  
│   └── code-reviewer/          # Static code quality analysis + SARIF output
├── src/principles/    # Clean Code & SOLID checker (14 rules, 9 language adapters)
│   ├── boy-scout.ts   # Differential warning enforcement
│   ├── baseline.ts    # Warning history storage
│   └── adapters/      # C++, Objective-C, TypeScript, Python, Go, Java, Kotlin, Dart, Swift
├── scripts/           # Benchmark and utility scripts
└── .principlesrc      # Custom quality thresholds config
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Git Quality Gates | ./githooks/ | Contains pre-commit (9 Gates) and pre-push hooks |
| Quality Gate Code of Conduct | ./githooks/QUALITY-GATES-CODE-OF-CONDUCT.md | Zero-tolerance policy, --no-verify prohibition |
| Sprint Flow | ./skills/sprint-flow/ | One-Shot Sprint 自动流水线 (7 phases, 3 templates) |
| Delphi Review | ./skills/delphi-review/ | MANDATORY before implementation (design + code-walkthrough dual modes) |
| Specification Generator | ./skills/specification-generator/ | Lightweight spec auto-generation from design docs |
| Test Alignment | ./skills/test-specification-alignment/ | Requirements-test alignment verification |
| Code Reviewer | ./skills/code-reviewer/ | Static analysis + SARIF output for IDE integration |
| Boy Scout Rule | ./src/principles/boy-scout.ts | Differential warning enforcement for historical projects |
| Baseline Storage | ./src/principles/baseline.ts | Warning history per file (.warnings-baseline.json) |
| Principles Checker | ./src/principles/ | Clean Code (9) + SOLID (5) rules, 9 language adapters |
| Specification | ./specification.yaml | Auto-generated YAML requirements and acceptance criteria |
| Installation | ./githooks/TOOL-INSTALLATION-GUIDE.md | Tooling setup guide |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| Pre-commit hooks | Bash script | githooks/pre-commit | N/A | 9 Gates: static analysis, lint, test, coverage, shell check, principles, CCN, Boy Scout, Architecture |
| Pre-push hooks | Bash script | githooks/pre-push | N/A | Delphi code walkthrough (via delphi-review code-walkthrough mode) |
| analyze | Function | src/principles/analyzer.ts | N/A | Rule orchestration engine, 9 adapters registered |
| getAllRules | Function | src/principles/index.ts | N/A | CLI entry, 14 rules (9 Clean Code + 5 SOLID) |
| formatSARIF | Function | src/principles/reporter.ts | N/A | SARIF 2.1.0 output for IDE integration |
| classifyFiles | Function | src/principles/boy-scout.ts | N/A | File classification (NEW/MODIFIED/UNCHANGED) |
| calculateDelta | Function | src/principles/boy-scout.ts | N/A | Warning delta calculation for Boy Scout Rule |
| loadBaseline | Function | src/principles/baseline.ts | N/A | Load warning history from .warnings-baseline.json |
| Sprint Flow | Skill System | skills/sprint-flow/ | N/A | One-Shot Sprint (Think → Plan → Build → Review → Ship) |
| Delphi Review | Skill System | skills/delphi-review/ | N/A | Multi-expert consensus (MANDATORY before impl, dual modes) |
| Test Alignment | Skill System | skills/test-specification-alignment/ | N/A | Test-specification verification |
| Code Reviewer | Skill System | skills/code-reviewer/ | N/A | Static analysis + SARIF output |

## CONVENTIONS
- All quality gates in githooks are "zero tolerance" - tools must be available or operations are blocked
- **No bypassing gates**: `--no-verify` is strictly prohibited when tools report errors (see githooks/QUALITY-GATES-CODE-OF-CONDUCT.md)
- Use Delphi method for multi-expert consensus (delphi-review design/code-walkthrough modes)
- Two-phase test verification: Phase 1 (align tests with spec), Phase 2 (execute locked tests)
- Custom thresholds via `.principlesrc`: long-function 50, god-class 15, deep-nesting 4, CCN warning 5, CCN block 10
- Magic numbers whitelist: [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024]
- Coverage threshold: 80% (branches, functions, lines, statements)
- Push limits: max 20 files or 500 LOC per push
- Boy Scout Rule: new files zero-tolerance, modified files decrease-or-maintain warnings
- Test annotations: @test REQ-XXX, @intent, @covers AC-XXX required for specification alignment
- Specification.yaml is auto-generated after delphi-review APPROVED; no manual editing required

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT skip test-specification alignment when tests need modification in Phase 2
- Do NOT exceed 20 file changes or 500 LOC changes per git push
- Do NOT bypass githooks quality gates via command-line flags (especially `--no-verify`)
- Do NOT claim Delphi review complete without APPROVED verdict
- Do NOT auto-degrade quality gates on cost/environment issues - MUST BLOCK and notify user
- Do NOT modify frozen tests during Phase 2 execution
- Do NOT skip Boy Scout Rule when .warnings-baseline.json exists
- Do NOT use `git push --no-verify` to skip code review (per QUALITY-GATES-CODE-OF-CONDUCT.md)

## UNIQUE STYLES
- Lightweight specification.yaml auto-generated from APPROVED design docs (no version management, no conflict detection)
- JSDoc-style tags (@test, @intent, @covers) link tests to requirements
- Freeze/unfreeze mechanism protects test files during Phase 2 execution
- SARIF 2.1.0 output format for IDE/GitHub Actions integration
- Skills defined as SKILL.md files (markdown) not executable code
- Differential warning enforcement via Boy Scout Rule (baseline.json tracking)
- Regex-based AST extraction for C++ and Objective-C (Phase 1 approach)
- Quality Gates Code of Conduct enforces zero-tolerance for tool-reported errors

## COMMANDS
```bash
# Git workflow with quality gates
git commit  # -> pre-commit (9 Gates)
git push    # -> pre-push (Delphi code walkthrough review)

# Manual execution of automation tools
/sprint-flow "开发访谈机器人，支持多轮对话"
/delphi-review                          # Design mode (default)
/delphi-review --mode code-walkthrough  # Code walkthrough mode (git push review)
/test-specification-alignment

# Principles checker (Clean Code + SOLID)
npx tsx src/principles/index.ts --files "src/**/*.ts" --format sarif
```

## NOTES
- This project implements enterprise-grade AI-assisted development workflow
- Quality gates block operations until required tools are available
- Documentation-only projects skip code analysis but still verify specifications