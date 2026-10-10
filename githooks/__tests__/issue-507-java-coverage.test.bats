#!/usr/bin/env bats
# @test REQ-507-04
# @intent G4 对 Java 提交输出实际执行的规则数（显式覆盖标注，12/15 + 3 条不适用规则）；
#         且 gate-4 的每条 SKIP 路径都必须打印原因（零覆盖才允许 SKIP，#507 S4）。
# @covers AC-507-04-02 AC-507-04-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  export TMPDIR=/tmp
  FIXTURE_REPO="$(mktemp -d)"
}

teardown() {
  rm -rf "$FIXTURE_REPO" 2>/dev/null || true
}

# The real coverage block (constants + function), extracted from the live
# gate at run time. An empty extraction fails loudly instead of testing
# nothing. The constants sit between the comment marker and the function's
# closing brace, so one range covers both.
note_block() {
  awk '/^# Java rule coverage annotation/,/^\}/ {print}' "$REPO_ROOT/githooks/gate-4.sh"
}

run_note() {
  (
    set -u
    cd "$FIXTURE_REPO" || exit 90
    block=$(note_block)
    [ -n "$block" ] || { echo "EXTRACTION-EMPTY" >&2; exit 91; }
    eval "$block"
    java_coverage_note "$@"
  )
}

# --- AC-507-04-02: explicit coverage annotation for Java commits ---

@test "AC-507-04-02: staged .java prints effective rule count and doc pointer" {
  run run_note src/A.java src/B.ts
  [ "$status" -eq 0 ]
  [[ "$output" == *"12/15"* ]]
  [[ "$output" == *"docs/java-principles-coverage.md"* ]]
}

@test "AC-507-04-02: annotation names all three inert rules" {
  run run_note src/A.java
  [ "$status" -eq 0 ]
  [[ "$output" == *"lsp"* ]]
  [[ "$output" == *"many-exports"* ]]
  [[ "$output" == *"code-duplication"* ]]
}

@test "AC-507-04-02: non-Java staged files print nothing" {
  run run_note src/A.ts src/B.py src/C.go
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "AC-507-04-02: empty file list prints nothing" {
  run run_note
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# Mutation guard: the counts are the normative claim of the coverage doc. If
# someone edits them (e.g. bumps effective to 15 to imply full coverage), the
# static assertion below must fail so the doc and the gate stay in lockstep.
@test "AC-507-04-02: gate constants match the audited 12/15 matrix" {
  block=$(note_block)
  [ -n "$block" ]
  [[ "$block" == *"JAVA_COVERAGE_EFFECTIVE=12"* ]]
  [[ "$block" == *"JAVA_COVERAGE_TOTAL=15"* ]]
  [[ "$block" == *"JAVA_COVERAGE_INERT="*"lsp"*"many-exports"*"code-duplication"* ]]
}

# --- AC-507-04-03: SKIP only with a printed reason (regression guard) ---

@test "AC-507-04-03: every SKIP assignment in gate-4 is preceded by a reason echo" {
  # Each `GATE_4_STATUS="SKIP"` must be directly preceded by an echo that says
  # why. A bare SKIP (silent downgrade) is exactly the #507 complaint.
  local violations
  violations=$(awk '
    /GATE_4_STATUS="SKIP"/ {
      if (prev !~ /echo/ && prev2 !~ /echo/) print NR": SKIP without reason echo"
    }
    { prev2 = prev; prev = $0 }
  ' "$REPO_ROOT/githooks/gate-4.sh")
  [ -z "$violations" ] || { echo "$violations"; false; }
}

@test "AC-507-04-03: no java-specific condition leads to SKIP" {
  # The gate must never downgrade because the commit contains Java. The file
  # filter regex and the coverage-note matcher legitimately mention .java;
  # nothing else may branch on it.
  local hits
  hits=$(grep -n '\.java' "$REPO_ROOT/githooks/gate-4.sh" \
    | grep -v 'ts|tsx|js|jsx|py|go|java' \
    | grep -v '\*\.java|\*\.Java|\*\.JAVA' \
    | grep -v 'inert on Java' || true)
  [ -z "$hits" ] || { echo "$hits"; false; }
}
