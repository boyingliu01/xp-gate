# SRC/MUTATION KNOWLEDGE BASE

**Generated:** 2026-05-30
**Commit:** 4517f2b

## OVERVIEW
Gate M incremental mutation testing + AI-generated test detection — pre-push quality gate.

## STRUCTURE
```
src/mutation/
├── gate-m.ts           # Incremental mutation testing gate
├── detect-ai-test.ts   # AI-generated test detection
├── init-baseline.ts    # Baseline initialization
├── update-baseline.ts  # Baseline updates after push
├── types.ts            # Type definitions
└── __tests__/
    ├── gate-m.test.ts
    └── detect-ai-test.test.ts
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Mutation gate | gate-m.ts | Incremental mutation on changed files |
| AI test detection | detect-ai-test.ts | Detects AI-generated test patterns |
| Baseline init | init-baseline.ts | Full scan baseline (first-time setup) |
| Baseline update | update-baseline.ts | Updates after successful push |

## CONVENTIONS
- Mutation targets: src/principles/**/*.ts only
- Thresholds: high=80%, low=60%, break=40% (stryker.conf.json)
- Critical paths: configurable via .mutation-critical-paths (80% threshold)
- Baseline stored in .mutation-baseline.json

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT run mutation on main branch without worktree isolation
- Do NOT skip baseline initialization before first incremental run
- Do NOT lower thresholds below 40% (stryker break threshold)

## UNIQUE STYLES
- Incremental mutation: only mutates changed files (not full suite)
- AI test detection: Gate M2 mock density check (50% BLOCK, 30% ADVISORY)
- Pre-push trigger: runs automatically on git push
- Main/master pushes: mutation runs but code-walkthrough skipped

## COMMANDS
```bash
npm run test:mutation                # stryker run (full)
npm run mutation:baseline:init       # Initialize local baseline
npm run mutation:incremental -- --changed-files "src/foo.ts,src/bar.ts"
```

## NOTES
- Pre-push hook triggers Gate M + Gate M2
- Mutation testing CI: .github/workflows/mutation-test.yml (15min timeout)
- Stryker config: stryker.conf.json (principles), stryker.prepush.conf.json (pre-push)
- Coverage exclude: src/mutation/** excluded from vitest coverage
