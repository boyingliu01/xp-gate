# SRC/MUTATION KNOWLEDGE BASE

**Generated:** 2026-06-25
**Commit:** ecb955b
**Branch:** main
**Version:** 0.10.15.0

## OVERVIEW
**Gate M** (incremental mutation testing) + **Gate M2** helpers (test-layer detection used by `src/mock-policy/`). Pre-push quality gate. TypeScript-only; uses Stryker.

## STRUCTURE
```
src/mutation/
├── gate-m.ts            # Incremental mutation testing gate — driven by changed-files list
├── detect-ai-test.ts    # AI-test heuristics + detectTestLayer() (reused by Gate M3)
├── init-baseline.ts     # First-time full baseline initialization
├── update-baseline.ts   # Baseline update after successful push
├── stryker-types.ts     # Typed wrapper around Stryker JSON output
├── types.ts             # Local type definitions
└── __tests__/
    ├── gate-m.test.ts
    └── detect-ai-test.test.ts
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Mutation gate runner | gate-m.ts | `npx tsx src/mutation/gate-m.ts --changed-files "..."` |
| AI-test heuristics | detect-ai-test.ts | Used by both Gate M2 and Gate M3 |
| Test layer detection | detect-ai-test.ts `detectTestLayer` | unit / integration / e2e / unknown |
| Baseline init | init-baseline.ts | First-time full scan |
| Baseline update | update-baseline.ts | Refresh after a clean push |

## CONVENTIONS
- **Mutation targets**: `src/principles/**/*.ts` by default.
- **Thresholds** (from `stryker.conf.json`): high=80%, low=60%, break=40%.
- **Critical paths** configurable via `.mutation-critical-paths` (forces 80% on listed paths).
- **Baseline** stored in `.mutation-baseline.json`.
- **Pre-push slim config**: `stryker.prepush.conf.json` (faster; only mutates changed files).
- **Coverage exclude**: `src/mutation/**` is excluded from vitest coverage to avoid mutating the mutator.

## ANTI-PATTERNS
- Do NOT run mutation directly on `main` without worktree isolation.
- Do NOT skip baseline initialization before the first incremental run.
- Do NOT lower thresholds below 40% (the Stryker break threshold).
- Do NOT couple `detect-ai-test.ts` to Gate M3 internals — it must remain a generic helper consumable by both Gate M2 and Gate M3.

## UNIQUE STYLES
- **Incremental by default** — only mutates changed files in pre-push mode.
- **Gate M2 is implemented inline in `githooks/pre-push`** (regex-counted mock keywords) — only the test-layer detection helper lives here.
- **Main/master push**: Gate M still runs; only the Delphi code-walkthrough validator is skipped.

## COMMANDS
```bash
# Full suite (CI / local manual)
npm run test:mutation

# Initialize baseline (one-time)
npm run mutation:baseline:init

# Incremental run on specific files
npm run mutation:incremental -- --changed-files "src/foo.ts,src/bar.ts"

# Direct Gate M invocation (what pre-push calls)
npx tsx src/mutation/gate-m.ts --changed-files "src/foo.ts"
```

## NOTES
- Invoked by `githooks/pre-push` as Gate M.
- CI workflow: `.github/workflows/mutation-test.yml` (45-min timeout).
- Mock policy (`src/mock-policy/gate-m3.ts`) imports `detectTestLayer` from this module — keep that export stable.
- Configs: `stryker.conf.json` (full), `stryker.prepush.conf.json` (slim).

