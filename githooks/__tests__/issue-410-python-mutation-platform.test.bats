#!/usr/bin/env bats
# @intent #410: Gate M (Python) had a structural deadlock on native Windows —
#         mutmut 3.x is fork()-based, so `mutmut run` always exits 1, meaning
#         an installed mutmut always BLOCKED the push while uninstalling it
#         flipped the gate to SKIP. The detector now decides whether an engine
#         can actually RUN, not merely whether it is installed: pytest-gremlins
#         (cross-platform, mutation switching) is preferred; mutmut is only
#         accepted on Unix or through WSL. Every path here is SKIP-not-BLOCK.
# @covers detect_python_mutation_testable() in adapter-common.sh

setup() {
  bats_require_minimum_version 1.5.0
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  COMMON="$REPO_ROOT/githooks/adapter-common.sh"
  TEST_DIR="$(mktemp -d)"
  FAKE_BIN="$TEST_DIR/bin"
  mkdir -p "$FAKE_BIN"
  cd "$TEST_DIR" || return 1
  # Stub dir FIRST so our fakes shadow any real tool; the real PATH is kept
  # because the harness itself needs cat/rm/chmod. Each test stubs every tool
  # the detector probes (python/mutmut/wsl/uname/pip/pip3), so a host-installed
  # mutmut or pytest-gremlins cannot leak into the verdict.
  export REAL_PATH="$PATH"
  export PATH="$FAKE_BIN:$REAL_PATH"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Disable any engine the detector might find via the real PATH: shadow
# `pip`/`pip3` with failing stubs so `pip show mutmut` never succeeds.
neutralize_engines() {
  stub pip 1
  stub pip3 1
}

# stub <name> <exit-code> — a fake command on PATH with a fixed exit code.
stub() {
  local name="$1" rc="$2"
  cat > "$FAKE_BIN/$name" <<EOF
#!/usr/bin/env bash
exit $rc
EOF
  chmod +x "$FAKE_BIN/$name"
}

# stub_output <name> <text> — a fake command that prints <text> and exits 0
# (used for `uname -s`, where the detector reads stdout, not the exit code).
stub_output() {
  local name="$1" text="$2"
  cat > "$FAKE_BIN/$name" <<EOF
#!/usr/bin/env bash
echo "$text"
EOF
  chmod +x "$FAKE_BIN/$name"
}

# stub_uname <os-string> — force `uname -s` output so the platform branch is
# exercised deterministically regardless of the host running the suite.
stub_uname() {
  stub_output uname "$1"
}

@test "#410: pytest-gremlins importable -> testable (preferred engine)" {
  # shellcheck disable=SC1091
  source "$COMMON"
  neutralize_engines
  stub python 0   # `python -c "import pytest_gremlins"` succeeds
  run detect_python_mutation_testable
  [ "$status" -eq 0 ]
}

@test "#410: native Windows + mutmut installed but no WSL -> NOT testable, warns and suggests gremlins" {
  # This is the deadlock case: mutmut IS installed (old code returned 0 here),
  # but it can never run natively. The detector must refuse so Gate M SKIPs.
  # shellcheck disable=SC1091
  source "$COMMON"
  neutralize_engines
  stub python 1      # no gremlins
  stub mutmut 0      # mutmut IS present
  stub wsl 1         # but no working WSL mutmut
  stub_uname MINGW64_NT-10.0
  run --separate-stderr detect_python_mutation_testable
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"pytest-gremlins"* ]]
  [[ "$stderr" == *"WSL"* ]]
}

@test "#410: native Windows + WSL mutmut available -> testable (WSL route)" {
  # shellcheck disable=SC1091
  source "$COMMON"
  neutralize_engines
  stub python 1
  stub mutmut 0
  stub wsl 0         # WSL mutmut works
  stub_uname MSYS_NT-10.0
  run detect_python_mutation_testable
  [ "$status" -eq 0 ]
}

@test "#410: Unix + mutmut installed -> testable (no regression)" {
  # shellcheck disable=SC1091
  source "$COMMON"
  neutralize_engines
  stub python 1      # no gremlins
  stub mutmut 0
  stub_uname Linux
  run detect_python_mutation_testable
  [ "$status" -eq 0 ]
}

@test "#410: native Windows + no WSL at all -> not testable (SKIP, no mutmut probe)" {
  # The genuinely-should-skip Windows case: nothing viable exists, and the
  # detector must not fall through to the Unix branch (which would accept an
  # installed-but-unrunnable mutmut and recreate the #410 deadlock).
  # shellcheck disable=SC1091
  source "$COMMON"
  neutralize_engines
  stub python 1
  stub_uname MINGW64_NT-10.0
  # wsl is absent from PATH entirely: on Windows the branch must decide on the
  # WSL probe, never on `command -v mutmut`.
  run detect_python_mutation_testable
  [ "$status" -eq 1 ]
}

@test "#410: native Windows + gremlins + mutmut both present -> gremlins wins (testable)" {
  # shellcheck disable=SC1091
  source "$COMMON"
  neutralize_engines
  stub python 0      # gremlins importable
  stub mutmut 0
  stub_uname MINGW64_NT-10.0
  run detect_python_mutation_testable
  [ "$status" -eq 0 ]
}
