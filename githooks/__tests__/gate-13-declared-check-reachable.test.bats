#!/usr/bin/env bats
# @test REQ-G13-DECLARED-CHECK-REACHABLE
#
# @intent Gate 13 loads its implementation from a path resolved at run time:
#
#     _g13_script="$GATE_DIR/gate-13-compiler-strictness.sh"
#
# $GATE_DIR is the directory that holds adapter-common.sh -- `githooks/` for a
# project install, `~/.config/xp-gate/adapters` for a global one. The file exists in
# TWO places in this repository and they are different programs:
#
#     githooks/gate-13-compiler-strictness.sh          1458 lines  (older snapshot)
#     githooks/adapters/gate-13-compiler-strictness.sh 1770 lines  (maintained)
#
# Only the adapters/ copy defines gate13_run_declared_checks(), the arm that runs an
# adapter-declared compile-time check (go vet, cargo check, dart analyze, ...).
#
# MEASURED 2026-11-20 on this repository, committing a Go fixture:
#
#     gate-13-entry.sh: line 796: gate13_run_declared_checks: command not found
#     Gate 13 (PASS) completed in 0s
#
# Every adapter-declared compile-time check was silently absent, and the gate
# reported PASS. It was LOCAL ONLY: CI and global installs resolve the adapters/
# copy, so the run that validated the work was a different program from the one
# users get -- the worst possible split.
#
# After the fix the same commit prints:
#
#     -> declared compile-time checker: go vet ./...
#     OK Declared compile-time check passed (go vet ./...)

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ENTRY="$REPO_ROOT/githooks/gate-entries/gate-13-entry.sh"
  ADAPTERS_COPY="$REPO_ROOT/githooks/adapters/gate-13-compiler-strictness.sh"
  ROOT_COPY="$REPO_ROOT/githooks/gate-13-compiler-strictness.sh"
}

# @covers the arm is defined where the entry is told to look
@test "gate13_run_declared_checks is defined in the adapters copy" {
  [ -f "$ADAPTERS_COPY" ]
  run grep -c '^gate13_run_declared_checks()' "$ADAPTERS_COPY"
  [ "$output" = "1" ]
}

# @covers the entry prefers the maintained copy
@test "the entry resolves the adapters copy before the root copy" {
  # The first assignment must name adapters/; a root-first order is what shipped
  # the defect.
  local first_line
  first_line=$(grep -n '_g13_script=' "$ENTRY" | head -1)
  echo "$first_line" | grep -q 'adapters/gate-13-compiler-strictness.sh' || {
    echo "first resolution does not prefer adapters/: $first_line"
    return 1
  }
}

# @covers end to end: the function is callable through the real resolution order
@test "the resolved script defines gate13_run_declared_checks for a project install" {
  # Simulate a project install: GATE_DIR = the tracked githooks/ directory.
  run bash -c '
    GATE_DIR="'"$REPO_ROOT"'/githooks"
    _g13_script="$GATE_DIR/adapters/gate-13-compiler-strictness.sh"
    [ -f "$_g13_script" ] || _g13_script="$GATE_DIR/gate-13-compiler-strictness.sh"
    [ -f "$_g13_script" ] || _g13_script="'"$REPO_ROOT"'/githooks/adapters/gate-13-compiler-strictness.sh"
    [ -f "$_g13_script" ] || exit 1
    . "$_g13_script" >/dev/null 2>&1
    type gate13_run_declared_checks >/dev/null 2>&1 || {
      echo "resolved $_g13_script but it lacks the arm"; exit 1; }
    echo "ok: $_g13_script"
  '
  [ "$status" -eq 0 ]
  echo "$output" | grep -q 'adapters/gate-13-compiler-strictness.sh'
}

# @covers the shape that caused it: a stale duplicate is a superset-subset trap
@test "if the root copy still exists it is not missing functions the adapters copy has" {
  [ -f "$ROOT_COPY" ] || skip "root copy removed; the resolution-order test covers this"

  # The defect was a DUPLICATE that had fallen behind. While the duplicate exists,
  # it must not be a strict subset of the maintained one -- that is exactly the
  # condition that made the wrong file the reachable one.
  local missing
  missing=$(comm -13 \
    <(grep -oE '^[a-z_0-9]+\(\)' "$ROOT_COPY" | sort -u) \
    <(grep -oE '^[a-z_0-9]+\(\)' "$ADAPTERS_COPY" | sort -u))
  if [ -n "$missing" ]; then
    echo "root copy is missing functions present in adapters/:"
    echo "$missing"
    return 1
  fi
}
