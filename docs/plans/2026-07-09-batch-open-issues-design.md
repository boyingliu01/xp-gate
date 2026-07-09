# Batch Open Issues — Unified Design

**Date**: 2026-07-09
**Sprint**: sprint-2026-07-09-01
**Issues**: #305, #306, #307, #308
**Status**: Design

## Overview

Batch resolution of all 4 remaining open issues in a single sprint. Three issues (#305, #306, #308) touch sprint-flow skill internals and must be designed cohesively. Issue #307 is an independent CI test fix.

## Issue #305: TDD Enforcement in BUILD Phase

### Problem
Sisyphus orchestrator's AGENTS.md instructs "DECOMPOSE AND DELEGATE — YOU ARE NOT AN IMPLEMENTER" which overrides the test-driven-development skill requirement. The orchestrator delegates implementation directly without writing failing tests first.

### Solution
Inject explicit TDD enforcement into AGENTS.md and phase-3-build.md:

1. **AGENTS.md Phase 2B section**: Add "Pre-Implementation TDD Check (MANDATORY)" before the delegation section. The check verifies a failing test exists before any implementation delegation.
2. **phase-3-build.md**: Add TDD todo prefix convention (`[TDD-RED]`, `[TDD-GREEN]`, `[TDD-REFACTOR]`) at the top of BUILD flow instructions.
3. **Todo format**: Extend the existing "WHERE HOW WHY" format with TDD phase prefixes.

### Files
- `AGENTS.md`: +~10 lines in Phase 2B section
- `skills/sprint-flow/references/phase-3-build.md`: +~15 lines in TDD section

### No Changes To
- `test-driven-development` skill itself (already correct)
- `ralph-loop` skill (already calls TDD internally)

---

## Issue #306: DESIGN Routing Fork

### Problem
Sprint-flow always routes Phase 2/6 DESIGN through autoplan (gstack: CEO → Design → Eng → DX), which is heavyweight for incremental fixes like typo corrections or CI config changes.

### Solution
Add routing condition in phase-2-design.md Part B based on AUTO-ESTIMATE data from Phase 1/6 PREP:

```
IF change_type == "修改已存在代码" AND modules_count > 0:
  → SKIP autoplan, go directly: brainstorming → delphi-review (lightweight)
ELSE IF change_type == "新增功能" AND modules_count == 0:
  → Standard path: brainstorming → autoplan → delphi-review
```

The lightweight delphi-review uses 2 experts, 1 round. Both paths still require APPROVED verdict (HARD-GATE preserved).

### Decision Boundary
- `modules_count > 0` = touches existing modules → incremental
- `modules_count == 0` = no existing modules touched → greenfield/new feature

### Files
- `skills/sprint-flow/references/phase-2-design.md`: ~20 lines modified (routing condition in Part B)
- `skills/sprint-flow/SKILL.md`: ~5 lines updated (DESIGN section routing description)

---

## Issue #307: CI Mutation Testing Fix

### Problem
`getProjectHooksDir()` in `src/npm-package/lib/update-hooks.js` throws `"Not a Git repository"` when Stryker runs tests in its sandbox environment (no `.git` directory in Stryker's temp working directory).

### Root Cause
The test `updateHooks getProjectHooksDir returns .git/hooks path under cwd` assumes `process.cwd()` resolves to a directory containing `.git`. Stryker's sandboxed test execution changes the working directory to one without `.git`.

### Solution
Fix the test, not the production code. The production function is correct — it should throw when `.git` is absent. The test needs proper isolation:

1. Create a temp directory with a `.git` subdirectory before the assertion
2. Use `process.chdir()` to enter the temp dir, or mock `process.cwd()`
3. Clean up the temp directory after the test

### Files
- `src/npm-package/lib/__tests__/update-hooks.test.js`: ~5 lines (test isolation fix)
- No production code changes

### No Changes To
- `update-hooks.js` (correct behavior)
- `.github/workflows/mutation-test.yml` (CI config is correct)
- `stryker.conf.json` (no Stryker config changes needed)

---

## Issue #308: Sprint Archiving

### Problem
`.sprint-state/` is gitignored and deleted after Phase 6/6 CLOSE cleanup. All structured decision records (specification, Delphi consensus, phase outputs) are permanently lost.

### Solution
Add archiving step in Phase 6/6 CLOSE before cleanup:

1. Copy `.sprint-state/` → `.sprint-history/<sprint-id>/`
2. Update `.gitignore` to track `.sprint-history/` (add `!.sprint-history/`)
3. Archive: `specification.yaml`, `delphi-reviewed.json`, `sprint-state.json`, `phase-outputs/`
4. Skip: `.sprint-state/` temp files, cache files

### Naming
Use sprint ID from `sprint-state.json` (e.g., `sprint-2026-07-09-01/`)

### Files
- `skills/sprint-flow/references/phase-6-close.md`: +~20 lines (archiving step)
- `.gitignore`: 1 line (`!.sprint-history/`)

---

## Cross-Cutting Concerns

### Cohesion Between #305 and #306
Both modify sprint-flow skill docs. Changes must be consistent:
- #305 adds TDD enforcement in BUILD → must not conflict with #306's DESIGN routing
- #306's routing fork produces the same output format regardless of path (delphi-reviewed.json always present before BUILD)

### Total Impact
| Issue | Files | Lines | Type |
|-------|-------|-------|------|
| #305 | AGENTS.md, phase-3-build.md | +25 | Doc + skill reference |
| #306 | phase-2-design.md, SKILL.md | ~25 modified | Skill reference |
| #307 | update-hooks.test.js | ~5 | Test fix |
| #308 | phase-6-close.md, .gitignore | +21 | Skill reference + config |
| **Total** | **7 files** | **~76 lines** | |

### Implementation Order
1. #307 (CI fix, independent, quick win)
2. #305 (TDD enforcement, foundational for BUILD)
3. #306 (DESIGN routing, depends on AUTO-ESTIMATE from PREP)
4. #308 (CLOSE archiving, last phase change)

### Testing
- #307: Run `npm test -- update-hooks` to verify CI fix
- #305, #306, #308: Documentation changes only — verify via manual review and `gate-check`
