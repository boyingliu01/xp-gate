#!/usr/bin/env bats
# @intent #399: Python pre-commit always runs the FULL pytest suite on every
#         commit. TypeScript has had smart test selection since #286; Python
#         gets the same three-tier strategy: changed test files only ->
#         related tests from changed sources -> full suite fallback (large
#         batch / dependency changes / no related tests). Tier 1/2 run WITHOUT
#         the global coverage threshold — subset coverage is meaningless
#         globally — and Stage 2 must WARN (not BLOCK) on partial runs.
# @covers lib/python-test-selection.sh: select_python_test_strategy, python_related_tests
# @covers lib/coverage-total.sh: enforce_python_coverage PARTIAL_TEST_RUN semantics

setup() {
  bats_require_minimum_version 1.5.0
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SEL="$REPO_ROOT/githooks/lib/python-test-selection.sh"
  COV_LIB="$REPO_ROOT/githooks/lib/coverage-total.sh"
  TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR" || return 1
}

teardown() {
  # Leave the temp dir before deleting it: Windows cannot remove a cwd.
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# ── select_python_test_strategy truth table ──────────────────────────────────

# strategy_case <tests> <src> <deps> <expected>
strategy_case() {
  local tests="$1" src="$2" deps="$3" expected="$4" actual
  actual=$(select_python_test_strategy "$tests" "$src" "$deps")
  if [ "$actual" != "$expected" ]; then
    echo "strategy(tests=$tests src=$src deps=$deps): expected=[$expected] got=[$actual]" >&2
    return 1
  fi
}

@test "strategy: >20 changed test files -> full" {
  # shellcheck disable=SC1091
  source "$SEL"
  strategy_case 21 0 0 full
  strategy_case 100 3 0 full
}

@test "strategy: only test files changed (<=20) -> changed-tests" {
  # shellcheck disable=SC1091
  source "$SEL"
  strategy_case 1 0 0 changed-tests
  strategy_case 20 0 0 changed-tests
}

@test "strategy: source files changed, no test files -> related" {
  # shellcheck disable=SC1091
  source "$SEL"
  strategy_case 0 3 0 related
  strategy_case 0 1 0 related
}

@test "strategy: dependency files changed forces full even with few test changes" {
  # shellcheck disable=SC1091
  source "$SEL"
  strategy_case 1 0 1 full
  strategy_case 0 5 1 full
}

@test "strategy: nothing relevant changed -> skip" {
  # shellcheck disable=SC1091
  source "$SEL"
  strategy_case 0 0 0 skip
}

# ── python_related_tests lookup on a fixture tree ────────────────────────────

@test "related: finds tests/foo/test_bar.py for src/foo/bar.py" {
  mkdir -p tests/foo src/foo
  : > src/foo/bar.py
  : > tests/foo/test_bar.py
  # shellcheck disable=SC1091
  source "$SEL"
  run python_related_tests "src/foo/bar.py"
  [ "$status" -eq 0 ]
  [[ "$output" == *"tests/foo/test_bar.py"* ]]
}

@test "related: finds tests/test_bar.py (flat tests dir)" {
  mkdir -p tests src/foo
  : > src/foo/bar.py
  : > tests/test_bar.py
  # shellcheck disable=SC1091
  source "$SEL"
  run python_related_tests "src/foo/bar.py"
  [[ "$output" == *"tests/test_bar.py"* ]]
}

@test "related: finds collocated src/foo/test_bar.py" {
  mkdir -p src/foo
  : > src/foo/bar.py
  : > src/foo/test_bar.py
  # shellcheck disable=SC1091
  source "$SEL"
  run python_related_tests "src/foo/bar.py"
  [[ "$output" == *"src/foo/test_bar.py"* ]]
}

@test "related: finds suffix-style tests/foo/bar_test.py" {
  mkdir -p tests/foo src/foo
  : > src/foo/bar.py
  : > tests/foo/bar_test.py
  # shellcheck disable=SC1091
  source "$SEL"
  run python_related_tests "src/foo/bar.py"
  [[ "$output" == *"tests/foo/bar_test.py"* ]]
}

@test "related: no matching tests -> empty output" {
  mkdir -p src/foo
  : > src/foo/bar.py
  # shellcheck disable=SC1091
  source "$SEL"
  run python_related_tests "src/foo/bar.py"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "related: dedupes when several patterns resolve to the same file" {
  mkdir -p src/foo
  : > src/foo/bar.py
  : > src/foo/test_bar.py
  # shellcheck disable=SC1091
  source "$SEL"
  run python_related_tests "src/foo/bar.py"
  [ "$(printf '%s\n' "$output" | sort -u | wc -l)" -eq "$(printf '%s\n' "$output" | wc -l)" ]
}

# ── enforce_python_coverage: PARTIAL_TEST_RUN downgrades BLOCK to WARNING ────

# install_coverage_stub <total-pct> — fake coverage.py answering
# `coverage report --format=total` with a fixed number.
install_coverage_stub() {
  local pct="$1"
  cat > "$TEST_DIR/coverage" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "report" ]; then
  echo "$pct"
  exit 0
fi
exit 0
EOF
  chmod +x "$TEST_DIR/coverage"
  export PATH="$TEST_DIR:$PATH"
}

@test "coverage: partial run with 50% total -> WARN not BLOCK (exit 0)" {
  # shellcheck disable=SC1091
  source "$COV_LIB"
  install_coverage_stub 50
  : > .coverage
  PARTIAL_TEST_RUN=true
  run enforce_python_coverage
  [ "$status" -eq 0 ]
  [[ "$output" == *"Partial"*"50%"* ]]
  [[ "$output" != *"BLOCKED"* ]]
}

@test "coverage: full run with 50% total -> still BLOCKS (exit 1)" {
  # shellcheck disable=SC1091
  source "$COV_LIB"
  install_coverage_stub 50
  : > .coverage
  PARTIAL_TEST_RUN=false
  run enforce_python_coverage
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED"* ]]
}

@test "coverage: partial run at/above threshold reports success" {
  # shellcheck disable=SC1091
  source "$COV_LIB"
  install_coverage_stub 85
  : > .coverage
  PARTIAL_TEST_RUN=true
  run enforce_python_coverage
  [ "$status" -eq 0 ]
  [[ "$output" == *"85%"* ]]
}
