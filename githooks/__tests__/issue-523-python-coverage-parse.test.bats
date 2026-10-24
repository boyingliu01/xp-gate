#!/usr/bin/env bats
# @test REQ-A-03
# @intent #523: Gate 5's Python coverage parsing never matched, so the 80%
#         threshold branch never executed — the gate answered "Could not
#         determine" forever: a silent no-op, not a verdict. `coverage report
#         --format=total` prints a BARE number ("97"), but the hook piped it
#         through `grep -o '[0-9]*%'`, a pattern that requires a literal percent
#         sign. The parse logic now lives in githooks/lib/coverage-total.sh
#         (unit-testable without executing the hook), and the whole python
#         Stage-2 branch moved into enforce_python_coverage() there so the
#         threshold verdict is exercised end-to-end with a mock `coverage` on
#         PATH — real control flow, no expression copying (MC-02).
# @covers AC-A-03-01, AC-A-03-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/coverage-total.sh"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR" || return 1
}

teardown() {
  # Leave the temp dir before deleting it: Windows cannot remove a cwd.
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# ── (a) parse_coverage_total unit tests (table-driven, AC-A-03-02) ───────────

# parse_case <input> <expected-stdout> — one row of the table.
parse_case() {
  local input="$1" expected="$2" actual
  actual=$(printf '%s' "$input" | parse_coverage_total)
  if [ "$actual" != "$expected" ]; then
    echo "input=$(printf '%q' "$input") expected=[$expected] got=[$actual]" >&2
    return 1
  fi
}

@test "AC-A-03-02: parse_coverage_total table - bare number, percent, decimal, empty, garbage" {
  [ -f "$LIB" ] || { echo "lib missing: $LIB"; return 1; }
  # shellcheck disable=SC1091
  source "$LIB"

  # coverage.py 7.x --format=total: a BARE number — the shape the old
  # percent-only grep could never match (#523).
  parse_case "97" "97"
  # Percent form (older/other tools): accepted, sign stripped.
  parse_case "97%" "97"
  # Decimals truncate (floor) — the conservative direction for a threshold
  # gate, same convention as the Java path's ${VAR%.*}.
  parse_case "79.9" "79"
  parse_case "97.5%" "97"
  # Zero is a real verdict (0% coverage blocks), not "no data".
  parse_case "0" "0"
  # Empty / tool noise / garbage → no output (caller takes its
  # cannot-determine path; a wrong number is worse than none).
  parse_case "" ""
  parse_case "No data to report." ""
  parse_case "garbage" ""
  parse_case "12abc" ""
  # Decoration is NOT tolerated: the whole line must BE the number. A line
  # that merely contains one ("total: 87.3%") is refused so a numbered
  # warning line can never be mistaken for the total (#532 walkthrough FC-03);
  # the caller's cannot-determine path is the safe outcome.
  parse_case "total: 87.3%" ""
  # A numbered warning line BEFORE the real total must not win (FC-03).
  parse_case "$(printf 'WARNING: 2 files skipped\n97')" "97"
  # Multi-line: progress noise before the number does not hide it.
  parse_case "$(printf 'warning: something\n42')" "42"
}

# ── (b) enforce_python_coverage end-to-end, mock PATH (AC-A-03-01) ───────────

write_coverage_stub() {
  local stdout_text="$1"
  mkdir -p "$TEST_DIR/bin"
  {
    printf '#!/bin/sh\n'
    printf 'printf "%%s\\n" "%s"\n' "$stdout_text"
    printf 'exit 0\n'
  } > "$TEST_DIR/bin/coverage"
  chmod +x "$TEST_DIR/bin/coverage"
}

# Runs the REAL Stage-2 python branch function in a subshell with the stub
# coverage on PATH. No extraction from the hook: the function IS the hook's
# control flow.
run_enforce() {
  (
    set -u
    cd "$TEST_DIR" || exit 1
    PATH="$TEST_DIR/bin:$PATH"
    # shellcheck disable=SC1091
    source "$LIB"
    enforce_python_coverage
  )
}

@test "AC-A-03-01: bare number 97 with .coverage data PASSes (the #523 regression, now parsed)" {
  [ -f "$LIB" ] || { echo "lib missing"; return 1; }
  touch "$TEST_DIR/.coverage"
  write_coverage_stub "97"
  run run_enforce
  [ "$status" -eq 0 ]
  [[ "$output" == *"Python coverage: 97% ✅ (≥ 80%)"* ]]
}

@test "AC-A-03-01: bare number 12 with .coverage data BLOCKs (threshold branch really runs)" {
  [ -f "$LIB" ] || { echo "lib missing"; return 1; }
  touch "$TEST_DIR/.coverage"
  write_coverage_stub "12"
  run run_enforce
  [ "$status" -eq 1 ]
  [[ "$output" == *"❌ BLOCKED - Python coverage 12% below 80% threshold"* ]]
}

@test "AC-A-03-01: decimal 79.9 truncates to 79 and BLOCKs (fail-closed rounding)" {
  [ -f "$LIB" ] || { echo "lib missing"; return 1; }
  touch "$TEST_DIR/.coverage"
  write_coverage_stub "79.9"
  run run_enforce
  [ "$status" -eq 1 ]
  [[ "$output" == *"❌ BLOCKED - Python coverage 79% below 80% threshold"* ]]
}

@test "AC-A-03-01: percent form 85% PASSes (both report shapes accepted)" {
  [ -f "$LIB" ] || { echo "lib missing"; return 1; }
  touch "$TEST_DIR/.coverage"
  write_coverage_stub "85%"
  run run_enforce
  [ "$status" -eq 0 ]
  [[ "$output" == *"Python coverage: 85% ✅ (≥ 80%)"* ]]
}

@test "AC-A-03-01: coverage/ data-directory variant is probed when ./.coverage is absent" {
  [ -f "$LIB" ] || { echo "lib missing"; return 1; }
  mkdir -p "$TEST_DIR/coverage"
  touch "$TEST_DIR/coverage/.coverage"
  write_coverage_stub "91"
  run run_enforce
  [ "$status" -eq 0 ]
  [[ "$output" == *"Python coverage: 91% ✅ (≥ 80%)"* ]]
}

@test "no coverage data anywhere: cannot-determine BLOCKS, neither pass nor silent" {
  [ -f "$LIB" ] || { echo "lib missing"; return 1; }
  write_coverage_stub "97"
  run run_enforce
  # #570: "could not measure" is a FAILED answer to the gate's only question.
  # Warning and returning 0 made the gate fail-open — deleting .coverage turned
  # the coverage check off while the summary still looked clean.
  [ "$status" -eq 1 ]
  [[ "$output" == *"Could not determine Python coverage percentage"* ]]
  [[ "$output" == *"BLOCKED"* ]]
  [[ "$output" != *"✅ (≥ 80%)"* ]]
}

@test "unparseable stub output: cannot-determine BLOCKS, never a silent PASS" {
  [ -f "$LIB" ] || { echo "lib missing"; return 1; }
  touch "$TEST_DIR/.coverage"
  write_coverage_stub "No data to report."
  run run_enforce
  [ "$status" -eq 1 ]
  [[ "$output" == *"Could not determine"* ]]
  [[ "$output" == *"BLOCKED"* ]]
  [[ "$output" != *"✅"* ]]
}

@test "a subset run that measured nothing warns instead of blocking (the one exception)" {
  [ -f "$LIB" ] || { echo "lib missing"; return 1; }
  write_coverage_stub "97"
  # PARTIAL_TEST_RUN means Stage 1 deliberately ran a subset, so there is no
  # global total to compare against — blocking would punish the optimisation the
  # hook itself made.
  run env PARTIAL_TEST_RUN=true bash -c '
    cd "$1" || exit 1
    PARTIAL_TEST_RUN=true
    export PARTIAL_TEST_RUN
    # shellcheck disable=SC1091
    source "$2"
    enforce_python_coverage
  ' _ "$TEST_DIR" "$LIB"
  [ "$status" -eq 0 ]
  [[ "$output" == *"subset test run"* ]]
  [[ "$output" != *"BLOCKED"* ]]
}

@test "coverage tool absent from PATH: actionable WARN, exit 0" {
  [ -f "$LIB" ] || { echo "lib missing"; return 1; }
  touch "$TEST_DIR/.coverage"
  # Dir-split PATH: drop every directory that could carry coverage.py (this
  # machine has one under Python312/Scripts; CI images may too). The gate must
  # behave identically on a machine without coverage.py at all. Only shell
  # builtins are needed before the early return, so /usr/bin:/bin suffices.
  run bash -c '
    cd "$1" || exit 1
    PATH="/usr/bin:/bin"
    export PATH
    if command -v coverage >/dev/null 2>&1; then
      echo "fixture broken: coverage still resolvable" >&2
      exit 99
    fi
    # shellcheck disable=SC1091
    source "$2"
    enforce_python_coverage
  ' _ "$TEST_DIR" "$LIB"
  [ "$status" -eq 0 ]
  [[ "$output" == *"coverage.py not available"* ]]
}

# Critical-1 (#399): a skipped Python test run must NOT consume a stale
# .coverage left by an earlier subset run. Without PY_TEST_SKIPPED the gate
# read the leftover low-% file and BLOCKED a docs-only commit that changed no
# Python. The flag short-circuits before coverage.py is ever invoked.
@test "Critical-1: PY_TEST_SKIPPED skips the check even when a stale low .coverage exists" {
  [ -f "$LIB" ] || { echo "lib missing"; return 1; }
  touch "$TEST_DIR/.coverage"
  write_coverage_stub "12"  # a stale low-% subset file that MUST be ignored
  run bash -c '
    cd "$1" || exit 1
    PATH="$2:$PATH"
    export PATH
    # shellcheck disable=SC1091
    source "$3"
    PY_TEST_SKIPPED=true
    enforce_python_coverage
  ' _ "$TEST_DIR" "$TEST_DIR/bin" "$LIB"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Test run was skipped — skipping Python coverage check."* ]]
  [[ "$output" != *"BLOCKED"* ]]
  [[ "$output" != *"Python coverage:"* ]]
}

@test "Critical-1: PY_TEST_SKIPPED does not mask a real failure when coverage was enforced" {
  [ -f "$LIB" ] || { echo "lib missing"; return 1; }
  touch "$TEST_DIR/.coverage"
  write_coverage_stub "12"
  run run_enforce
  [ "$status" -eq 1 ]
  [[ "$output" == *"❌ BLOCKED - Python coverage 12% below 80% threshold"* ]]
}

# ── (c) wiring + anti-vacuity regression guards ──────────────────────────────

@test "anti-vacuity: the old percent-only grep cannot parse a bare number (the #523 defect, pinned)" {
  # The exact production pipeline from before the fix. A bare number — what
  # coverage.py 7.x --format=total actually prints — yields NO output (the
  # pipeline's last stage, tr, exits 0 on empty input, so the old code's `||
  # true` never even saw a failure: the gate just got an empty string). If this
  # ever starts producing "97", the defect was reintroduced somewhere.
  run bash -c "printf '97\n' | grep -o '[0-9]*%' | head -1 | tr -d '%'"
  [ -z "$output" ]
}

@test "pre-commit sources the library and the python branch calls the extracted function" {
  [ -f "$HOOK" ] || { echo "hook missing"; return 1; }
  run grep -n 'lib/coverage-total.sh' "$HOOK"
  [ "$status" -eq 0 ]
  run grep -n 'enforce_python_coverage' "$HOOK"
  [ "$status" -eq 0 ]
  # The never-matching percent-only pipeline must be gone from the hook's
  # python branch (the parse now lives in the library).
  if grep 'coverage report --format=total' "$HOOK" | grep -q "grep -o '\[0-9\]\*%'"; then
    echo "old percent-only parse pipeline still present in pre-commit" >&2
    return 1
  fi
}

@test "npm mirror of pre-commit stays byte-identical (Stage 2 polyglot contract)" {
  run cmp "$HOOK" "$REPO_ROOT/src/npm-package/hooks/pre-commit"
  [ "$status" -eq 0 ]
}
