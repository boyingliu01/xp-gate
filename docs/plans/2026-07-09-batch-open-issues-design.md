# Batch Open Issues — Unified Design

**Date**: 2026-07-09
**Sprint**: sprint-2026-07-09-01
**Issues**: #305, #306, #307, #308
**Status**: Revised (Round 1 Delphi feedback applied)

## Overview

Batch resolution of all 4 remaining open issues in a single sprint. Three issues (#305, #306, #308) touch sprint-flow skill internals and must be designed cohesively. Issue #307 is an independent CI test fix.

## Issue #305: TDD Enforcement in BUILD Phase

### Problem
Sisyphus orchestrator's AGENTS.md instructs "DECOMPOSE AND DELEGATE — YOU ARE NOT AN IMPLEMENTER" which overrides the test-driven-development skill requirement. The orchestrator delegates implementation directly without writing failing tests first.

### Solution
Two-layer enforcement: AGENTS.md (passive documentation) + SKILL.md phase-3-build.md (active orchestration gate).

1. **AGENTS.md Phase 2B section**: Add "Pre-Implementation TDD Check (MANDATORY)" before the delegation section as an informational reminder. This sets the expectation but is NOT the enforcement mechanism.
2. **Phase 3 BUILD entry point (SKILL.md + phase-3-build.md)**: Before dispatching to ralph-loop or parallel dispatch, MUST verify for each REQ:
   - A corresponding test file exists (or will be created as step 0 of the REQ)
   - The test is in RED state (expected to fail)
   - Only then proceed to implementation delegation (GREEN)
   - After implementation passing, run REFACTOR
3. **TDD-GATE**: If no test exists and ralph-loop is about to create it, mark REQ as `[TDD-RED]` and let ralph-loop proceed (ralph-loop creates the failing test as its first step). If a test already exists and is passing BEFORE implementation begins, mark REQ as suspicious (TDD bypass detected).
4. **Todo format**: Extend the existing "WHERE HOW WHY" format with TDD phase prefix in the content field. The prefix is `[TDD-RED]`, `[TDD-GREEN]`, or `[TDD-REFACTOR]`. Priority field (high/medium/low) is separate and unchanged.

### Files
- `AGENTS.md`: +~10 lines in Phase 2B section (informational reminder)
- `skills/sprint-flow/references/phase-3-build.md`: +~20 lines (orchestration-level TDD-GATE)
- `skills/sprint-flow/SKILL.md`: +~5 lines (Phase 3 BUILD entry point TDD check)

### No Changes To
- `test-driven-development` skill itself (already correct)
- `ralph-loop` skill (already calls TDD internally — the new TDD-GATE is a pre-condition check, not a replacement)

### Deadlock Prevention
The TDD-GATE at BUILD entry is a PRE-RALPH-LOOP check, not a replacement for ralph-loop's internal TDD:
- If no test exists for a REQ → ralph-loop IS allowed to proceed (it creates the test as step 0)
- If test exists and is GREEN before any implementation → BLOCK (TDD bypass)
- The gate verifies TDD DISCIPLINE was followed, not that TDD was skipped

### Limitation
This enforcement is instructional (LLM follows SKILL.md instructions), not programmatic. The same mechanism that allows the orchestrator to skip TDD also allows it to skip this check. A future automated gate (e.g., checking git staging order: test file must be staged before source file) would provide stronger enforcement. For now, making the requirement explicit in SKILL.md shifts the default from "delegate immediately" to "check for test first."

---

## Issue #306: DESIGN Routing Fork

### Problem
Sprint-flow always routes Phase 2/6 DESIGN through autoplan (gstack: CEO → Design → Eng → DX), which is heavyweight for incremental fixes like typo corrections or CI config changes.

### Solution
Add routing condition in phase-2-design.md Part B based on `change_type` from AUTO-ESTIMATE (Phase 1/6 PREP). The `change_type` field is already computed during Phase 1 PREP and stored in `sprint-state.json` under `scope.change_type`. No new data interface needed — phase-2-design.md reads this at entry via the existing sprint-state.

```
IF sprint-state.scope.change_type == "修改已存在代码":
  → SKIP autoplan, go directly: brainstorming → delphi-review (lightweight: 2 experts, 1 round)
ELSE (change_type == "新增功能"):
  → Standard path: brainstorming → autoplan → delphi-review (3 experts)
```

The lightweight delphi-review uses 2 experts, 1 round. Both paths still require APPROVED verdict (HARD-GATE preserved).

### Decision Boundary
- `change_type == "修改已存在代码"` = touching existing codebase → incremental optimization → skip autoplan
- `change_type == "新增功能"` = greenfield/new feature → run full autoplan pipeline

### Lightweight Delphi Configuration
The lightweight mode is selected by passing expert count and round limit as parameters to the delphi-review skill invocation. No `.delphi-config.json` schema change needed — the orchestrator passes `--experts 2 --max-rounds 1` to the skill invocation.

### Edge Cases Handled
- `change_type == "新增功能"` on an existing codebase (greenfield within existing project) → standard autoplan (safer)
- `change_type` undefined or missing → default to standard autoplan path (fail-safe)

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
Fix the test, not the production code. The production function is correct — it should throw when `.git` is absent. The test needs proper isolation following the existing test pattern already used in the same test file:

1. The test suite already uses `vi.spyOn(process, 'cwd').mockReturnValue()` pattern for other tests (e.g., the "throws when .git/ does not exist" test)
2. For the specific test `updateHooks getProjectHooksDir returns .git/hooks path under cwd`: mock `process.cwd()` to return a path that contains a `.git` subdirectory
3. Create a temp directory with `fs.mkdirSync(path.join(tmpProject, '.git'))` before the test assertion
4. The test suite's `afterEach` already cleans up with `fs.rmSync(tmpProject, { recursive: true, force: true })` which handles the `.git` subdirectory

### Verification
- Local: `npm test -- update-hooks` passes
- CI: Trigger mutation-test workflow via workflow_dispatch to confirm Stryker no longer fails

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
2. **No `.gitignore` change needed**: `.sprint-history/` is NOT currently listed in `.gitignore`, so git tracks it by default. The `.sprint-state/` entry on line 59 only matches `.sprint-state/` exactly — it does NOT match `.sprint-history/`. No negation pattern required.
3. Archive: all `.yaml`, `.json`, `.md` files under `.sprint-state/` (explicit include list). Exclude: `*.tmp`, `*.cache` files.
4. Conflict resolution: if `.sprint-history/<sprint-id>/` already exists, append a timestamp suffix (e.g., `<sprint-id>-20260709T120000`) before archiving.

### Naming
Use sprint ID from `sprint-state.json` (e.g., `sprint-2026-07-09-01/`)

### Files
- `skills/sprint-flow/references/phase-6-close.md`: +~25 lines (archiving step with conflict resolution)
- No `.gitignore` change needed (`.sprint-history/` not currently ignored)

---

## Cross-Cutting Concerns

### Cohesion Between #305 and #306
Both modify sprint-flow skill docs. Changes must be consistent:
- #305 adds TDD enforcement in BUILD → must not conflict with #306's DESIGN routing
- #306's routing fork produces the same output format regardless of path (delphi-reviewed.json always present before BUILD)

### Total Impact
| Issue | Files | Lines | Type |
|-------|-------|-------|------|
| #305 | AGENTS.md, phase-3-build.md, SKILL.md | +35 | Doc + skill reference + orchestration gate |
| #306 | phase-2-design.md, SKILL.md | ~25 modified | Skill reference |
| #307 | update-hooks.test.js | ~5 | Test fix |
| #308 | phase-6-close.md | +25 | Skill reference |
| **Total** | **6 files** | **~90 lines** | |

### Implementation Order
1. #305 (TDD enforcement, foundational for BUILD integrity — highest risk, test early)
2. #306 (DESIGN routing, depends on AUTO-ESTIMATE from PREP)
3. #307 (CI fix, independent, quick win)
4. #308 (CLOSE archiving, last phase change)

### Testing
- #305: Behavioral verification — run a sprint-flow and verify TDD-GATE activates at BUILD entry. Verify deadlock does not occur with ralph-loop.
- #306: Behavioral verification — verify routing fork activates correctly for incremental vs greenfield sprints.
- #307: Run `npm test -- update-hooks` locally; trigger mutation-test CI workflow via workflow_dispatch to verify Stryker fix.
- #308: Manual verification — archive created in `.sprint-history/` after CLOSE. Verify git tracks it without `.gitignore` changes.
