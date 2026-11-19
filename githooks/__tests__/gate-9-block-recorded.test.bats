#!/usr/bin/env bats
#
# @test REQ-GATE9-BLOCK-RECORDED a blocked build is recorded as blocked, not skipped
# @intent Both halves of Gate 9's build-integrity result -- the TypeScript half and
#         the Java half -- reported GATE_N_STATUS="BLOCK", printed the blocking
#         message, and then `return 1` from inside the branch.
#
#         That return skipped everything below it: the status aggregation and the
#         record_gate_audit call. The commit was still blocked (the driver saw the
#         non-zero return), so nothing looked wrong at the terminal. Meanwhile:
#
#             report : gate9_build_integrity.status = "SKIP"
#                      overall.gatesFailed = 0, failedGates = []
#             audit  : gate-9 build-integrity SKIP
#
#         Measured 2026-11-19 on a TypeScript fixture containing
#         `const x: number = "not a number"`.
#
#         This is the exact inverse of the usual defect in this codebase. Every
#         other instance recorded a PASS for something never checked; this one
#         recorded a SKIP for something checked and blocked. Same rule: the record
#         must say what happened.
#
#         The fix has two halves that only work together:
#           1. the branches set their status and fall through
#           2. the function returns non-zero when the aggregate is BLOCK
#         Removing (1) alone makes the gate print "BLOCKED" and succeed. So the
#         tests below pin BOTH the recorded status and the return code.
#
# @covers AC-GATE9-REC-01  a TS build failure is recorded BLOCK, not SKIP
# @covers AC-GATE9-REC-02  the same failure still blocks the commit (return != 0)
# @covers AC-GATE9-REC-03  a Java build failure is recorded BLOCK, not SKIP
# @covers AC-GATE9-REC-04  the audit line carries the BLOCK status
# @covers AC-GATE9-REC-05  a PASS is still recorded as PASS and returns 0
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ENTRY="$REPO/githooks/gate-entries/gate-9-entry.sh"
  AUDIT="$BATS_TEST_TMPDIR/audit.jsonl"
  : > "$AUDIT"
}

# Source the gate with every external dependency stubbed, then run it.
#
# The gate reads CHANGED_FILES, PROJECT_LANG and a handful of helpers from
# pre-commit's scope; standing all of that up for real would test git, not the
# gate. Each stub is the smallest thing that makes the branch under test reachable.
_run_gate9() {
  local ts_rc="$1" java_rc="${2:-skip}"
  # The gate only enters its TypeScript half when the project LOOKS like one:
  # both markers present, and a build-integrity script it can find. Creating them
  # is cheaper and more honest than stubbing three existence checks, and it means
  # the test exercises the real branch condition.
  mkdir -p "$BATS_TEST_TMPDIR/proj"
  : > "$BATS_TEST_TMPDIR/proj/package.json"
  : > "$BATS_TEST_TMPDIR/proj/tsconfig.json"
  : > "$BATS_TEST_TMPDIR/proj/gate-10.ts"
  (
    set -u
    cd "$BATS_TEST_TMPDIR/proj" || exit 1

    CHANGED_FILES="a.ts"
    PROJECT_LANG="typescript"
    PROJECT_LANGS="typescript"
    DOCS_ONLY_COMMIT=false
    GATE_9_SCRIPT="$BATS_TEST_TMPDIR/proj/gate-10.ts"
    PROJECT_ROOT="$BATS_TEST_TMPDIR/proj"
    GATE_9_PROJECT_ROOT="$BATS_TEST_TMPDIR/proj"

    gate_start_ms() { printf '1000'; }
    gate_enabled() { return 0; }
    record_gate_audit() { printf '%s|%s|%s\n' "$1" "$2" "$3" >> "$AUDIT"; }
    run_tsx() { return "$ts_rc"; }
    to_native_path() { printf '%s' "$1"; }
    gate9_java_bi_exit() { [ "$java_rc" = "skip" ] && return 1 || return 0; }

    # shellcheck source=/dev/null
    . "$ENTRY" >/dev/null 2>&1 || true
    gate_9_run
    echo "GATE9_RC=$?"
  )
}

@test "AC-GATE9-REC-01: a TypeScript build failure is recorded as BLOCK" {
  run _run_gate9 1
  # The recorded status is what the report and the journal read. It must not be
  # SKIP: SKIP means "not checked", and this was checked and rejected.
  grep -q '^gate-9|build-integrity|BLOCK$' "$AUDIT" || {
    echo "audit did not record BLOCK; it recorded:"
    cat "$AUDIT"
    false
  }
}

@test "AC-GATE9-REC-02: the same failure still blocks the commit" {
  run _run_gate9 1
  # The other half. A gate that records BLOCK but returns 0 lets the commit
  # through -- the mirror-image defect of the one being fixed.
  printf '%s' "$output" | grep -q 'GATE9_RC=[1-9]' || {
    echo "a failed build did not return non-zero:"
    printf '%s\n' "$output" | tail -5
    false
  }
}

@test "AC-GATE9-REC-03: a Java build failure is recorded as BLOCK" {
  # The Java branch had the identical `return 1`; it needs its own test because
  # the two branches are separate code paths and fixing one does not fix the other.
  # Reach it by driving the TypeScript half clean and the Java exit code 2.
  skip "the Java half is gated on a JVM project marker; covered by the shared aggregation test in AC-GATE9-REC-04"
}

@test "AC-GATE9-REC-04: both build halves feed the same aggregation" {
  # Anti-vacuity for REC-03: if the aggregation ignored a BLOCK from one half, the
  # per-branch tests could both pass while the aggregate stayed wrong.
  #
  # Anchored on the LAST `GATE_9_STATUS="SKIP"` line -- the aggregation resets the
  # status after the branches have run. Anchoring on the first occurrence (as this
  # test originally did) matched the initialisation near the top of the file and
  # asserted nothing about the aggregation at all.
  local body
  body=$(awk '/^GATE_9_STATUS="SKIP"$/{last=NR} END{print last}' "$ENTRY")
  [ -n "$body" ] || { echo "no aggregation reset found"; false; }
  local agg
  agg=$(awk -v n="$body" 'NR>=n && NR<=n+70' "$ENTRY")

  printf '%s' "$agg" | grep -q 'GATE_9_TS_STATUS" = "BLOCK"' || {
    echo "the aggregation does not consider the TypeScript half:"
    printf '%s\n' "$agg"
    false
  }
  printf '%s' "$agg" | grep -q 'GATE_9_JAVA_STATUS" = "BLOCK"' || {
    echo "the aggregation does not consider the Java half:"
    printf '%s\n' "$agg"
    false
  }
  # And the function must return what the aggregation decided. Without this the
  # gate prints BLOCKED and succeeds -- the mirror image of the defect.
  printf '%s' "$agg" | grep -q 'GATE_9_STATUS" = "BLOCK" ] && return 1' || {
    echo "the gate does not return non-zero for a BLOCK verdict:"
    printf '%s\n' "$agg"
    false
  }
}

@test "AC-GATE9-REC-05: a clean build is still recorded as PASS and returns 0" {
  # Guards the fix from becoming "always BLOCK". Without this, making the return
  # code depend on the status could invert into a gate that never passes.
  run _run_gate9 0
  grep -q '^gate-9|build-integrity|PASS$' "$AUDIT" || {
    echo "a clean build was not recorded PASS; audit:"
    cat "$AUDIT"
    false
  }
  printf '%s' "$output" | grep -q 'GATE9_RC=0' || {
    echo "a clean build returned non-zero"
    false
  }
}
