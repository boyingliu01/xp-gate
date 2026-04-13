# PRINCIPLES CHECKER MODULE

**Generated:** 2026-04-13
**Commit:** 281ee00

## OVERVIEW
Clean Code & SOLID principles checker with 14 rules and 7 language adapters. Gate 6 of pre-commit hook.

## STRUCTURE
```
src/principles/
├── adapters/     # Language-specific AST adapters (7 languages)
│   ├── typescript.ts, python.ts, go.ts, java.ts
│   ├── kotlin.ts, dart.ts, swift.ts
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
| Rule Engine | analyzer.ts | Orchestrates 14 rules, 7 adapters |
| CLI Entry | index.ts | `getAllRules()` returns all rules |
| Output Formats | reporter.ts | SARIF 2.1.0, JSON, Console |
| Thresholds | config.ts + .principlesrc | Defaults + project overrides |

## CONVENTIONS
- TDD implemented: 166 tests, 94.35% coverage
- Rule ID format: `clean-code.long-function`, `solid.srp`
- Severity levels: error (block), warning (block), info (log only)
- SARIF output includes rule descriptions + default levels

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
- Gate 6 of pre-commit hook (7 gates total)
- Performance: 95ms for 28 files, ~340ms estimated for 100 files
- Memory: ~102MB (Node.js baseline unavoidable)