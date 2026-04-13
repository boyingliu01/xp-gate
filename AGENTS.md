# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-13
**Commit:** 281ee00
**Branch:** main

## OVERVIEW
XP Workflow Automation project - AI-powered development workflow tools with consensus engines and quality gates. Implements XP pair programming AI consensus (xp-consensus), code walkthroughs (code-walkthrough), and test-specification alignment verification.

## STRUCTURE
```
./
├── docs/          # Documentation files and version specs
├── githooks/      # Pre-commit (7 Gates) and pre-push quality gate scripts
├── skills/        # AI workflow automations and consensus engines
│   ├── code-reviewer/        # Static code quality analysis + SARIF output
│   ├── code-walkthrough/     # Multi-expert Delphi code review
│   ├── delphi-review/        # Delphi consensus methodology (MANDATORY before implementation)
│   ├── test-specification-alignment/  # Test-requirement alignment verification  
│   └── xp-consensus/         # XP pair programming AI consensus engine
├── src/principles/    # Clean Code & SOLID checker (14 rules, 7 language adapters)
├── scripts/           # Benchmark and utility scripts
└── .principlesrc      # Custom quality thresholds config
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Git Quality Gates | ./githooks/ | Contains pre-commit (7 Gates) and pre-push hooks |
| Principles Checker | ./src/principles/ | Clean Code (9) + SOLID (5) rules, 7 language adapters |
| XP Consensus Engine | ./skills/xp-consensus/ | Main workflow automation logic |
| Code Walkthrough | ./skills/code-walkthrough/ | Multi-expert Delphi code review |
| Delphi Review | ./skills/delphi-review/ | MANDATORY before implementation/design decisions |
| Test Alignment | ./skills/test-specification-alignment/ | Requirements-test alignment verification |
| Code Reviewer | ./skills/code-reviewer/ | Static analysis + SARIF output for IDE integration |
| Installation | ./githooks/TOOL-INSTALLATION-GUIDE.md | Tooling setup guide |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| Pre-commit hooks | Bash script | githooks/pre-commit | N/A | 7 Gates: static analysis, lint, test, coverage, shell check, principles, CCN |
| Pre-push hooks | Bash script | githooks/pre-push | N/A | Multi-model code walkthrough via OpenCode CLI |
| analyze | Function | src/principles/analyzer.ts | N/A | Rule orchestration engine, 7 adapters registered |
| getAllRules | Function | src/principles/index.ts | N/A | CLI entry, 14 rules (9 Clean Code + 5 SOLID) |
| formatSARIF | Function | src/principles/reporter.ts | N/A | SARIF 2.1.0 output for IDE integration |
| XP Consensus | Skill System | skills/xp-consensus/ | N/A | Driver-Navigator-Arbiter workflow |
| Code Walkthrough | Skill System | skills/code-walkthrough/ | N/A | Delphi-method code review |
| Test Alignment | Skill System | skills/test-specification-alignment/ | N/A | Test-specification verification |
| Delphi Review | Skill System | skills/delphi-review/ | N/A | Multi-expert consensus (MANDATORY before impl) |
| Code Reviewer | Skill System | skills/code-reviewer/ | N/A | Static analysis + SARIF output |

## CONVENTIONS
- All quality gates in githooks are "zero tolerance" - tools must be available or operations are blocked
- Use Delphi method for multi-expert consensus (code-walkthrough, xp-consensus)
- Two-phase test verification: Phase 1 (align tests with spec), Phase 2 (execute locked tests)
- Custom thresholds via `.principlesrc`: long-function 50, god-class 15, deep-nesting 4, CCN warning 5, CCN block 10
- Magic numbers whitelist: [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024]
- Coverage threshold: 80% (branches, functions, lines, statements)
- Push limits: max 20 files or 500 LOC per push

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT skip test-specification alignment when tests need modification in Phase 2
- Do NOT exceed 20 file changes or 500 LOC changes per git push
- Do NOT bypass githooks quality gates via command-line flags
- Do NOT claim Delphi review complete without APPROVED verdict
- Do NOT auto-degrade quality gates on cost/environment issues - MUST BLOCK and notify user
- Do NOT modify frozen tests during Phase 2 execution

## UNIQUE STYLES
- YAML specification files define requirements and acceptance criteria
- JSDoc-style tags (@test, @intent, @covers) link tests to requirements
- Freeze/unfreeze mechanism protects test files during Phase 2 execution
- SARIF 2.1.0 output format for IDE/GitHub Actions integration
- Skills defined as SKILL.md files (markdown) not executable code

## COMMANDS
```bash
# Git workflow with quality gates
git commit  # -> pre-commit (static analysis, lint, test, coverage, principles, CCN)
git push    # -> pre-push (multi-expert AI code review)

# Manual execution of automation tools
/code-walkthrough
/xp-consensus
/test-specification-alignment
/delphi-review

# Principles checker (Clean Code + SOLID)
npx tsx src/principles/index.ts --files "src/**/*.ts" --format sarif
```

## NOTES
- This project implements enterprise-grade AI-assisted development workflow
- Quality gates block operations until required tools are available
- Documentation-only projects skip code analysis but still verify specifications