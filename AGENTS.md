# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-11
**Commit:** f125a3b
**Branch:** main

## OVERVIEW
XP Workflow Automation project - AI-powered development workflow tools with consensus engines and quality gates. Implements XP pair programming AI consensus (xp-consensus), code walkthroughs (code-walkthrough), and test-specification alignment verification.

## STRUCTURE
```
./
├── docs/          # Documentation files and version specs
├── examples/      # Example configurations (currently empty)
├── githooks/      # Pre-commit and pre-push quality gate scripts
├── skills/        # AI workflow automations and consensus engines
│   ├── code-walkthrough/     # Multi-expert code review system
│   ├── delphi-review/        # Delphi consensus methodology
│   ├── test-specification-alignment/  # Test-requirement alignment validation  
│   └── xp-consensus/         # XP pair programming AI consensus engine
├── src/           # Source code (currently minimal structure)
├── tests/         # Test files (currently minimal structure)
└── .gitignore     # Git ignore rules
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Git Quality Gates | ./githooks/ | Contains pre-commit and pre-push hooks |
| XP Consensus Engine | ./skills/xp-consensus/ | Main workflow automation logic |
| Code Walkthrough | ./skills/code-walkthrough/ | Multi-expert AI review system |
| Test Alignment | ./skills/test-specification-alignment/ | Requirements-test alignment verification |
| Installation | ./githooks/TOOL-INSTALLATION-GUIDE.md | Tooling setup guide |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| Pre-commit hooks | Bash script | githooks/pre-commit | N/A | Static analysis, tests, coverage gates |
| Pre-push hooks | Bash script | githooks/pre-push | N/A | Multi-model code walkthrough |
| XP Consensus | Skill System | skills/xp-consensus/ | N/A | Driver-Navigator-Arbiter workflow |
| Code Walkthrough | Skill System | skills/code-walkthrough/ | N/A | Delphi-method code review |
| Test Alignment | Skill System | skills/test-specification-alignment/ | N/A | Test-specification verification |

## CONVENTIONS
- All quality gates in githooks are "zero tolerance" - tools must be available or operations are blocked
- Use Delphi method for multi-expert consensus (code-walkthrough, xp-consensus)
- Two-phase test verification: Phase 1 (align tests with spec), Phase 2 (execute locked tests)

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT skip test-specification alignment when tests need modification in Phase 2
- Do NOT exceed 20 file changes or 500 LOC changes per git push
- Do NOT bypass githooks quality gates via command-line flags

## UNIQUE STYLES
- YAML specification files define requirements and acceptance criteria
- JSDoc-style tags (@test, @intent, @covers) link tests to requirements
- Freeze/unfreeze mechanism protects test files during Phase 2 execution

## COMMANDS
```bash
# Git workflow with quality gates
git commit  # -> pre-commit (static analysis, lint, test, coverage)
git push    # -> pre-push (multi-expert AI code review)

# Manual execution of automation tools
/code-walkthrough
/xp-consensus
/test-specification-alignment
```

## NOTES
- This project implements enterprise-grade AI-assisted development workflow
- Quality gates block operations until required tools are available
- Documentation-only projects skip code analysis but still verify specifications