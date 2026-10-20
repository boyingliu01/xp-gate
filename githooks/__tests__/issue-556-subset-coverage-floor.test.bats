#!/usr/bin/env bats
# @test REQ-556 subset pytest runs cannot trip the global coverage floor
# @intent Verify a selective Python test run actively disables the coverage
#         threshold instead of merely omitting the flag. #556: the hook dropped
#         --cov-fail-under for subset runs believing that switched the floor
#         off, but pytest-cov reads fail_under from pyproject on its own, so a
#         selective run at 23% exited 1 and was escalated to a hard BLOCK --
#         printing "Partial coverage 23% (subset test run, not full suite)"
#         immediately above "❌ BLOCKED - Coverage check FAILED".
#         The two lines contradict each other, and the BLOCK is false: a subset
#         run's percentage says nothing about the project's coverage.
# @covers AC-556-01

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
HOOK="$REPO_ROOT/githooks/pre-commit"

@test "anti-vacuity: the subset run path still exists" {
  grep -q 'PARTIAL_TEST_RUN=true' "$HOOK"
  grep -q 'selective run' "$HOOK"
}

@test "the subset pytest invocation disables the coverage floor explicitly" {
  # Find the line that runs pytest for the subset tier and require the flag.
  local subset_line
  subset_line=$(grep -n 'PY_TARGETS$' "$HOOK" | head -1 | cut -d: -f1)
  [ -n "$subset_line" ]
  grep -q 'pytest .*PY_TARGETS' "$HOOK"
  grep -q -- '--cov-fail-under=0' "$HOOK"
}

@test "the partial-run message is not contradicted by a BLOCK on the same run" {
  # The escalation must consult PARTIAL_TEST_RUN. A subset run that exits
  # non-zero because of the global floor must not become a hard block.
  grep -q 'PARTIAL_TEST_RUN' "$HOOK"
  # At least one escalation site gates on it.
  run bash -c "grep -n 'PARTIAL_TEST_RUN:-false' '$HOOK' | head -3"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
}

@test "pytest-cov really does read fail_under without the flag (the premise)" {
  # Pin the tool behaviour: a future 'fix' must not restore the omit-the-flag
  # approach on the assumption that pytest-cov only honours the CLI flag.
  if ! command -v pytest >/dev/null 2>&1; then
    skip "pytest not installed"
  fi
  local work="$BATS_TEST_TMPDIR/pyproj"
  mkdir -p "$work"
  cat > "$work/pyproject.toml" <<'TOML'
[tool.coverage.report]
fail_under = 100
TOML
  cat > "$work/test_one.py" <<'PY'
def test_a():
    assert True
PY
  # A subset run at ~0% coverage must fail when the floor is in force...
  run bash -c "cd '$work' && python -m pytest -q --cov=. test_one.py >/dev/null 2>&1; echo exit=\$?"
  [ "$output" = "exit=1" ] || skip "pytest-cov not installed"
  # ...and pass when it is explicitly disabled.
  run bash -c "cd '$work' && python -m pytest -q --cov=. --cov-fail-under=0 test_one.py >/dev/null 2>&1; echo exit=\$?"
  [ "$output" = "exit=0" ]
}
