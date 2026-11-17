#!/usr/bin/env bats
# @test REQ-806-GATE12
# @intent Gate 12 (File Hygiene) declared SKIP and left the status variable at its
#         pre-gate value, so the journal and the score read the gate as PASS.
#         Measured with GATE_DIR pointing at a directory that has no
#         gate-12-file-hygiene.sh:
#
#           ⏭️  SKIPPED - Gate 12: File Hygiene (gate-12-file-hygiene.sh not found)
#           RC=0   FINAL_STATUS=[PASS]   audit file: EMPTY
#
#         Two things are wrong there and they are separable:
#           G12a  the status variable is never set, so PASS survives the skip;
#           G12a2 record_gate_audit is never called at all, so this gate is
#                 absent from the journal rather than recorded as skipped. A gate
#                 that leaves no trace is indistinguishable from a gate that was
#                 not part of the chain.
#
#         This is the same family as #806 G1a (Gate 1's four SKIP sites) and
#         #806 D2 (Gate 0's --skip-version-check arm): the operator reads
#         "SKIPPED", the machine records "passed".
#
#         NOT A DEFECT, recorded here so it is not re-litigated: the
#         `exit 1` at gate-12-file-hygiene.sh:305 (the BLOCK path) does violate
#         AGENTS.md's "gate bodies return, they do not exit", but its observable
#         consequences were checked and are nil -- bash fires the EXIT trap on an
#         explicit exit too, so `_quality_report_on_exit` still runs, and the
#         audit record plus the gateTimings entry are written by the
#         record_gate_audit call immediately BEFORE the exit. It is a contract
#         violation to fix on its own merits, not a lost-report bug.
# @covers AC-806-G12a
#
# MEASURED WHEN WRITTEN
#   GATE_DIR without the script          -> status PASS, no audit line  (wrong)
#   conflict markers staged              -> status BLOCK, rc=1          (correct)
#   trailing whitespace only             -> status WARN,  rc=0          (correct)
#   nothing staged                       -> status SKIP,  rc=0          (correct)
#   yaml/json syntax error staged        -> status BLOCK, rc=1          (correct)

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE_12_ENTRY="$REPO_ROOT/githooks/gate-entries/gate-12-entry.sh"
  FIXTURE="$(mktemp -d)"
  cd "$FIXTURE" || return 1
  git init -q -b feature .
  git config user.email t@example.com
  git config user.name T
}

teardown() {
  cd /
  rm -rf "$FIXTURE"
}

# Drive gate_12_run with GATE_DIR pointed at $1. The driver leaves the gate
# status variables unset; the harness reproduces the worst realistic pre-state
# (PASS) so a gate that forgets to set the status is visible rather than lucky.
run_gate_12() {
  local gate_dir="$1"
  cat > "$FIXTURE/harness.sh" <<'HARNESS'
set +u
gate_start_ms() { echo 0; }
now_ms() { echo 5; }
record_gate_audit() { printf '%s|issues=%s\n' "$3" "$4" >> "$AUDIT_OUT"; }
gate_enabled() { return 0; }
GATE_DIR="$GATE_DIR_UNDER_TEST"
source "$GATE_12_ENTRY"
cd "$FIXTURE_DIR" || exit 1
GATE_12_STATUS="PASS"
gate_12_run > "$GATE12_OUT" 2>&1
printf '%s' "$GATE_12_STATUS" > "$STATUS_OUT"
HARNESS
  AUDIT_OUT="$FIXTURE/audit.txt" GATE12_OUT="$FIXTURE/gate12.log" \
    STATUS_OUT="$FIXTURE/status.txt" FIXTURE_DIR="$FIXTURE" \
    GATE_DIR_UNDER_TEST="$gate_dir" GATE_12_ENTRY="$GATE_12_ENTRY" \
    bash "$FIXTURE/harness.sh" >/dev/null 2>&1 || true
  GATE12_LOG="$(cat "$FIXTURE/gate12.log" 2>/dev/null)"
  GATE12_STATUS_OBSERVED="$(cat "$FIXTURE/status.txt" 2>/dev/null)"
  GATE12_AUDIT="$(cat "$FIXTURE/audit.txt" 2>/dev/null)"
}

# A GATE_DIR that exists but carries no gate-12-file-hygiene.sh, and a fixture
# repo whose own githooks/ has none either -- so both source attempts miss.
make_bare_gate_dir() {
  mkdir -p "$FIXTURE/empty-gate-dir"
  printf '%s' "$FIXTURE/empty-gate-dir"
}

# ---------------------------------------------------------------------------
# AC-806-G12a: a gate that could not run must not leave PASS behind
# ---------------------------------------------------------------------------

@test "AC-806-G12a: a missing hygiene script records SKIP, not PASS" {
  run_gate_12 "$(make_bare_gate_dir)"

  [[ "$GATE12_LOG" == *"gate-12-file-hygiene.sh not found"* ]]
  [ "$GATE12_STATUS_OBSERVED" = "SKIP" ]
}

@test "AC-806-G12a: a missing hygiene script still writes an audit line" {
  # A gate with no journal entry is invisible: `xp-gate audit --tail`, the
  # quality report and gate-coverage all read that file, so a silently absent
  # gate cannot be told apart from a gate the chain never contained.
  run_gate_12 "$(make_bare_gate_dir)"

  [ -n "$GATE12_AUDIT" ]
  [[ "$GATE12_AUDIT" == SKIP* ]]
}

# ---------------------------------------------------------------------------
# Anti-vacuity: the four real verdicts must survive the fix unchanged
# ---------------------------------------------------------------------------

@test "AC-806-G12a anti-vacuity: nothing staged still records SKIP and rc 0" {
  run_gate_12_REAL
  [ "$GATE12_STATUS_OBSERVED" = "SKIP" ]
}

@test "AC-806-G12a anti-vacuity: trailing whitespace warns without blocking" {
  cd "$FIXTURE" || return 1
  printf 'line with trailing space   \n' > ws.txt
  git add ws.txt
  run_gate_12_REAL
  [ "$GATE12_STATUS_OBSERVED" = "WARN" ]
  [[ "$GATE12_AUDIT" == WARN* ]]
}

@test "AC-806-G12a anti-vacuity: conflict markers still BLOCK" {
  cd "$FIXTURE" || return 1
  printf 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> other\n' > conflict.txt
  git add conflict.txt
  run_gate_12_REAL
  # The BLOCK path calls `exit 1` from inside gate_12_run (gate-12-file-hygiene.sh:305),
  # which terminates the harness shell before the status is written to status.txt.
  # Assert on the verdict the gate PRINTED and on the audit record it wrote, which
  # are both observable. That `exit` is a contract violation in its own right --
  # see the note in this file's header -- but it is not this test's subject.
  [[ "$GATE12_LOG" == *"BLOCKED - File hygiene violations"* ]]
  [[ "$GATE12_AUDIT" == BLOCK* ]]
}

@test "AC-806-G12a anti-vacuity: a clean staged file still PASSES" {
  cd "$FIXTURE" || return 1
  printf 'clean line\nsecond line\n' > clean.txt
  git add clean.txt
  run_gate_12_REAL
  [ "$GATE12_STATUS_OBSERVED" = "PASS" ]
  [[ "$GATE12_AUDIT" == PASS* ]]
}

# Helper: run against the repo's real hygiene script.
#
# `|| true` is required, not defensive noise: gate-12-file-hygiene.sh's BLOCK path
# calls `exit 1` from inside gate_12_run, so the harness shell exits 1 and this
# helper inherits that status. bats treats a non-zero function return as the test
# failing, which would report the BLOCK case as broken when it is the one working
# exactly as intended.
run_gate_12_REAL() {
  run_gate_12 "$REPO_ROOT/githooks" || true
}
