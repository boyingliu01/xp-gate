# Plan: Issue #152 — Baseline-based lint checking for pre-commit gate

## Problem

Pre-commit hook runs lint tools (ESLint, ruff, golangci-lint, shellcheck) on `$CHANGED_FILES` with `--max-warnings 0`. This means:
- Pre-existing lint errors are invisible during local commits
- CI stays perpetually red while local commits pass fine
- No mechanism for progressive debt reduction

## Existing Infrastructure (reuse before build)

| Component | Location | Status | Reuse Plan |
|-----------|----------|--------|------------|
| `BaselineStorage` class | `src/principles/baseline.ts` | Exists, TS | Reuse: load/save/validate/createFromFiles |
| `BaselineEntry` interface | `src/principles/baseline.ts` | Exists | Extend: add `ruff`, `golangci`, `shellcheck` fields |
| `boy-scout.ts` CLI | `src/principles/boy-scout.ts` | Exists | Reference for baseline CLI pattern |
| `boy-scout.ts` → Gate 6 | `githooks/pre-commit` (line 1484) | Uses principles baseline | Reuse parse flow for new lint baseline |
| `--max-warnings 0` lint calls | `githooks/pre-commit` (lines 550, 575, 610, 630) | Hard-fail on any warning | Modify to compare against baseline |
| `xp-gate.js` COMMANDS | `src/npm-package/bin/xp-gate.js` | Exists | Add `baseline` subcommand group |

## Constraints

- **TDD**: RED → GREEN → REFACTOR for every code change
- **Backward compatible**: Existing projects with no baseline must degrade gracefully (skip baseline enforcement, continue with current behavior)
- **Zero dependency**: No new npm packages; use existing TS infrastructure
- **Per-project/per-branch**: Baseline stored in `.xp-gate/lint-baseline.json`
- **Performance**: Full-repo baseline scan must complete within 30s (use configurable file limit)

## Implementation Plan

### Phase 1: Lint Baseline Engine (2 steps)

**Step 1.1 — Extend BaselineEntry (RED→GREEN→REFACTOR)**

- **File**: `src/principles/baseline.ts`
- **Change**: Extend `BaselineEntry` interface with lint tool fields
- **TDD**:
  - RED: Write test asserting new fields validate correctly
  - GREEN: Add `ruff`, `golangci`, `shellcheck` optional fields to `BaselineEntry`
  - REFACTOR: Consolidate duplicated validation logic
- **Acceptance**: `BaselineEntry` accepts `{ totalWarnings: 5, ruff: { warnings: 3, errors: 2 }, lastAnalyzed: "..." }`

**Step 1.2 — Create lint-baseline CLI module (RED→GREEN→REFACTOR)**

- **New file**: `src/npm-package/lib/lint-baseline.ts` (or `.js` to match existing CLI lib pattern)
- **Responsibilities**:
  - `createBaseline(projectDir)`: Full-repo lint scan by language → aggregate results → save to `.xp-gate/lint-baseline.json`
  - `checkAgainstBaseline(files, baseline)`: Lint `files`, compare results to `baseline` → return diff (new/removed/changed violations)
  - `showBaseline(baseline)`: Pretty-print baseline summary
  - `resetBaseline(projectDir)`: Force re-scan and replace baseline
  - `diffBaseline(oldBaseline, newBaseline)`: Show which specific rules increased/decreased
- **TDD**:
  - RED: Test that `createBaseline` on a known project dir returns expected structure
  - GREEN: Implement `createBaseline` — scan all source files with the same tools pre-commit uses
  - RED: Test that `checkAgainstBaseline` detects new violations
  - GREEN: Implement diff logic
  - REFACTOR: Extract scanner functions per tool

**Key design decision**: The lint-baseline module runs the same lint commands as the pre-commit hook. For each language:
  - TypeScript: `npx eslint <files> -f json` → parse JSON output
  - Python: `ruff check <files> --output-format json` → parse JSON output
  - Go: `golangci-lint run --out-format json` → parse JSON output
  - Shell: `shellcheck -f json <files>` → parse JSON output
  - Other: route via adapter's `run_lint` function with JSON output

### Phase 2: CLI Commands (1 step)

**Step 2.1 — Add `xp-gate baseline` commands (RED→GREEN→REFACTOR)**

- **File**: `src/npm-package/bin/xp-gate.js`
- **Change**: Add `baseline` subcommand group to `COMMANDS`
- **Subcommands**:
  ```
  xp-gate baseline create      # Full-repo scan → .xp-gate/lint-baseline.json
  xp-gate baseline show        # Display current baseline
  xp-gate baseline reset       # Force re-scan and replace
  xp-gate baseline diff        # Show diff between baseline and current state
  ```
- **TDD**:
  - RED: Test that `xp-gate baseline show` with no baseline prints helpful message
  - GREEN: Add `baseline` command to COMMANDS table + dispatch to lint-baseline module
  - RED: Test that `xp-gate baseline create` creates `.xp-gate/lint-baseline.json`
  - GREEN: Implement create flow
  - REFACTOR: Extract argument parsing

### Phase 3: Pre-commit Hook Integration (2 steps)

**Step 3.1 — Load lint baseline in pre-commit (no TDD, shell script)**

- **File**: `githooks/pre-commit`
- **Change**: At start of Gate 1, load `.xp-gate/lint-baseline.json` if it exists
- **Behavior**:
  - No baseline file → current behavior (unchanged)
  - Baseline exists → store baseline values for comparison
- **Logic**:
  ```bash
  LINT_BASELINE=""
  if [ -f ".xp-gate/lint-baseline.json" ]; then
    LINT_BASELINE=$(cat .xp-gate/lint-baseline.json)
    echo "📊 Using lint baseline from .xp-gate/lint-baseline.json"
  fi
  ```

**Step 3.2 — Modify lint tool invocations to honor baseline (no TDD, shell script)**

- **File**: `githooks/pre-commit`
- **Changes to each lint gate**:

  **ESLint (TypeScript)** — line 550:
  ```bash
  # Before:
  npx eslint $ESLINT_FILES --max-warnings 0 --no-warn-ignored 2>&1 | head -30
  ESLINT_EXIT=$?
  if [ "$ESLINT_EXIT" -ne 0 ]; then
    echo "❌ BLOCKED - LINT ERRORS detected"
    exit 1
  fi

  # After:
  if [ -n "$LINT_BASELINE" ]; then
    # Get total warnings for this file set from baseline
    # Diff approach: count current warnings, compare to baseline total
    ESLINT_OUTPUT=$(npx eslint $ESLINT_FILES -f json --no-warn-ignored 2>&1)
    CURRENT_WARNINGS=$(echo "$ESLINT_OUTPUT" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);console.log(j.reduce((a,f)=>a+(f.warningCount||0),0))")
    BASELINE_WARNINGS=$(echo "$LINT_BASELINE" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);const total=Object.values(j).reduce((a,e)=>a+((e.eslint?.warnings||0)+(e.eslint?.errors||0)),0);console.log(total)")
    if [ "$CURRENT_WARNINGS" -gt "$BASELINE_WARNINGS" ]; then
      NEW_WARNINGS=$((CURRENT_WARNINGS - BASELINE_WARNINGS))
      echo "❌ BLOCKED - ${NEW_WARNINGS} NEW lint errors introduced (baseline: ${BASELINE_WARNINGS}, current: ${CURRENT_WARNINGS})"
      echo "$ESLINT_OUTPUT" | head -30
      exit 1
    else
      REDUCED=$((BASELINE_WARNINGS - CURRENT_WARNINGS))
      if [ "$REDUCED" -gt 0 ]; then
        echo "✅ PASSED - Lint debt reduced by ${REDUCED}"
      else
        echo "✅ PASSED - No new lint errors"
      fi
    fi
  else
    npx eslint $ESLINT_FILES --max-warnings 0 --no-warn-ignored 2>&1 | head -30
    ESLINT_EXIT=$?
    if [ "$ESLINT_EXIT" -ne 0 ]; then
      echo "❌ BLOCKED - LINT ERRORS detected"
      exit 1
    fi
    echo "✅ PASSED - ESLint linting."
  fi
  ```

  Same pattern for:
  - **ruff (Python)** — line 575
  - **golangci-lint (Go)** — line 610
  - **shellcheck (Shell)** — line 630
  - **Language adapters** (`run_lint`) — line 665

- **TDD**: Not applicable (shell code). Tested via:
  1. Existing BATS tests still pass
  2. Manual verification: create baseline, introduce lint error, verify BLOCK
  3. Manual verification: create baseline, reduce lint errors, verify ALLOW

### Phase 4: Integration (1 step)

**Step 4.1 — Bootstrap baseline on `xp-gate init`**

- **File**: `src/npm-package/lib/init.js`
- **Change**: After successful init, run baseline creation if user confirms (or with `--baseline` flag)
- **No TDD** (existing init.js tests cover init flow; baseline creation is additive)

### Phase 5: Documentation (1 step)

- **File**: `githooks/QUALITY-GATES-CODE-OF-CONDUCT.md`
- **Change**: Add lint baseline section next to the staged-only design constraint
- **README.md**: Add baseline commands to CLI command table
- **No TDD** (documentation)

## Test Strategy

| Component | Test Type | File | Tests |
|-----------|-----------|------|-------|
| BaselineEntry extension | Unit (TDD) | `src/principles/__tests__/baseline.test.ts` | Validate new fields + backward compat |
| lint-baseline createBaseline | Unit (TDD) | New test alongside lint-baseline module | Full scan returns expected structure |
| lint-baseline checkAgainstBaseline | Unit (TDD) | Same | New violations detected; reductions detected |
| CLI integration | Unit (TDD) | xp-gate.js test | Commands parse correctly |
| Pre-commit hook | Integration | `githooks/__tests__/*.bats` | Baseline workflow end-to-end (manual) |

## Files Changed

| File | Change Type | Phase |
|------|-------------|-------|
| `src/principles/baseline.ts` | Extend interface | 1.1 |
| `src/principles/__tests__/baseline.test.ts` | Add tests | 1.1 |
| `src/npm-package/lib/lint-baseline.ts` | **New file** | 1.2 |
| `src/npm-package/lib/__tests__/lint-baseline.test.ts` | **New file** | 1.2 |
| `src/npm-package/bin/xp-gate.js` | Add commands | 2 |
| `githooks/pre-commit` | Modify 4 lint gates | 3.1, 3.2 |
| `src/npm-package/lib/init.js` | Add baseline bootstrap | 4 |
| `githooks/QUALITY-GATES-CODE-OF-CONDUCT.md` | Add documentation | 5 |
| `README.md` | Update CLI table | 5 |

## Acceptance Criteria

1. [ ] `xp-gate baseline create` produces `.xp-gate/lint-baseline.json` with per-file lint error counts
2. [ ] `xp-gate baseline show` displays baseline summary
3. [ ] `xp-gate baseline reset` replaces existing baseline
4. [ ] `xp-gate baseline diff` shows lint debt increase/decrease
5. [ ] With baseline: introducing new lint errors → BLOCKED (with message showing how many new errors)
6. [ ] With baseline: reducing lint errors → ALLOWED (with message showing debt reduction)
7. [ ] Without baseline: current behavior unchanged (`--max-warnings 0`)
8. [ ] `xp-gate init --baseline` bootstraps baseline on install
9. [ ] All 847 existing tests still pass
10. [ ] `.xp-gate/lint-baseline.json` is gitignored (per-project, not committed)
