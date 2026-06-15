# Sprint A: Gate Integrity & Init Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Gate 3/4 status override (#184) and SKIP→PASS violations (#185) in `githooks/pre-commit` + `githooks/pre-push`. #210/#211 already fixed in `e215a50`.

**Architecture:** All changes are in bash hook scripts. The pre-commit file is ~2130 lines of shell with embedded Python/Node snippets. Changes are surgical — replace specific `echo` lines and status variable assignments. No structural refactoring.

**Tech Stack:** bash, githooks

**Worktree path:** `/home/boyingliu01/projects/xp-gate/.worktrees/sprint/sprint-2026-06-14-01`

---

### Task 1: Fix Gate 3 Status Override (#184 — L960-L974)

**Files:**
- Modify: `githooks/pre-commit` L960-L974

- [ ] **Step 1: Read the context around L960-L974**

The bug: L970 sets `GATE_3_STATUS="WARN"` when lizard isn't installed, but L973 unconditionally overrides it to `"PASS"`.

Fix: Remove the unconditional `GATE_3_STATUS="PASS"` on L973. The status is already set correctly in each branch:
- L970: `GATE_3_STATUS="WARN"` (lizard not installed)
- The complexity-check branch that actually runs (L900-L962) should also set GATE_3_STATUS. Let me check if it does.

- [ ] **Step 2: Read L900-L962 to verify the pass/fail branch sets GATE_3_STATUS**

Read the full Gate 3 logic to see if the tool-available branch properly sets `GATE_3_STATUS`.

- [ ] **Step 3: Apply edit — remove unconditional L973 override**

```bash
# Change: remove the unconditional PASS line
# Before (L973):
GATE_3_STATUS="PASS"
# After: (remove this line entirely)
```

The record_gate_audit call on L974 stays.

- [ ] **Step 4: If the tool-available success path doesn't set GATE_3_STATUS, add it**

In the lizard-success path (around L961), add `GATE_3_STATUS="PASS"` before the closing `fi`.

- [ ] **Step 5: Verify fix**

```bash
grep -n 'GATE_3_STATUS' githooks/pre-commit
```

Expected: GATE_3_STATUS is set in each branch, never unconditionally overridden at the end.

---

### Task 2: Fix Gate 4 Status Override (#184 — L1000-L1044)

**Files:**
- Modify: `githooks/pre-commit` L1000-L1044

- [ ] **Step 1: Read L1000-L1044**

Same pattern as Gate 3. L1043 has `GATE_4_STATUS="PASS"` that unconditionally overrides whatever the branches set.

Fix: Initialize to empty string at the top of Gate 4, remove the unconditional override, ensure each branch sets the correct status.

- [ ] **Step 2: Initialize GATE_4_STATUS before the conditional logic**

Add `GATE_4_STATUS=""` right after `GATE_4_START=$(gate_start_ms)` (L982). This ensures empty default = no branch ran.

- [ ] **Step 3: Ensure each branch sets GATE_4_STATUS properly**

Branches to check:
- L985: "documentation-only" → `GATE_4_STATUS="SKIP"`
- L1018: principles checker found errors (exit 1 already happens here, but set `GATE_4_STATUS="FAIL"`)
- L1023: principles checker passed → `GATE_4_STATUS="PASS"`
- L1029: checker execution failed → `GATE_4_STATUS="SKIP"`
- L1033: no npx → `GATE_4_STATUS="SKIP"`
- L1037: checker not found → `GATE_4_STATUS="SKIP"`
- L1040: no source files → `GATE_4_STATUS="SKIP"`

- [ ] **Step 4: Remove the unconditional L1043 override**

```bash
# Before:
GATE_4_STATUS="PASS"
# After: (remove this line entirely)
```

- [ ] **Step 5: Verify**

```bash
grep -n 'GATE_4_STATUS' githooks/pre-commit | grep -v '${GATE_4_STATUS}'
```

Expected: GATE_4_STATUS is set in each conditional branch, never unconditionally overridden.

---

### Task 3: Fix SKIP→PASS in Gate 0 (#185)

**Files:**
- Modify: `githooks/pre-commit` L158

- [ ] **Step 1: Fix SKIP_VERSION_CHECK message (L158)**

```bash
# Before:
echo "✅ PASSED - Gate 0: Version Consistency Check (SKIP_VERSION_CHECK=1 env var)"
# After:
echo "⏭️  SKIPPED - Gate 0: Version consistency (SKIP_VERSION_CHECK=1 env var)"
```

---

### Task 4: Fix SKIP→PASS in Gate 1 — TypeScript npx not available (L549), Python ruff not available (L635), Go golangci-lint not available (L715)

**Files:**
- Modify: `githooks/pre-commit` L549, L635, L715

- [ ] **Step 1: Fix TypeScript SKIP message (L549)**

```bash
# Before:
echo "✅ PASSED - Code Quality Gate (SKIP)"
# After:
echo "⏭️  SKIPPED - Code quality (npx not available, install Node.js)"
```

- [ ] **Step 2: Fix Python SKIP message (L635)**

```bash
# Before:
echo "✅ PASSED - Code Quality Gate (SKIP)"
# After:
echo "⏭️  SKIPPED - Code quality (ruff not available, run: pip install ruff)"
```

- [ ] **Step 3: Fix Go SKIP message (L715)**

```bash
# Before:
echo "✅ PASSED - Code Quality Gate (SKIP)"
# After:
echo "⏭️  SKIPPED - Code quality (golangci-lint not available)"
```

---

### Task 5: Fix SKIP→PASS in Gate 1 — Unavailable tools fallback (L821) and no-specific-checks (L826)

**Files:**
- Modify: `githooks/pre-commit` L821, L826

- [ ] **Step 1: Fix unavailable tools message (L821)**

```bash
# Before:
echo "✅ PASSED - Code Quality Gate (SKIP for unavailable tools)"
# After:
echo "⏭️  SKIPPED - Code quality (tools unavailable or failed)"
```

- [ ] **Step 2: Fix no-specific-checks message (L826)**

```bash
# Before:
echo "✅ PASSED - Code Quality Gate (no specific checks available)."
# After:
echo "⏭️  SKIPPED - Code quality (no specific checks for $PROJECT_LANG)"
```

---

### Task 6: Fix SKIP→PASS in Gate 2 — Documentation-only (L842) + no-tool languages (L889, L893) + no-SKIP-semantic for code that actually ran

**Files:**
- Modify: `githooks/pre-commit` L842, L889, L893

- [ ] **Step 1: Fix Gate 2 documentation-only skip (L842)**

```bash
# Before:
echo "✅ PASSED - Skipped (no source code to analyze)."
# After:
echo "⏭️  SKIPPED - Duplicate code (documentation project)"
```

- [ ] **Step 2: Fix Gate 2 PowerShell skip (L889)**

```bash
# Before:
echo "✅ PASSED - Skipped (no standardized tool for PowerShell duplicate detection)"
# After:
echo "⏭️  SKIPPED - Duplicate code (no tool for PowerShell)"
```

- [ ] **Step 3: Fix Gate 2 Shell skip (L893)**

```bash
# Before:
echo "✅ PASSED - Skipped (shell scripts, no standardized dup tool)"
# After:
echo "⏭️  SKIPPED - Duplicate code (no tool for shell scripts)"
```

---

### Task 7: Fix SKIP→PASS in Gate 3 — Documentation-only (L543)

**Files:**
- Modify: `githooks/pre-commit` L543

- [ ] **Step 1: Fix Gate 3 documentation-only bypass**

Actually this line also says "PASSED - Skipped (no source code to analyze)" — it's at L543. Let me verify if it's shared with Task 1.

Run: `grep -n "no source code to analyze" githooks/pre-commit`

If L543 exists, fix it:

```bash
# Before:
echo "✅ PASSED - Skipped (no source code to analyze)."
# After:
echo "⏭️  SKIPPED - Complexity (documentation project)"
```

---

### Task 8: Fix SKIP→PASS in Gate 4 (L1029, L1033, L1037, L1040)

**Files:**
- Modify: `githooks/pre-commit` L1029, L1033, L1037, L1040

- [ ] **Step 1: Fix checker execution failure (L1029)**

```bash
# Before:
echo "✅ PASSED - Principles check (SKIP, execution issue)"
# After:
echo "⏭️  SKIPPED - Principles check (execution issue)"
```

- [ ] **Step 2: Fix no Node.js (L1033)**

```bash
# Before:
echo "✅ PASSED - Principles check (SKIP, no Node.js)"
# After:
echo "⏭️  SKIPPED - Principles check (npx/Node.js not available)"
```

- [ ] **Step 3: Fix checker not found (L1037)**

```bash
# Before:
echo "✅ PASSED - Principles check (SKIP, not available in project)"
# After:
echo "⏭️  SKIPPED - Principles check (checker not found in project)"
```

- [ ] **Step 4: Fix no source files (L1040)**

```bash
# Before:
echo "✅ PASSED - No source files changed (principles check skipped)."
# After:
echo "⏭️  SKIPPED - Principles check (no matching source files changed)"
```

---

### Task 9: Fix SKIP→PASS in Gate 5 — Documentation-only (L1054)

**Files:**
- Modify: `githooks/pre-commit` L1054

- [ ] **Step 1: Read L1054 context**

Check if there's a "PASSED - Skipped (documentation project)" for Gate 5.

Run: `grep -n "documentation project\|PASSED.*Skipped" githooks/pre-commit | head -20`

- [ ] **Step 2: Fix if found**

```bash
echo "⏭️  SKIPPED - Tests (documentation project)"
```

---

### Task 10: Fix SKIP→PASS in Gate 7 — IaC adapter not found (L1744)

**Files:**
- Modify: `githooks/pre-commit` L1744

- [ ] **Step 1: Fix IaC SKIP message (L1744)**

Note: This one already sets `GATE_7_STATUS="SKIP"` correctly — only the echo message is wrong.

```bash
# Before:
echo "✅ PASSED - IaC Security (SKIP)"
# After:
echo "⏭️  SKIPPED - IaC security (no IaC adapter found)"
```

---

### Task 11: Fix SKIP→PASS in Gate 8 — gitleaks not installed (L1802) and not available echo

**Files:**
- Modify: `githooks/pre-commit` L1802

- [ ] **Step 1: Fix gitleaks not installed message (L1802)**

```bash
# Before:
echo "     ✅ Secret Scanning (SKIP, gitleaks not installed)"
# After:
echo "     ⏭️  SKIPPED - Secret scanning (gitleaks not installed)"
```

---

### Task 12: Fix SKIP→PASS in Gate 9 — no supported files (L1843) and semgrep runtime error (L1936) + initial PASS override (L1822)

**Files:**
- Modify: `githooks/pre-commit` L1822, L1843, L1936

- [ ] **Step 1: Fix initial GATE_9_STATUS override (L1822)**

Same #184 pattern: `GATE_9_STATUS="PASS"` at L1822 is an unconditional default before any logic runs.

Change to `GATE_9_STATUS=""` and ensure each branch sets it properly:
- L1837: semgrep not installed → `WARN` (already correct)
- L1843: no supported files → `SKIP` (currently `PASS` — fix both the status and the echo)
- L1854: scan passed → `PASS`
- L1922: scan found critical/high → `FAIL`
- L1931: scan found no critical → `PASS`
- L1937: runtime error → `SKIP`

- [ ] **Step 2: Fix no supported files (L1843)**

```bash
# Before:
echo "     ✅ PASSED - No supported language files in staged changes."
GATE_9_STATUS="PASS"
# After:
echo "     ⏭️  SKIPPED - SAST (no supported language files changed)"
GATE_9_STATUS="SKIP"
```

- [ ] **Step 3: Fix runtime error (L1936)**

```bash
# Before:
echo "     ✅ Semgrep SAST (SKIP, semgrep error)"
# After:
echo "     ⏭️  SKIPPED - SAST (semgrep runtime error)"
```

---

### Task 13: Verify and run pre-commit tests

**Files:**
- Run: `githooks/__tests__/` BATS tests

- [ ] **Step 1: Run BATS tests for pre-commit**

```bash
cd /home/boyingliu01/projects/xp-gate/.worktrees/sprint/sprint-2026-06-14-01/githooks/__tests__
bats *.bats 2>&1 || true
```

- [ ] **Step 2: Verify no regression**

Expected: all tests pass. Note any pre-existing failures.

- [ ] **Step 3: Run lsp_diagnostics on pre-commit**

```bash
# ShellCheck on modified file
shellcheck githooks/pre-commit 2>&1 || true
```
