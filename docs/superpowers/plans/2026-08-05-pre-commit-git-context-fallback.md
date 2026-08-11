# Pre-commit Git Context Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make current pre-commit hooks safely run Git-creating tests even when a stale global adapter installation lacks `run_without_git_context`.

**Architecture:** Keep global-first adapter resolution unchanged. After sourcing the selected adapter-common file, define a self-contained compatibility helper only when the selected adapter did not provide it; repository-scoped JavaScript Git calls independently clear inherited Git-local variables before honoring their explicit `cwd`.

**Tech Stack:** Bash, BATS, Node.js CommonJS, Vitest, ESLint, Git hooks

---

### Task 1: Lock Repository-scoped Git Behavior

**Files:**
- Modify: `src/npm-package/lib/sprint-status.js:230-239`
- Modify: `src/npm-package/lib/phase-transition.js:65-78`
- Test: `src/npm-package/lib/__tests__/sprint-status-rework.test.js`

- [ ] **Step 1: Verify the regression test fails before the production fix**

Run the inherited-environment test with `getFixCommitCount()` using only `cwd`.

```bash
npx vitest run src/npm-package/lib/__tests__/sprint-status-rework.test.js -t "takes precedence over inherited Git hook"
```

Expected: FAIL because the outer repository reports three fix commits instead of the target repository's one.

- [ ] **Step 2: Isolate repository-scoped Git child processes**

Clone `process.env`, delete Git's repository-local variables, and pass the sanitized environment with the explicit `cwd` to `execSync()` in `getFixCommitCount()` and `getCurrentHeadCommit()`.

- [ ] **Step 3: Verify repository-scoped behavior**

```bash
GIT_DIR="$(GIT_MASTER=1 git rev-parse --git-dir)" GIT_INDEX_FILE="$(GIT_MASTER=1 git rev-parse --git-path index)" npx vitest run src/npm-package/lib/__tests__/sprint-status-rework.test.js src/npm-package/lib/__tests__/phase-transition.test.js
npx eslint src/npm-package/lib/sprint-status.js src/npm-package/lib/phase-transition.js src/npm-package/lib/__tests__/sprint-status-rework.test.js --max-warnings 0
```

Expected: 41 tests pass, lint exits 0, and branch HEAD is unchanged by test-created commits.

- [ ] **Step 4: Commit the repository boundary fix**

```bash
GIT_MASTER=1 git add src/npm-package/lib/sprint-status.js src/npm-package/lib/phase-transition.js src/npm-package/lib/__tests__/sprint-status-rework.test.js
GIT_MASTER=1 git commit -m "fix(git): isolate repository-scoped CLI queries from hook context"
```

### Task 2: Add Pre-commit Compatibility Fallback

**Files:**
- Modify: `githooks/pre-commit:27-32`
- Modify: `src/npm-package/hooks/pre-commit:27-32`
- Test: `githooks/__tests__/adapter-common.test.bats`

- [ ] **Step 1: Write the failing stale-adapter test**

Add a BATS test that extracts and evaluates the fallback block after defining a stale-adapter state with no `run_without_git_context`. Invoke the resulting helper through an `npx` stub and assert that `GIT_DIR` and `GIT_INDEX_FILE` are absent.

- [ ] **Step 2: Run the test to verify RED**

```bash
bats githooks/__tests__/adapter-common.test.bats --filter "pre-commit provides Git context fallback"
```

Expected: FAIL because `pre-commit` has no fallback definition.

- [ ] **Step 3: Implement the minimal fallback**

Immediately after sourcing adapter-common, guard with `if ! declare -F run_without_git_context >/dev/null 2>&1; then`. Inside the guard, define the same `env -u` command used by the canonical helper. Apply the identical change to the npm hook mirror.

- [ ] **Step 4: Verify fallback and mirrors**

```bash
bats githooks/__tests__/adapter-common.test.bats --filter "Git context"
bash -n githooks/pre-commit
bash -n src/npm-package/hooks/pre-commit
cmp -s githooks/pre-commit src/npm-package/hooks/pre-commit
```

Expected: all matching BATS tests pass, syntax checks exit 0, and mirror comparison exits 0.

- [ ] **Step 5: Commit the compatibility fallback**

```bash
GIT_MASTER=1 git add githooks/pre-commit src/npm-package/hooks/pre-commit githooks/__tests__/adapter-common.test.bats
GIT_MASTER=1 git commit -m "fix(pre-commit): support stale global adapter helpers"
```

### Task 3: Prove the Real Hook Path

**Files:**
- Test: `src/npm-package/lib/__tests__/doctor.test.js`

- [ ] **Step 1: Apply the doctor test isolation update**

Add `../doctor-tui` to the invalidated module list and update the pre-push fixture header to `Pre-push Hook — 8 gates:`.

- [ ] **Step 2: Run focused verification**

```bash
npx vitest run src/npm-package/lib/__tests__/doctor.test.js src/npm-package/lib/__tests__/phase-transition.test.js src/npm-package/lib/__tests__/sprint-status-rework.test.js
npx eslint src/npm-package/lib/__tests__/doctor.test.js --max-warnings 0
```

Expected: 79 tests pass and lint exits 0.

- [ ] **Step 3: Commit through the real pre-commit hook**

Record HEAD, commit `doctor.test.js` without bypassing hooks, then compare HEAD and history.

```bash
GIT_MASTER=1 git add src/npm-package/lib/__tests__/doctor.test.js
GIT_MASTER=1 git commit -m "test(doctor): isolate TUI modules and update pre-push fixture"
GIT_MASTER=1 git log --oneline -6
```

Expected: the commit succeeds and exactly one commit is added; no `feat: initial`, `fix: one`, or `file.txt` test artifacts appear.

- [ ] **Step 4: Run final branch verification**

```bash
npm test
npm run lint
GIT_MASTER=1 git status --short
GIT_MASTER=1 git log --oneline origin/main..HEAD
```

Expected: tests and lint pass; only the temporary untracked dependency symlink may remain and must be removed before push.
