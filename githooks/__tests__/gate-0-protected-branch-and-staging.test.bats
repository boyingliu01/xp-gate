#!/usr/bin/env bats
# @test REQ-806-GATE0
# @intent Gate 0 claims to be a "Version Consistency Check" on protected
#         branches, but three defects made it verify less than its name promises:
#         (D1) `main` was absent from the protected-branch list, so the check ran
#         on ZERO commits in any repo whose default branch is `main` -- including
#         this one, verified live: it printed "PASSED (non-protected branch:
#         main)" while source was staged with no version bump; (D2) the
#         SKIP_VERSION_CHECK arm never assigned GATE_0_STATUS, so it inherited
#         the initialization value PASS and a gate that did nothing was reported
#         and scored as a success (same defect class as #800 in Gate 7);
#         (D4) it `git add`ed every dirty AGENTS.md without checking that the
#         ONLY change was the header line sync-version rewrites, so unrelated
#         unstaged edits were silently folded into the commit.
# @covers AC-806-D1 AC-806-D2 AC-806-D4
#
# WHY THIS DRIVES gate_0_run DIRECTLY INSTEAD OF A REAL `git commit`
# Measured: one commit through the full hook chain in a throwaway fixture takes
# ~21 s, and a single bats case exceeded 120 s, because `gate_0_run` in
# `gate-entries/gate-0-entry.sh` spans lines 40-857 and carries the whole chain's
# shared preamble. Running the chain to observe Gate 0's verdict would also let
# ANY other gate decide the outcome -- measured: Gate 1 (ruff formatting) blocked
# the fixture first, which would make an exit-code assertion pass while Gate 0
# stayed broken. So the gate is called directly with its external helpers
# stubbed, and its verdict is read from the status it hands `record_gate_audit`.
# That is the same contract the report reads (`GATE_0_STATUS` in
# gate-13-entry.sh), at ~2 s per case instead of >120 s.
#
# FIXTURE SOURCE FILE MUST BE A REAL LANGUAGE EXTENSION.
# Measured while writing these tests: a `.txt` fixture made Gate 0 report
# "build-tooling-only changes" (`has_source=[]`), because .txt is not in its
# source-extension list. The test then passed/failed for reasons unrelated to
# the branch under test. Python is used because it is claimed by the has_source
# list while the fixtures never invoke its adapter.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE_0_ENTRY="$REPO_ROOT/githooks/gate-entries/gate-0-entry.sh"
  FIXTURE_REPO="$(mktemp -d)"

  (
    cd "$FIXTURE_REPO" || exit 1
    git init -q -b master
    git config user.email test@test.com
    git config user.name Test
    echo '1.0.0.0' > VERSION
    echo '# changelog' > CHANGELOG.md
    printf 'def f():\n    return 1\n' > a.py
    # Gate 0 only reaches its AGENTS.md auto-staging loop when a sync-version
    # implementation exists in the fixture (it looks for scripts/sync-version.cjs,
    # then scripts/sync-version.sh). Without one, SYNC_VERSION_CMD stays empty,
    # the loop never runs, and the D4 tests would pass vacuously by exercising a
    # code path that was never entered. Measured: this was exactly why the
    # header-only test failed while the "not staged" test passed.
    mkdir -p scripts
    cat > scripts/sync-version.cjs <<'STUB'
const fs = require('fs');
const path = require('path');
const root = process.argv[2] || process.cwd();
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (entry.name !== 'AGENTS.md') continue;
    const before = fs.readFileSync(full, 'utf8');
    const after = before.replace(/^\*\*Version:\*\*.*$/m, '**Version:** ' + version);
    if (after !== before) fs.writeFileSync(full, after);
  }
}
walk(root);
STUB
    git add -A
    git commit --no-verify -q -m seed
  )
}

teardown() {
  rm -rf "$FIXTURE_REPO"
}

# Stage one new Python file, which Gate 0's has_source list counts as source.
stage_python_change() {
  cd "$FIXTURE_REPO" || return 1
  printf 'def g():\n    return 2\n' > b.py
  git add b.py
}

# Call gate_0_run in the fixture with its external collaborators stubbed.
# `record_gate_audit` is the observation point: Gate 0 calls it exactly once,
# immediately after reaching a verdict, so it captures the status the report
# would read without running the rest of the chain.
run_gate_0() {
  cd "$FIXTURE_REPO" || return 1
  cat > harness.sh <<'HARNESS'
set +u
gate_start_ms() { echo 0; }
record_gate_audit() { printf '%s' "$3" > "$STATUS_OUT"; }
gate_enabled() { return "${GATE_ENABLED_RC:-0}"; }
gate_selection_active() { return "${SELECTION_RC:-1}"; }
export_staged_acm_cache() { :; }
jscpd_is_build_output() { return 1; }
detect_docs_only_commit() { cat >/dev/null; echo false; }
_detect_ext_lang() { echo ""; }
_detect_subdir() { echo ""; }
_cmake_multi_module_root() { return 1; }
_gradle_multi_module_root() { return 1; }
now_ms() { echo 0; }
source "$GATE_0_ENTRY"
gate_0_run > "$GATE0_OUT" 2>&1
HARNESS
  # `|| true`: gate_0_run legitimately returns 1 when it BLOCKs, which is the
  # outcome several of these tests expect. Without it the shell's errexit
  # semantics treat the expected block as a harness failure and the assertion
  # never runs.
  STATUS_OUT="$FIXTURE_REPO/status.txt" GATE0_OUT="$FIXTURE_REPO/gate0.log" \
    GATE_0_ENTRY="$GATE_0_ENTRY" bash harness.sh >/dev/null 2>&1 || true
  GATE0_STATUS_OBSERVED="$(cat "$FIXTURE_REPO/status.txt" 2>/dev/null)"
  GATE0_LOG="$(cat "$FIXTURE_REPO/gate0.log" 2>/dev/null)"
  return 0
}

# ---------------------------------------------------------------------------
# D1 — `main` must be a protected branch
# ---------------------------------------------------------------------------

@test "AC-806-D1: branch 'main' is treated as protected, so a version-less commit is BLOCKED" {
  # The defect, reproduced live before the fix:
  #   ✅ PASSED - Gate 0: Version Consistency Check (non-protected branch: main)
  # while a .py source file was staged and VERSION/CHANGELOG were untouched.
  # `main` was simply absent from PROTECTED_BRANCHES="master develop trunk mainline".
  cd "$FIXTURE_REPO" || return 1
  git checkout -q -b main
  stage_python_change

  run_gate_0

  [[ "$GATE0_LOG" != *"non-protected branch"* ]]
  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ]
}

@test "AC-806-D1 anti-vacuity: a feature branch still passes without a version bump" {
  # Guards the opposite failure: marking every branch protected would block
  # every commit. The fix must recognise DEFAULT branches, not disable the
  # non-protected arm.
  cd "$FIXTURE_REPO" || return 1
  git checkout -q -b feature/whatever
  stage_python_change

  run_gate_0

  [[ "$GATE0_LOG" == *"non-protected branch"* ]]
  [ "$GATE0_STATUS_OBSERVED" = "PASS" ]
}

@test "AC-806-D1: the protected set names 'main' and consults the local origin/HEAD" {
  # Root cause was a hand-maintained literal list that omitted the most common
  # default branch name in use today. Pinning only the literal would let the next
  # default name re-create the defect silently, so pin the mechanism too.
  run grep -q 'PROTECTED_BRANCHES="main' "$GATE_0_ENTRY"
  [ "$status" -eq 0 ]
  run grep -qE 'refs/remotes/origin/HEAD' "$GATE_0_ENTRY"
  [ "$status" -eq 0 ]
}

@test "AC-806-D1: a local origin/HEAD default branch is honoured even if not in the literal list" {
  # A repo whose default branch is something else (a renamed default, or
  # `git init -b trunk`) must be protected without editing the script.
  cd "$FIXTURE_REPO" || return 1
  git checkout -q -b release-line
  git update-ref refs/remotes/origin/release-line HEAD
  git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/release-line
  stage_python_change

  run_gate_0

  [[ "$GATE0_LOG" != *"non-protected branch"* ]]
  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ]
}

# ---------------------------------------------------------------------------
# D2 — a skipped Gate 0 must not be reported as PASS
# ---------------------------------------------------------------------------

@test "AC-806-D2: SKIP_VERSION_CHECK=1 records SKIP, not PASS" {
  # The defect: the `elif [ "${SKIP_VERSION_CHECK:-}" = "1" ]` arm only echo'd,
  # leaving GATE_0_STATUS at its line-42 initialization of PASS. The report
  # (gate-13-entry.sh) counts SKIP and PASS in different buckets, so a skipped
  # gate inflated the passed count -- "skipped" was indistinguishable from
  # "verified". Same shape as #800, which rendered a Gate 7 SKIP as PASSED.
  cd "$FIXTURE_REPO" || return 1
  git checkout -q -b main
  stage_python_change

  SKIP_VERSION_CHECK=1 run_gate_0

  [[ "$GATE0_LOG" == *"SKIPPED - Gate 0"* ]]
  [ "$GATE0_STATUS_OBSERVED" = "SKIP" ]
}

@test "AC-806-D2 anti-vacuity: XP_GATE_ONLY_GATE not selecting Gate 0 also records SKIP" {
  # The other skip path already set SKIP correctly; pinning it keeps the fix
  # from being applied to only one of the two arms.
  cd "$FIXTURE_REPO" || return 1
  git checkout -q -b main
  stage_python_change

  GATE_ENABLED_RC=1 run_gate_0

  [[ "$GATE0_LOG" == *"SKIPPED - Gate 0"* ]]
  [ "$GATE0_STATUS_OBSERVED" = "SKIP" ]
}

@test "AC-806-D2 anti-vacuity: a real version bump still records PASS" {
  # Guards against "assign SKIP everywhere", which would satisfy the tests above
  # while making every successful gate look like it never ran.
  cd "$FIXTURE_REPO" || return 1
  git checkout -q -b main
  echo '1.0.0.1' > VERSION
  git add VERSION

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "PASS" ]
}

# ---------------------------------------------------------------------------
# D4 — never fold unrelated AGENTS.md edits into the commit
# ---------------------------------------------------------------------------

@test "AC-806-D4: an unrelated AGENTS.md body edit is NOT staged by Gate 0" {
  # The defect: `if ! git diff --quiet -- "$agents_file"; then git add ...; fi`
  # treats ANY modification as a header refresh. A developer with a half-written
  # AGENTS.md section would have it committed by an unrelated VERSION bump.
  cd "$FIXTURE_REPO" || return 1
  mkdir -p sub
  printf '**Version:** 0.0.0.0\n\n# Body\n' > sub/AGENTS.md
  git add sub/AGENTS.md
  git commit --no-verify -q -m "chore: seed nested AGENTS.md"

  # An unrelated, UNSTAGED body edit on top of that same file.
  printf '**Version:** 0.0.0.0\n\n# Body\n\n## Half-written thought\n' > sub/AGENTS.md

  echo '1.0.0.1' > VERSION
  git add VERSION

  run_gate_0

  # Whatever Gate 0 decided, the half-written section must NOT end up staged.
  run git diff --cached -- sub/AGENTS.md
  [[ "$output" != *"Half-written thought"* ]]
}

@test "AC-806-D4 anti-vacuity: the header-only refresh is still auto-staged" {
  # Guards against "stop staging AGENTS.md at all", which would satisfy the test
  # above by deleting the fan-out atomicity the feature exists for.
  cd "$FIXTURE_REPO" || return 1
  mkdir -p sub
  printf '**Version:** 0.0.0.0\n\n# Body\n' > sub/AGENTS.md
  git add sub/AGENTS.md
  git commit --no-verify -q -m "chore: seed nested AGENTS.md"

  # Only the header line differs, exactly as sync-version would leave it.
  printf '**Version:** 1.0.0.1\n\n# Body\n' > sub/AGENTS.md

  echo '1.0.0.1' > VERSION
  git add VERSION

  run_gate_0

  # A header-only change is legitimate and must be folded into the commit.
  run git diff --cached -- sub/AGENTS.md
  [[ "$output" == *"**Version:** 1.0.0.1"* ]]
}

@test "AC-806-D4 anti-vacuity: sync-version is still invoked when VERSION is staged" {
  run grep -qE 'sync-version' "$GATE_0_ENTRY"
  [ "$status" -eq 0 ]
}
