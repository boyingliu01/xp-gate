# PRINCIPLES CHECKER MODULE

**Generated:** 2026-07-24
**Commit:** 8152a68
**Branch:** main
**Version:** 0.17.0.0

## OVERVIEW
Clean Code & SOLID principles checker — **Gate 4** of pre-commit. 14 rules × 9 language adapters, SARIF 2.1.0 output. Houses the **Boy Scout Rule** enforcement engine (Gate 6) and warning-baseline storage.

## STRUCTURE
```
src/principles/
├── adapters/           # 9 language adapters
│   ├── base.ts         # Shared base class
│   ├── typescript.ts
│   ├── python.ts
│   ├── go.ts
│   ├── java.ts
│   ├── kotlin.ts
│   ├── dart.ts
│   ├── swift.ts
│   ├── cpp.ts          # Regex-based C++ extraction (handles .cpp AND .c files)
│   └── objectivec.ts   # Regex-based ObjC extraction
├── rules/
│   ├── clean-code/     # 9 Clean Code rules
│   │   ├── long-function.ts          (≤50 lines)
│   │   ├── large-file.ts
│   │   ├── god-class.ts
│   │   ├── deep-nesting.ts           (≤4 levels)
│   │   ├── magic-numbers.ts
│   │   ├── missing-error-handling.ts
│   │   ├── too-many-params.ts        (≤4 params)
│   │   ├── unused-imports.ts
│   │   └── code-duplication.ts
│   └── solid/          # 5 SOLID rules: srp, ocp, lsp, isp, dip
├── analyzer.ts         # Rule orchestration engine
├── boy-scout.ts        # Differential warning enforcement (Gate 6)
├── baseline.ts         # Warning history (.warnings-baseline.json)
├── reporter.ts         # Console / JSON / SARIF 2.1.0 output
├── config.ts           # .principlesrc loader
├── index.ts            # CLI entry — `getAllRules()` aggregates all 14
├── types.ts            # Type definitions
└── __tests__/          # Unit tests across adapters, rules, core
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Rule engine | analyzer.ts | Orchestrates 14 rules × 9 adapters |
| CLI entry | index.ts | `getAllRules()` returns the full rule set |
| Output | reporter.ts | Emits Console, JSON, or SARIF 2.1.0 |
| Thresholds | config.ts + .principlesrc | Defaults + project overrides |
| Boy Scout enforcement | boy-scout.ts | classifyFiles → calculateDelta → enforceBoyScoutRule |
| Baseline lifecycle | baseline.ts | loadBaseline, saveBaseline, initBaseline |
| Adapter for new language | adapters/base.ts + add `<lang>.ts` | Subclass base; export via index |
| C / C++ extraction | adapters/cpp.ts | Regex-based; handles both `.cpp` and `.c` |
| Tests | __tests__/ | Adapter, rule, and core tests |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| getAllRules | Function | index.ts | Aggregates 9 clean-code + 5 SOLID rules |
| analyze | Function | analyzer.ts | Walks files × rules × adapters; collects violations |
| report | Function | reporter.ts | Picks Console / JSON / SARIF emitter |
| loadConfig | Function | config.ts | Reads `.principlesrc`; merges with built-in defaults |
| classifyFiles | Function | boy-scout.ts | new / modified / untouched bucket assignment |
| calculateDelta | Function | boy-scout.ts | Diff vs `.warnings-baseline.json` |
| enforceBoyScoutRule | Function | boy-scout.ts | Block when modified-file warnings increase |
| loadBaseline | Function | baseline.ts | Read `.warnings-baseline.json` |
| saveBaseline | Function | baseline.ts | Write updated baseline after successful commit |
| initBaseline | Function | baseline.ts | First-time auto-snapshot (≤5 warnings ⇒ must clear to zero) |

## CONVENTIONS
- **Rule ID format**: `clean-code.long-function`, `solid.srp`. Stable, dot-namespaced.
- **Severity**: `error` (block), `warning` (block under Boy Scout if increased), `info` (log only).
- **SARIF 2.1.0** output includes rule descriptions + default level mapping for GitHub Code Scanning.
- **Boy Scout Rule**: auto-baseline on first touch. Modified files cannot increase warning count vs `.warnings-baseline.json`. New files: zero warnings required. Initial baseline ≤5 warnings must clear to zero on next modification.
- **Test annotations mandatory**: every test file declares `@test REQ-XXX`, `@intent ...`, `@covers AC-XXX` in JSDoc. Missing tags ⇒ test rejected.
- **Mock-first**: inline mocks only, no separate fixture files.
- **ast-grep preferred** for AST work; regex fallback only where ast-grep doesn't reach (cpp / objc).

## ANTI-PATTERNS
- Do NOT use `as any`, `@ts-ignore`, or `@ts-expect-error` in rule implementations.
- Do NOT suppress violations via config for production code paths.
- Do NOT skip `ast-grep` installation — regex fallback is intentionally limited.
- Do NOT introduce a new rule without: (a) ID under `rules/<category>/`, (b) unit tests, (c) listing in `index.ts`, (d) SARIF rule description in `reporter.ts`.

## UNIQUE STYLES
- **9 language adapters** here vs **13 shell adapters** in `githooks/adapters/` — divergence is intentional. Principles engine covers what can be parsed; shell adapters cover what can be linted/tested. Languages in shell-only set (shell, powershell, flutter, iac) don't have TS-side rule support.
- **C++ adapter handles C** via regex — no standalone `c.ts`.
- **SARIF 2.1.0** chosen for GitHub Code Scanning compatibility.

## COMMANDS
```bash
# Console output
npx tsx src/principles/index.ts --files "src/**/*.ts" --format console

# SARIF for GitHub Actions
npx tsx src/principles/index.ts --files "src/**/*.ts" --format sarif > results.sarif

# Custom config
npx tsx src/principles/index.ts --files "src/**/*.ts" --config .principlesrc
```

## NOTES
- Gate 4 of pre-commit (one of 10 numbered gates; see root `AGENTS.md` GATES section).
- Boy Scout enforcement runs separately as Gate 6 in `githooks/pre-commit`.
- Performance: ~95ms for 28 files; ~340ms estimated for 100 files. Memory: ~102 MB (Node.js baseline).
- `getAllRules()` is the stable extension point — register new rules there.

