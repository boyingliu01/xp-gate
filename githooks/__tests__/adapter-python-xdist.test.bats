#!/usr/bin/env bats
# @intent #516: Gate 5 (Python) runs the full pytest suite serially — measured
#         30-45min on a 2555-test project vs 2m23s with `-n auto --dist
#         loadfile`. The gate now probes pytest-xdist and adds parallel args
#         when available; when it is NOT available the gate degrades to serial
#         with a warning — never a BLOCK (SKIP-not-BLOCK convention, serial
#         semantics fully preserved).
# @covers python_xdist_args() in adapter-common.sh, python.sh run_tests/run_coverage

setup() {
  bats_require_minimum_version 1.5.0
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  COMMON="$REPO_ROOT/githooks/adapter-common.sh"
  PYTHON_ADAPTER="$REPO_ROOT/githooks/adapters/python.sh"
  TEST_DIR="$(mktemp -d)"
  FAKE_BIN="$TEST_DIR/bin"
  mkdir -p "$FAKE_BIN"
  cd "$TEST_DIR" || return 1
}

teardown() {
  # Leave the temp dir before deleting it: Windows cannot remove a cwd.
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# install_python_stub <exit-code> — a fake `python` whose `import xdist` probe
# result is controlled by the exit code. Real Gate 5 probes via
# `python -c "import xdist"`; the stub mimics both outcomes.
install_python_stub() {
  local rc="$1"
  cat > "$FAKE_BIN/python" <<EOF
#!/usr/bin/env bash
exit $rc
EOF
  chmod +x "$FAKE_BIN/python"
  export PATH="$FAKE_BIN:$PATH"
}

# ── python_xdist_args helper ─────────────────────────────────────────────────

@test "python_xdist_args: xdist importable -> parallel args (-n auto --dist loadfile)" {
  # shellcheck disable=SC1091
  source "$COMMON"
  install_python_stub 0
  run python_xdist_args
  [ "$status" -eq 0 ]
  [ "$output" = "-n auto --dist loadfile" ]
}

@test "python_xdist_args: xdist missing -> empty output (serial), warning on stderr mentions pytest-xdist" {
  # shellcheck disable=SC1091
  source "$COMMON"
  install_python_stub 1
  run --separate-stderr python_xdist_args
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [[ "$stderr" == *"pytest-xdist"* ]]
  [[ "$stderr" == *"pip install pytest-xdist"* ]]
}

@test "python_xdist_args: python missing entirely -> empty output, no crash (serial fallback)" {
  # shellcheck disable=SC1091
  source "$COMMON"
  # No python anywhere on PATH: strip the stub dir and hope the sandbox has
  # none — if it does, the real python without xdist behaves the same way.
  run python_xdist_args
  [ "$status" -eq 0 ]
}

# ── adapter integration: run_coverage / run_tests pick up xdist args ─────────

# install_pytest_stub <mode> — fake `pytest` that records its argv, plus a
# require_tool-compatible presence. mode=xdist|serial controls the probe.
install_pytest_stub() {
  local mode="$1"
  cat > "$FAKE_BIN/pytest" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$PYTEST_ARGS_FILE"
exit 0
EOF
  chmod +x "$FAKE_BIN/pytest"
  export PYTEST_ARGS_FILE="$TEST_DIR/pytest-args.txt"
  if [ "$mode" = "xdist" ]; then
    install_python_stub 0
  else
    install_python_stub 1
  fi
  export PATH="$FAKE_BIN:$PATH"
}

@test "#516: run_coverage adds -n auto --dist loadfile when xdist is available" {
  # shellcheck disable=SC1091
  source "$COMMON"
  # shellcheck disable=SC1091
  source "$PYTHON_ADAPTER"
  install_pytest_stub xdist
  run_coverage
  grep -q -- "-n" "$PYTEST_ARGS_FILE"
  grep -q -- "--dist" "$PYTEST_ARGS_FILE"
  grep -q "loadfile" "$PYTEST_ARGS_FILE"
  grep -q -- "--cov=src" "$PYTEST_ARGS_FILE"
}

@test "#516: run_coverage degrades to serial (no parallel args) when xdist is missing — never blocks" {
  # shellcheck disable=SC1091
  source "$COMMON"
  # shellcheck disable=SC1091
  source "$PYTHON_ADAPTER"
  install_pytest_stub serial
  run run_coverage
  [ "$status" -eq 0 ]
  if grep -q -- "-n" "$PYTEST_ARGS_FILE"; then
    echo "parallel args leaked into serial run: $(cat "$PYTEST_ARGS_FILE")" >&2
    return 1
  fi
  grep -q -- "--cov=src" "$PYTEST_ARGS_FILE"
}

@test "#516: run_tests also picks up xdist args when available" {
  # shellcheck disable=SC1091
  source "$COMMON"
  # shellcheck disable=SC1091
  source "$PYTHON_ADAPTER"
  install_pytest_stub xdist
  run_tests
  grep -q "loadfile" "$PYTEST_ARGS_FILE"
}
