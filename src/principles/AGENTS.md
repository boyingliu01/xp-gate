# PRINCIPLES CHECKER MODULE

**Generated:** 2026-05-30
**Commit:** 4517f2b
**Version:** v0.5.1

## OVERVIEW
Clean Code & SOLID principles checker with 14 rules and 9 language adapters. Gate 4 of pre-commit hook. Includes Boy Scout Rule enforcement and baseline storage.

## STRUCTURE
```
src/principles/
├── adapters/     # 9 language adapters (TS/Python/Go/Java/Kotlin/Dart/Swift/CPP/ObjC)
│   ├── typescript.ts, python.ts, go.ts, java.ts
│   ├── kotlin.ts, dart.ts, swift.ts
│   ├── cpp.ts          # Regex-based C++ extraction
│   ├── objectivec.ts   # Regex-based ObjC extraction
│   └── __tests__/      # 10 adapter tests
├── rules/
│   ├── clean-code/     # 9 rules: long-function, large-file, god-class, deep-nesting,
│   │                   # magic-numbers, missing-error-handling, too-many-params,
│   │                   # unused-imports, code-duplication
│   ├── solid/          # 5 rules: srp, ocp, lsp, isp, dip
│   └── __tests__/      # 14 rule tests
├── boy-scout.ts  # Differential warning enforcement (Gate 6)
├── baseline.ts   # Warning history (.warnings-baseline.json)
├── analyzer.ts   # Rule orchestration engine
├── reporter.ts   # Console/JSON/SARIF 2.1.0 output
├── config.ts     # .principlesrc loader
├── index.ts      # CLI entry point (getAllRules)
├── types.ts      # Type definitions
└── __tests__/    # Core tests (analyzer, index, boy-scout, reporter, baseline, config)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Rule engine | analyzer.ts | Orchestrates 14 rules × 9 adapters |
| CLI entry | index.ts | `getAllRules()` returns all rules |
| Output | reporter.ts | SARIF 2.1.0, JSON, Console |
| Thresholds | config.ts + .principlesrc | Defaults + project overrides |
| Boy Scout | boy-scout.ts | classifyFiles, calculateDelta, enforceBoyScoutRule |
| Baseline | baseline.ts | loadBaseline, saveBaseline, initBaseline |

## CONVENTIONS
- TDD: 40 test files across adapters, rules, and core modules
- Rule ID format: `clean-code.long-function`, `solid.srp`
- Severity: error (block), warning (block), info (log only)
- SARIF 2.1.0 output includes rule descriptions + default levels
- Boy Scout Rule: auto-baseline on first touch; modified files cannot increase warnings; ≤5 baseline warnings must clear to zero
- Test annotations: `@test` REQ-XXX, `@covers` AC-XXX required in every test file
- Mock-first: inline mocks only, no separate fixture files

## ANTI-PATTERNS
- Do NOT use `as any` or `@ts-ignore` in rule implementations
- Do NOT suppress violations via config for production code
- Do NOT skip ast-grep installation (fallback is limited)

## COMMANDS
```bash
# Run principles checker
npx tsx src/principles/index.ts --files "src/**/*.ts" --format console
npx tsx src/principles/index.ts --files "src/**/*.ts" --format sarif

# Custom config
npx tsx src/principles/index.ts --files "src/**/*.ts" --config .principlesrc
```

## NOTES
- Gate 4 of pre-commit hook (6 gates total)
- Performance: ~95ms for 28 files, ~340ms estimated for 100 files
- Memory: ~102MB (Node.js baseline unavoidable)
- 13 language adapters in githooks/ vs 9 in src/principles/ — principles covers TS/Python/Go/Java/Kotlin/Dart/Swift/CPP/ObjC |
| C++ Adapter | adapters/cpp.ts | Regex extraction for .cpp/.c files |

## CONVENTIONS
- TDD implemented: 32 test files across adapters, rules, and core modules
- Rule ID format: `clean-code.long-function`, `solid.srp`
- Severity levels: error (block), warning (block), info (log only)
- SARIF output includes rule descriptions + default levels
- Boy Scout Rule: auto-initializes baseline on first touch; modified files cannot increase warnings; ≤5 baseline warnings must clear to zero
- Test annotations: @test REQ-XXX, @covers AC-XXX required

## ANTI-PATTERNS
- Do NOT use `as any` or `@ts-ignore` in rule implementations
- Do NOT suppress violations via config for production code
- Do NOT skip ast-grep installation (fallback is limited)

## COMMANDS
```bash
# Run principles checker
npx tsx src/principles/index.ts --files "src/**/*.ts" --format console

# SARIF output for GitHub Actions
npx tsx src/principles/index.ts --files "src/**/*.ts" --format sarif > results.sarif

# With custom config
npx tsx src/principles/index.ts --files "src/**/*.ts" --config .principlesrc
```

## NOTES
- Gate 4 of pre-commit hook (6 gates total)
- Performance: 95ms for 28 files, ~340ms estimated for 100 files
- Memory: ~102MB (Node.js baseline unavoidable)