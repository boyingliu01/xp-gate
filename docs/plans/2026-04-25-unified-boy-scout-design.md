# Design: Unified Boy Scout Rule (Consolidate Gate 6 + Gate 8)

## Problem Statement

The current quality gate system has **redundant, conflicting rules**:

| Gate | Rule | New Projects | Legacy Projects |
|------|------|-------------|-----------------|
| Gate 6 (Principles) | 0 violations | Works fine | Blocks commits - historical violations prevent any commit |
| Gate 8 (Boy Scout) | Delta warnings | Skipped (no baseline) | Works - but only if baseline was manually initialized |

**The conflict:**
- Gate 6 blocks legacy projects because historical violations count as "violations"
- Gate 8 only activates if `.warnings-baseline.json` exists
- Result: Legacy projects with existing warnings can't commit at all

**The solution:**
- A single unified Boy Scout Rule applies to ALL projects
- First commit establishes baseline (auto-init)
- Every subsequent commit: **modified files must reduce warnings or stay same**
- New files: **always zero warnings**

## Unified Rule Design

### Core Logic

```
For EACH changed file:
  IF new file:
    violations == 0  → PASS
    violations > 0   → BLOCK (new code must be clean)

  IF existing file (modified):
    current_warnings <= baseline_warnings  → PASS
    current_warnings > baseline_warnings   → BLOCK (left it dirtier)

    Special case (cleanup mandate):
    IF baseline_warnings <= 5 AND current_warnings > 0:
      BLOCK (file has few warnings, clean them up!)
```

### Auto-Baseline Initialization

When `.warnings-baseline.json` doesn't exist:

```
1. Run Principles Checker on ALL project source files
2. Record per-file violation counts into baseline
3. Current commit uses this as the baseline
4. FUTURE commits are compared against it
```

This means the **first commit** to a legacy project acts as:
- A baseline snapshot (auto-created)
- No blocking on that first commit (baseline is created from current state)

### Integration with Principles Checker

The current `getWarningCountForFile()` in `boy-scout.ts` only counts:
- `console.log()` statements
- `// TODO:` comments
- `var ` declarations

**Replace with:** Integration with actual Principles Checker (Clean Code + SOLID) violations.

The Principles Checker already:
- Counts per-file violations (`AnalysisSummary.warningCount`)
- Supports all 9 languages
- Has configurable thresholds via `.principlesrc`

## Files to Change

| File | Change |
|------|--------|
| **src/principles/boy-scout.ts** | Replace `getWarningCountForFile` to call Principles Checker |
| **src/principles/boy-scout.ts** | Update `calculateDelta` to support auto-baseline-init |
| **githooks/pre-commit** | Gate 8: Remove "baseline must exist" check, always run |
| **githooks/pre-commit** | Gate 6: Remove blocking on warnings, keep blocking on ERRORS only |
| **.warnings-baseline.json.example** | Add example baseline file |
| **CONTRIBUTING.md** | Update quality gate documentation |
| **README.md** | Update Gate 6/Gate 8 descriptions |
| **src/principles/__tests__/boy-scout.test.ts** | Add tests for auto-baseline-init |
| **specification.yaml** | Update acceptance criteria |

## Gate Behavior After Changes

| Gate | New Behavior |
|------|-------------|
| Gate 6 (Principles) | Block on ERRORS only (critical violations: missing-error-handling, solid.srp, solid.dip) |
| Gate 8 (Boy Scout Unified) | Block if modified files increase warnings, OR new files have violations |

## Edge Cases

| Case | Behavior |
|------|----------|
| First commit to legacy project (no baseline) | Auto-init baseline, PASS |
| Second commit after baseline created | Compare against baseline, enforce delta |
| Deleted files | Remove from baseline, PASS |
| Renamed files | Treat as delete(old) + add(new), new file = zero tolerance |
| Renamed with no content change | Update baseline key from oldPath to newPath |

## Rollback Plan

If unified rule causes issues:
- Revert `boy-scout.ts` to previous version
- Restore `pre-commit` hook to separate Gate 6/Gate 8 behavior
- Delete `.warnings-baseline.json` to reset baseline
