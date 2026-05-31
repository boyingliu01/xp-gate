# Design: UI Sprint Detection & Forced Quality Gates (Issue #79)

**Date:** 2026-05-31
**Author:** Sisyphus
**Status:** ⏳ Awaiting Delphi Review APPROVAL

---

## Background

In an interview-bot admin UI iteration, an HTMX nested layout bug (page-in-page after updating a plan) was **not caught by any quality gate**:
- ✅ Type check passed
- ✅ Lint passed
- ✅ 707/707 tests passed
- ✅ Delphi 3-expert code review APPROVED
- ✅ `/design-review` passed
- ❌ **Only discovered during manual user acceptance**

Root cause: HTMX runtime behavior (`hx-on::after-request` calling `htmx.ajax()`) is a dynamic execution problem. Static analysis cannot catch it.

---

## Design Principles

| Principle | Detail |
|-----------|--------|
| **Result file validation pattern** | Same as Delphi walkthrough: AI skill executes separately → pre-push validates result file |
| **No direct gstack invocation from bash** | Gstack skills are AI agent instructions, not CLI commands |
| **Graceful degradation** | Tool unavailable → SKIP, not block (except npx tsx → mandatory for TS projects, consistent with jq policy) |
| **Bypass with audit** | Emergency fixes allowed but logged and reported in retro |
| **Consistency with existing gates** | main/master skip, gitignore policy, result file format aligned with code-walkthrough pattern |

---

## Architecture

### 1. UI Sprint Detection

**File:** `src/npm-package/lib/ui-detector.ts` (already exists)

**`--push-mode` behavior:** reads pushed file list from stdin (piped from pre-push `$PUSHED_FILES`), NOT from `git diff main..HEAD`:
```bash
echo "$PUSHED_FILES" | npx tsx src/npm-package/lib/ui-detector.ts --push-mode --from-stdin
```
This guarantees the detected file set exactly matches the push content.

**Detection logic:**

| Pattern | Extensions | Path Constraint |
|---------|-----------|----------------|
| Templates | `.njk`, `.html`, `.ejs`, `.hbs` | ✗ (match anywhere) |
| Components | `.tsx`, `.vue`, `.svelte`, `.jsx` | ✓ (views/, templates/, components/, pages/, src/ variants) |
| Styles | `.css`, `.scss`, `.sass`, `.less` | ✓ (views/, templates/, components/, pages/, src/ variants) |

**Extensibility:** `.ui-gate-ignore` config file to exclude specific paths (e.g., email templates, static docs).

### 2. Pre-push Integration

**File:** `githooks/pre-push` — new GATE UI section after Gate M2, before Delphi walkthrough

```
pre-push execution order:
  1. Gate M: Mutation Testing           [existing]
  2. Gate M2: Mock Density               [existing]
  3. GATE UI: UI Sprint Detection + Result Validation [NEW]
  4. Delphi Code Walkthrough              [existing]
```

**Flow:**
```
push → pre-push → GATE UI:
  a. Skip on main/master: "⚠️ Pushing to main/master — UI Gate skipped (pre-reviewed via PR)"
  b. Check bypass: XP_GATE_SKIP_UI_GATES=1 → audit log entry → PASS with warning
  c. Detect UI changes: echo "$PUSHED_FILES" | npx tsx ui-detector.ts --push-mode --from-stdin
  d. No UI changes → SKIP
  e. UI changes detected:
     → Check BOTH result files, emit merged error if both missing:
       - .ui-gate-result.json (NEW)
       - .code-walkthrough-result.json (existing)
     → Validate .ui-gate-result.json:
        - File exists
        - Commit hash matches HEAD
        - Verdict == "APPROVED"
        - Not expired (< 24h since generation)
     → PASS or BLOCK (single error message listing all missing files)
```

**npx tsx availability:** Mandatory for TS projects (same zero-degradation policy as jq). If unavailable → BLOCK with install instructions: `npm install -g tsx`.

### 3. Result File Format: `.ui-gate-result.json`

```json
{
  "commit": "abc123def456...",
  "verdict": "APPROVED",
  "expires": "2026-06-01T12:00:00Z",
  "design_review": "APPROVED",
  "browser_qa": "APPROVED",
  "ui_changes_detected": ["views/admin.njk", "static/admin.css"]
}
```

**Fields:**

| Field | Type | Purpose |
|-------|------|---------|
| `commit` | string | HEAD commit hash (must match pushed commit) |
| `verdict` | string | "APPROVED" or "REJECTED" |
| `expires` | string | ISO 8601 timestamp (generation + 24h) |
| `design_review` | string | `/design-review` outcome |
| `browser_qa` | string | `/qa` or `/qa-only` outcome |
| `ui_changes_detected` | string[] | Files that triggered UI detection |

**Git:** `.ui-gate-result.json` MUST be added to `.gitignore` — generated locally each sprint, not committed.

### 4. Bypass Mechanism

| Method | Behavior |
|--------|----------|
| `XP_GATE_SKIP_UI_GATES=1` env var | Allows push with warning |
| `XP_GATE_BYPASS_REASON="..."` env var | Required human-readable reason (min 10 non-whitespace chars) |
| **Validation** | pre-push rejects empty/whitespace-only reasons: `${#XP_GATE_BYPASS_REASON// /} -lt 10` → BLOCK + error |
| Audit log entry | Written to `.audit-log.jsonl` |

**`.audit-log.jsonl` spec** (one valid JSON per line):
```json
{
  "timestamp": "2026-05-31T15:30:00Z",
  "branch": "sprint/2026-05-31-02",
  "commit": "abc123...",
  "user": "boyingliu01",
  "reason": "Hotfix: payment timeout — UI review deferred to sprint retro",
  "bypass_type": "ui-gates",
  "gate_count": 1
}
```
- **Retention**: Last 100 entries trimmed on each write (prevents infinite growth)
- **Retro**: `grep '"bypass_type":"ui-gates"' .audit-log.jsonl | jq -s 'length'` → count bypasses
- **Abuse prevention**: `gate_count > 3` in rolling 30 days → triggers retro discussion item

**`.ui-gate-ignore` spec** (glob pattern, one per line, repo root):
```
# .ui-gate-ignore — paths excluded from UI detection
emails/**/*.html
docs/**/*.html
static/docs/**
*.test.html
```
**Default built-in exclusions** (hardcoded in ui-detector.ts, no config needed):
- `**/node_modules/**`
- `**/__tests__/**`
- `**/*.test.*`
- `coverage/`, `dist/`, `build/`

### 5. UI Sprint in Sprint Flow

During Phase 3 (REVIEW) entry:
1. Sprint orchestrator runs: `npx tsx src/npm-package/lib/ui-detector.ts --check-branch`
2. If `isUiSprint: true` → calls `/design-review` and `/qa-only`
3. AI agent generates `.ui-gate-result.json` → file path output to Phase 3 checklist
4. Pre-push validates this file on push

### 6. Non-Sprint Flow Developer Experience

Add `xp-gate ui-review` CLI command:
```bash
xp-gate ui-review
# → runs ui-detector on staged files
# → calls design-review + qa-only skills
# → generates .ui-gate-result.json
```

---

## What Changes

| # | File | Change |
|---|------|--------|
| 1 | `githooks/pre-push` | Add GATE UI section (~60 lines) after Gate M2 |
| 2 | `src/npm-package/lib/ui-detector.ts` | Add `--push-mode --from-stdin` and `--check-branch` flags |
| 3 | `src/npm-package/lib/__tests__/ui-detector.test.ts` | Add tests for push-mode and check-branch |
| 4 | `.gitignore` | Add `.ui-gate-result.json` |
| 5 | `src/npm-package/lib/audit-log.ts` | New: `.audit-log.jsonl` read/write + retro integration |
| 6 | `src/npm-package/lib/ui-review.ts` | New: `xp-gate ui-review` CLI command |

**Scope boundary:**
- IN: UI detection logic, pre-push integration, result file validation, bypass mechanism, audit logging, helper CLI
- OUT: gstack skill implementation (design-review, qa), CI workflow changes

---

## AI Coding Discipline

- **Principle 3: Surgical Changes** — Only modify the 3 files listed above
- **Principle 4: Goal-Driven Execution** — Verify by: push with UI files → Gate UI validates result file → push blocked without file
- **Verification loop** — After each edit: `npm test`, `lsp_diagnostics` on changed files
