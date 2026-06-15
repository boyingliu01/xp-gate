# Sprint A: Gate Integrity & Init Bug Fixes

> **Design Doc — Phase 0 THINK output for Sprint A**
> **Worktree:** `sprint/2026-06-14-01`
> **Target issues:** #184, #185, #210, #211 (note: #210/#211 already fixed in `e215a50`)

## Problem Analysis

### Issue #184: Gate 3/4 Status Override

**Root cause:** Two lines in `githooks/pre-commit` unconditionally set gate status to "PASS" after all conditional logic:

```bash
# L973 (Gate 3)
GATE_3_STATUS="PASS"  # Unconditional — overrides any WARN from lizard-not-installed path
record_gate_audit "gate-3" "complexity" "$GATE_3_STATUS" ...

# L1043 (Gate 4)
GATE_4_STATUS="PASS"  # Unconditional — overrides legitimate WARN/BLOCK states
record_gate_audit "gate-4" "principles" "$GATE_4_STATUS" ...
```

**Impact:** The audit log always records Gate 3 and Gate 4 as PASS, even when:
- lizard isn't installed → should be `WARN`
- principles checker found errors → should be `BLOCK` (exit 1 already happens but status is wrong)
- principles checker not found → should be `SKIP`

**Fix strategy:** Initialize each `GATE_N_STATUS` to `""`, set it properly in each branch of the conditional logic, and only `record_gate_audit` once at the end. If the status is still empty after all branches, default to "UNKNOWN" (safety net to catch new code paths).

### Issue #185: SKIP→PASS Violations

**Root cause:** ~20 locations in `githooks/pre-commit` and `githooks/pre-push` use `echo "✅ PASSED - ... (SKIP, reason)"` when a tool is unavailable or a check is skipped. Per `QUALITY-GATES-CODE-OF-CONDUCT.md`, a gate that didn't actually run MUST NOT report PASSED.

**Impact:** Violates the contract between gate logic and audit log consumers. A commit that skipped multiple gates still shows "all green" in the output.

**Fix strategy:** Replace all occurrences of `echo "✅ PASSED - ... (SKIP, ...)"` with `echo "⏭️  SKIPPED - ..."` (or similar non-PASS message). Maintain running exit code logic — SKIP should not cause the hook to exit 1; it should be a non-blocking status.

### Issue #210/#211: Missing Module Installation

**Already fixed in commit `e215a50`.** The `init.js` already copies `principles/`, `mutation/`, `mock-policy/` to `.xp-gate/modules/`. The worktree already has these changes. No further action needed.

## Design Decisions

### D1: Gate Status Classification

| Status | Meaning | Exit code impact |
|--------|---------|-----------------|
| `PASS` | Check ran and passed | None (0) |
| `WARN` | Check ran but found non-blocking issues | None (0) |
| `BLOCK` | Check ran and found blocking issues | Non-zero (exit 1) |
| `SKIP` | Check did not run (tool unavailable, no files to check) | None (0) |
| `ERROR` | Check failed to execute (unexpected error) | Non-zero (exit 1) |

The current code treats SKIP as PASS in user-facing output. Fix: SKIP output uses `⏭️  SKIPPED` emoji, while the audit status remains `SKIP`.

### D2: User-Facing Message Style

| Current (broken) | Fixed |
|-----------------|-------|
| `✅ PASSED - ... (SKIP, tool not available)` | `⏭️  SKIPPED - tool not available (install: ...)` |
| `✅ PASSED - ... (SKIP, no Node.js)` | `⏭️  SKIPPED - Node.js/npx not available` |
| `✅ PASSED - No source files changed (... skipped)` | `⏭️  SKIPPED - No matching source files changed` |
| `⚠️  WARN - tool not installed... ✅ PASSED` | `⚠️  WARN - tool not installed` (keep WARN, no PASS override) |

### D3: No `--allow-skip` Flag (per user instruction)

Per user decision during Phase -0.5: DO NOT add an `--allow-skip` flag. Code-of-Conduct already prohibits `--no-verify`. Tool-not-installed = SKIP, tool-installed-but-failed = BLOCK.

## Scope

| Issue | Scope | Status |
|-------|-------|--------|
| #184 | Gate 3/4 status override | **IN SCOPE** |
| #185 | All SKIP→PASS violations in pre-commit + pre-push | **IN SCOPE** |
| #210 | init missing principles/ module copy | ✅ ALREADY FIXED (e215a50) |
| #211 | init missing mutation/ module copy | ✅ ALREADY FIXED (e215a50) |

## Files to Modify

| File | Changes |
|------|---------|
| `githooks/pre-commit` | Fix #184 (L973, L1043) + #185 (~20 SKIP→PASS locations) |
| `githooks/pre-push` | Fix #185 (~5 SKIP→PASS locations) |
| `githooks/QUALITY-GATES-CODE-OF-CONDUCT.md` | Ensure SKIP semantics documented correctly |

## Testing

- **BATS tests** in `githooks/__tests__/` should already cover gate status output
- Verify manually: run `bash githooks/pre-commit` in a scenario where lizard is missing → Gate 3 shows `⏭️  SKIPPED` not `✅ PASSED`
- Verify `record_gate_audit` entries show correct status (not overridden to PASS)
