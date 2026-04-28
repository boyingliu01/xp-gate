# PRINCIPLES CHECKER MODULE

**Generated:** 2026-04-14
**Commit:** 324d7ce

## OVERVIEW
Clean Code & SOLID principles checker with 14 rules and 9 language adapters. Gate 4 of pre-commit hook. Includes Boy Scout Rule enforcement and baseline storage for historical projects.

## STRUCTURE
```
src/principles/
├── adapters/     # Language-specific AST adapters (9 languages)
│   ├── typescript.ts, python.ts, go.ts, java.ts
│   ├── kotlin.ts, dart.ts, swift.ts
│   ├── cpp.ts          # Regex-based C++ extraction
│   └── objectivec.ts   # Regex-based Objective-C extraction
├── boy-scout.ts  # Differential warning enforcement (part of Gate 6)
├── baseline.ts   # Warning history storage (.warnings-baseline.json)
├── rules/
│   ├── clean-code/  # 9 rules (long-function, large-file, god-class, etc.)
│   └── solid/       # 5 rules (srp, ocp, lsp, isp, dip)
├── analyzer.ts   # Rule orchestration engine
├── reporter.ts   # Console/JSON/SARIF output
├── config.ts     # .principlesrc loader
├── index.ts      # CLI entry point
└── types.ts      # Type definitions
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Rule Engine | analyzer.ts | Orchestrates 14 rules, 9 adapters |
| CLI Entry | index.ts | `getAllRules()` returns all rules |
| Output Formats | reporter.ts | SARIF 2.1.0, JSON, Console |
| Thresholds | config.ts + .principlesrc | Defaults + project overrides |
| Boy Scout Rule | boy-scout.ts | classifyFiles, calculateDelta, enforceBoyScoutRule |
| Baseline Storage | baseline.ts | loadBaseline, saveBaseline, initBaseline |
| Objective-C Adapter | adapters/objectivec.ts | Regex extraction for .m/.mm files |
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