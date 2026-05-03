# Mutation Testing Gate 10 — Design Document (Revised)

**Issue**: #21
**Date**: 2026-05-04
**Priority**: P0
**Status**: DESIGN (Revised after Delphi Round 1)
**Delphi Round 1**: Expert A (REQUEST_CHANGES), Expert B (REQUEST_CHANGES)

---

## 1. Motivation

XGate Gate 5 currently only validates code coverage (≥80%). However, coverage metrics have largely lost meaning in the AI era:

| Source | Key Finding |
|--------|-------------|
| KeelCode 2026 | LLM-generated tests achieve only 20.32% mutation score; ~80% of potential bugs undetected |
| MSR 2026 | AI coding agents produce 36% of test commits with mocks (humans: 26%), very low test double diversity |
| Real-world case | AI generated 98% coverage all passing, but missed race condition within a 100ms window |

Core problem: AI-generated tests verify "what code currently does" rather than "what code should do." When implementation contains bugs, tests cement the bug instead of discovering it.

---

## 2. Design

### 2.1 Tool Selection

**Stryker Mutator** for TypeScript (xgate's primary language):

| Component | Package (NPM scope: @stryker-mutator) |
|-----------|----------|
| Core | `@stryker-mutator/core` |
| TypeScript Checker | `@stryker-mutator/typescript-checker` |
| Vitest Runner | `@stryker-mutator/vitest-runner` |

**Version decision**: Pinned to **^8.7.1** (latest v8), NOT ^9.x. Stryker v9 requires vitest >= 2.0.0, but this project uses vitest 1.6.1. v8.7.1 is the last v8 release and supports vitest >= 0.31.2, fully compatible with vitest 1.6.1.

### 2.2 Configuration

File: `stryker.conf.json` at project root

```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "testRunner": "vitest",
  "checker": "typescript",
  "coverageAnalysis": "all",
  "tsconfigFile": "tsconfig.stryker.json",
  "timeoutMS": 120000,
  "timeoutFactor": 1.5,
  "mutate": [
    "src/principles/**/*.ts",
    "!src/principles/**/*.test.ts",
    "!src/principles/**/*.d.ts",
    "!src/principles/**/adapters/**"
  ],
  "thresholds": {
    "high": 80,
    "low": 60,
    "break": 50
  },
  "reporters": ["clear-text", "json", "progress"],
  "jsonReporter": {
    "fileName": "reports/mutation/report.json"
  }
}
```

**Key fixes from Round 1**:
- `"checker": "typescript"` (singular, not `"checkers"`)
- `"coverageAnalysis": "all"` (not `"perTest"` — incompatible with vitest 1.6.1 without complex instrumentation)
- `"tsconfigFile": "tsconfig.stryker.json"` (separate config that includes test files)
- Added `"timeoutMS": 120000` (2 minutes per mutant) and `"timeoutFactor": 1.5`
- Removed HTML reporter (not useful in CI); use `"clear-text"` for terminal output

### 2.3 Separate TypeScript Config for Stryker

File: `tsconfig.stryker.json` — Stryker needs to compile both source AND test files:

```json
{
  "extends": "./tsconfig.json",
  "include": [
    "src/**/*.ts",
    "src/**/*.test.ts"
  ],
  "exclude": [
    "node_modules",
    "dist"
  ]
}
```

**Why separate config**: The project's `tsconfig.json` excludes test files via `exclude: ["src/**/__tests__/**", "src/**/*.test.ts"]`. Stryker MUST compile test files alongside source files. `tsconfig.stryker.json` extends the base config but removes test file exclusions.

### 2.4 Threshold Design

| Threshold | Score | Behavior |
|-----------|-------|----------|
| `high` | ≥ 80% | ✅ Pass, output report |
| `low` | 60% - 79% | ⚠️ Warning, no block |
| `break` | < 50% | ❌ Block merge |

**Progressive adoption plan**:

| Phase | Timeline | Break Threshold | Condition |
|-------|----------|-----------------|-----------|
| Phase 1 (Launch) | Week 1-2 | 40% | Initial adoption, surface baseline score |
| Phase 2 | Week 3-4 | 50% | Raise after 2 weeks of clean CI |
| Phase 3 | Week 5+ | 60% | Raise after assessing Phase 2 results |
| Target | Month 3 | 80% | Match high threshold |

Starting at 40% to avoid blocking all existing commits, gradually raising as test quality improves.

### 2.5 Gate Numbering

This is a **CI Gate**, not a numbered pre-commit gate. The existing 6 gates (1-6) remain in pre-commit. Mutation testing operates independently in the CI pipeline and is referred to as **"Mutation Testing Gate"** (not "Gate 10"). This avoids numbering confusion with the 6-gate pre-commit system.

### 2.6 Integration Points

**CI Pipeline only** — NOT in pre-commit or pre-push hooks (except for optional local self-check).

**Local self-check** (`package.json` scripts):

```json
{
  "scripts": {
    "test:mutation": "npx stryker run",
    "test:mutation:dry": "npx stryker run --dryRunOnly"
  }
}
```

This allows developers to run mutation testing locally before opening a PR.

**CI Integration** (`.github/workflows/mutation-test.yml`):

```yaml
name: Mutation Testing
on:
  pull_request:
    paths:
      - 'src/principles/**/*.ts'
      - 'stryker.conf.json'
      - 'tsconfig.stryker.json'
      - 'package.json'
      - 'vitest.config.ts'
  push:
    branches: [main]
    paths:
      - 'src/principles/**/*.ts'
      - 'stryker.conf.json'
      - 'tsconfig.stryker.json'
      - 'package.json'
      - 'vitest.config.ts'
  workflow_dispatch:

jobs:
  mutation:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx stryker run
      - name: Upload Mutation Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mutation-report
          path: reports/mutation/
          retention-days: 30
```

**Why these trigger paths**: Added `stryker.conf.json`, `tsconfig.stryker.json`, `package.json`, `vitest.config.ts` — changes to configuration files also affect mutation testing.

### 2.7 Edge Cases

| Edge Case | Expected Behavior |
|-----------|-------------------|
| Zero mutants found (config-only PR) | Stryker exits 0 with score=100. CI passes — this is correct behavior for a config change. |
| Stryker timeout | CI kills after 15 minutes (`timeout-minutes: 15`). Treat as ❌ failure. |
| npm install fails (wrong package name) | CI fails immediately. Fixed by pinning exact package names. |
| vitest config mismatch | Stryker configuration validation catches this in dry-run mode. |
| Modifications to excluded adapters | Mutation testing skips adapters — coverage-only check applies. |

---

## 3. Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `stryker.conf.json` | Create | Stryker configuration |
| `tsconfig.stryker.json` | Create | TypeScript config for Stryker (includes test files) |
| `.github/workflows/mutation-test.yml` | Create | CI workflow for mutation testing |
| `package.json` | Modify | Add `@stryker-mutator/core@^8.7.1`, `@stryker-mutator/typescript-checker@^8.7.1`, `@stryker-mutator/vitest-runner@^8.7.1` devDependencies + `test:mutation` scripts |
| `README.md` | Modify | Add "Mutation Testing (CI Gate)" to documentation |

---

## 4. Acceptance Criteria

| ID | Given | When | Then |
|----|-------|------|------|
| AC-01 | Stryker configured with `stryker.conf.json` | Running `npm run test:mutation` | Mutation report generated in `reports/mutation/` |
| AC-02 | Mutation score ≥ 80% | CI runs | ✅ CI passes |
| AC-03 | Mutation score 40-79% | CI runs | ⚠️ Warning, CI passes (progressive phase) |
| AC-04 | Mutation score < 40% | CI runs (Phase 1) | ❌ CI fails |
| AC-05 | Mutation testing configured | PR opened with source/config changes | CI workflow triggers automatically |
| AC-06 | Zero mutants (config-only change) | Stryker run | ✅ CI passes (score=100) |
| AC-07 | Local self-check | Developer runs `npm run test:mutation` | See mutation score before PR |

---

## 5. Dependencies

- `@stryker-mutator/core`: ^8.7.1 (not ^9.x — requires vitest >= 2.0)
- `@stryker-mutator/typescript-checker`: ^8.7.1
- `@stryker-mutator/vitest-runner`: ^8.7.1
- Node.js >= 20
- vitest ^1.6.1 (existing)
- TypeScript ^5.x (existing)

---

## 6. Delphi Round 1 Resolution

### Critical Issues Resolved

| ID | Issue | Resolution |
|----|-------|------------|
| B3 | `checkers` → `checker` (wrong key) | Fixed in Section 2.2 |
| B2 | v9 requires vitest >= 2.0 | Pinned to ^8.7.1 (Section 2.1, Section 5) |
| B1 | `@stryker/mutator-core` doesn't exist | Fixed to `@stryker-mutator/core` throughout |
| A3 | No local self-check | Added `npm run test:mutation` (Section 2.6) |
| B5 | `perTest` incompatible with vitest 1.6.1 | Changed to `coverageAnalysis: "all"` (Section 2.2) |
| B4 | Missing npm script | Added `test:mutation` + `test:mutation:dry` (Section 2.6) |
| B6 | Adapter exclusion rationale | Documented (Section 2.3) |
| B10 | tsconfig excludes test files | Created `tsconfig.stryker.json` (Section 2.3) |

### Major Issues Resolved

| ID | Issue | Resolution |
|----|-------|------------|
| A1 | Gate numbering discontinuity | Renamed to "Mutation Testing Gate (CI)" — not numbered (Section 2.5) |
| A4 | Missing CI timeout | Added `timeout-minutes: 15` + `timeoutMS: 120000` (Section 2.2, 2.6) |
| A5 | No threshold ramp plan | Added Phase 1/2/3 progressive adoption (Section 2.4) |
| B7 | Missing CI cache | Added `cache: 'npm'` to setup-node (Section 2.6) |
| B9 | Missing trigger paths | Added stryker.conf, tsconfig.stryker, package.json, vitest.config (Section 2.6) |

### Minor Issues

| ID | Issue | Resolution |
|----|-------|------------|
| A6 | Package name inconsistency | Fixed (Section 2.1, Section 5 match) |
| A7 | HTML report in CI | Replaced with `clear-text` reporter (Section 2.2) |
| A8 | Zero mutants edge case | Added to Edge Cases table (Section 2.7) |
| B8 | Pre-push override duplication | Removed pre-push integration (CI-only) |
