#!/usr/bin/env bats
#
# @test REQ-GATE-SHELL-TESTS The Shell adapter must run the shell test suite that exists
# @intent `run_tests()` looked for `tests/*.sh` and, failing that, probed for a
#         `shunit2` binary. In this repo neither exists: `tests/` holds seven
#         Python files and `tests/*.sh` matches nothing, while the project's
#         actual shell suite is 239 .bats files under githooks/__tests__/.
#
#         So Gate 5's test arm for shell projects returned
#         "No shell tests detected or shunit2 available" and exit 0 while 239
#         test files sat unread one directory over. That is the same defect as
#         the lint arm: the gate is green because it looked somewhere empty.
#
#         The shunit2 branch made the miss worse by being an explicit no-op —
#         it detected the tool and returned 0 without running anything.
#
# @covers AC-GATE-SHELL-TESTS-01
# @covers AC-GATE-SHELL-TESTS-02
# @covers AC-GATE-SHELL-TESTS-03
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/shell.sh"
  # The adapter now isolates each suite via run_without_git_context, which
  # lives in adapter-common.sh (loaded by pre-commit before any adapter). A
  # suite that sources shell.sh alone therefore fails for the wrong reason.
  ADAPTER_COMMON="$REPO_ROOT/githooks/adapter-common.sh"
}

@test "AC-GATE-SHELL-TESTS-01: run_tests discovers .bats suites" {
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__"

  cat > "$work/githooks/__tests__/sample.test.bats" <<'SUITE'
#!/usr/bin/env bats
@test "trivially passing" {
  [ 1 -eq 1 ]
}
SUITE

  # Fake bats that reports which suite it was handed.
  cat > "$work/bin/bats" <<'STUB'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do
  case "$1" in
    --version) echo "Bats 0.0.0"; exit 0 ;;
    -*) shift ;;
    *) echo "BATS_SAW:$1"; shift ;;
  esac
done
exit 0
STUB
  chmod +x "$work/bin/bats"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER_COMMON'
    . '$ADAPTER'
    run_tests 2>&1
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"sample.test.bats"* ]]
}

@test "AC-GATE-SHELL-TESTS-01: a failing .bats suite makes run_tests fail" {
  # The verdict must come from the suite. A green result here would mean the
  # adapter ran something and discarded its status.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__"

  cat > "$work/githooks/__tests__/failing.test.bats" <<'SUITE'
#!/usr/bin/env bats
@test "trivially failing" {
  [ 1 -eq 2 ]
}
SUITE

  cat > "$work/bin/bats" <<'STUB'
#!/usr/bin/env bash
echo "not ok 1 trivially failing"
exit 1
STUB
  chmod +x "$work/bin/bats"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER_COMMON'
    . '$ADAPTER'
    run_tests 2>&1
  "
  [ "$status" -ne 0 ]
}

@test "AC-GATE-SHELL-TESTS-03: run_tests tells bats to abort at the first failing suite" {
  # A serial run over every suite is the pre-commit's only option on Windows
  # (no GNU parallel), and measured there it costs about a second per suite.
  # Without --abort a red run still pays for every suite after the first
  # failure; with it the gate stops at the defect it is about to report.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__"

  cat > "$work/githooks/__tests__/sample.test.bats" <<'SUITE'
#!/usr/bin/env bats
@test "trivially passing" {
  [ 1 -eq 1 ]
}
SUITE

  cat > "$work/bin/bats" <<'STUB'
#!/usr/bin/env bash
for arg in "$@"; do
  [ "$arg" = "--abort" ] && { echo "BATS_SAW_ABORT"; exit 0; }
done
echo "BATS_SAW_NO_ABORT"
exit 0
STUB
  chmod +x "$work/bin/bats"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER_COMMON'
    . '$ADAPTER'
    run_tests 2>&1
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"BATS_SAW_ABORT"* ]]
}

@test "AC-GATE-SHELL-TESTS-03: every discovered suite is executed, not just the first" {
  # Per-suite invocation must not turn into "run one suite and report green".
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__"

  for name in first second third; do
    cat > "$work/githooks/__tests__/${name}.test.bats" <<'SUITE'
#!/usr/bin/env bats
@test "trivially passing" {
  [ 1 -eq 1 ]
}
SUITE
  done

  cat > "$work/bin/bats" <<'STUB'
#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    *.bats) echo "BATS_RAN:$(basename "$arg")" ;;
  esac
done
exit 0
STUB
  chmod +x "$work/bin/bats"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER_COMMON'
    . '$ADAPTER'
    run_tests 2>&1
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"BATS_RAN:first.test.bats"* ]]
  [[ "$output" == *"BATS_RAN:second.test.bats"* ]]
  [[ "$output" == *"BATS_RAN:third.test.bats"* ]]
}

@test "AC-GATE-SHELL-TESTS-04: a runner left wedged is killed at the wall-clock limit and reported" {
  # The cap above is forwarded to bats, which on this repo's bats stops the
  # TEST. On a bats that cannot (or a runner wedged outside a test body: git
  # prompt, inherited fd) the only bound is the runner's own clock. Observed on
  # this repo: a commit held open with no output to explain it. The stub sleeps
  # instead of printing, so this case measures the kill, not the hand-off.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__"
  printf '#!/usr/bin/env bats
@test "t" { true; }
' > "$work/githooks/__tests__/a.test.bats"
  cat > "$work/bin/bats" <<'STUB'
#!/usr/bin/env bash
echo "1..1"
sleep 120
STUB
  chmod +x "$work/bin/bats"
  printf 'node_modules/
' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  local started=$SECONDS
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    XP_GATE_BATS_SUITE_WALL_LIMIT_S=2
    export XP_GATE_BATS_SUITE_WALL_LIMIT_S
    export XP_GATE_BATS_LOG_DIR='$work/logs'
    mkdir -p \"\$XP_GATE_BATS_LOG_DIR\"
    # shellcheck source=/dev/null
    . '$ADAPTER_COMMON'
    . '$ADAPTER'
    run_tests 2>&1
  "
  local elapsed=$((SECONDS - started))
  [ "$status" -ne 0 ]
  # The limit is 2s; a run that took the stub's full sleep (120s) never applied
  # it. 20s keeps the bound meaningful on a slow host while staying far from 120.
  [ "$elapsed" -lt 20 ]
  [[ "$output" == *"was killed after the wall-clock limit (2s)"* ]]
  [[ "$output" != *"tests passed"* ]]
}

@test "AC-GATE-SHELL-TESTS-04: a wedged test is capped by BATS_TEST_TIMEOUT, not left to hang" {
  # Observed on this repo's own pre-commit: bats has no default test timeout, so
  # a test that blocks forever (inherited fd, `read` on closed stdin) held the
  # commit open indefinitely. The adapter must pass a finite cap through.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__"

  # Never run by the stub below; a literal long sleep here once leaked into the
  # hook's own run as an orphaned `sleep 300` (its bats runner was killed).
  cat > "$work/githooks/__tests__/hangs.test.bats" <<'SUITE'
#!/usr/bin/env bats
@test "wedged" {
  sleep 120
}
SUITE

  # Fake bats that only passes when it was handed a timeout.
  cat > "$work/bin/bats" <<'STUB'
#!/usr/bin/env bash
if [ -n "${BATS_TEST_TIMEOUT:-}" ]; then
  echo "TIMEOUT_SEEN:$BATS_TEST_TIMEOUT"
fi
exit 0
STUB
  chmod +x "$work/bin/bats"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    # An exported cap in the caller's environment is the knob working as
    # designed, but it would make this assertion measure that export instead of
    # the default. The default is what is under test here.
    unset XP_GATE_BATS_TEST_TIMEOUT
    # shellcheck source=/dev/null
    . '$ADAPTER_COMMON'
    . '$ADAPTER'
    run_tests 2>&1
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"TIMEOUT_SEEN:300"* ]]
}

@test "AC-GATE-SHELL-TESTS-04: the per-test cap is overridable for slower runners" {
  # A CI runner slower than local must be able to raise the cap without editing
  # the adapter; the override is read from the environment only.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__"

  cat > "$work/githooks/__tests__/sample.test.bats" <<'SUITE'
#!/usr/bin/env bats
@test "trivially passing" {
  [ 1 -eq 1 ]
}
SUITE

  cat > "$work/bin/bats" <<'STUB'
#!/usr/bin/env bash
echo "TIMEOUT_SEEN:${BATS_TEST_TIMEOUT:-unset}"
exit 0
STUB
  chmod +x "$work/bin/bats"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    XP_GATE_BATS_TEST_TIMEOUT=900
    export XP_GATE_BATS_TEST_TIMEOUT
    # shellcheck source=/dev/null
    . '$ADAPTER_COMMON'
    . '$ADAPTER'
    run_tests 2>&1
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"TIMEOUT_SEEN:900"* ]]
}

@test "AC-GATE-SHELL-TESTS-05: a failing suite's verdict survives Gate 5's head -50" {
  # Measured on this repo: Gate 5 blocked and printed "head -50" of a 4000-line
  # log, so the failing suite's "not ok" never reached the terminal.
  #
  # The runner's own 50-line budget is asserted in bats-runner.test.bats; what
  # this test pins is the adapter's side of the contract -- it must hand the
  # runner a log directory (so the full log outlives the capture) and it must
  # name the failing suite inside the first 50 lines.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__"
  printf '#!/usr/bin/env bats\n@test "t" { true; }\n' > "$work/githooks/__tests__/a.test.bats"

  cat > "$work/bin/bats" <<'STUB'
#!/usr/bin/env bash
for i in $(seq 1 40); do echo "ok $i"; done
echo "not ok 41 trivially failing"
echo "FAILURE_SENTINEL_MARKER"
exit 1
STUB
  chmod +x "$work/bin/bats"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  # As in the hook: the log directory is gate-owned, and the capture is cut
  # to 50 lines exactly the way gate-5-entry.sh cuts it. The exit status is
  # kept out of the pipe (PIPESTATUS), as the hook does with $?.
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    export XP_GATE_BATS_LOG_DIR='$work/logs'
    mkdir -p \"\$XP_GATE_BATS_LOG_DIR\"
    # shellcheck source=/dev/null
    . '$ADAPTER_COMMON'
    . '$ADAPTER'
    run_tests 2>&1 | head -50
    exit \"\${PIPESTATUS[0]}\"
  "
  [ "$status" -ne 0 ]
  [[ "$output" == *"not ok 41"* ]]
  [[ "$output" == *"❌ Shell tests FAILED at suite 1/1"* ]]
  # The full log is on disk, where the report points.
  local log
  log="$(find "$work/logs" -name '*.tap' | head -1)"
  [ -n "$log" ]
  grep -q "FAILURE_SENTINEL_MARKER" "$log"
}

@test "AC-GATE-SHELL-TESTS-05: a source-able adapter that exits without a verdict is not a pass" {
  # Exit 1 with no "not ok" is bats reporting a truncated plan, not a verdict.
  # If run_tests treated it as clean, a broken bats install would turn Gate 5
  # green; treating it as a failure of THIS suite would misreport the blame.
  # It is neither: the gate must stop, quote what bats said, and not pass.
  #
  # This test also pins the shell-level trap the runner had: the hook runs the
  # adapter under `set -e`, where a failing command in a command substitution
  # exits the adapter BEFORE anything is reported. The test therefore sources
  # adapter-common.sh (which sets the hook's shell options) exactly as the
  # hook does; a bare sourcing of shell.sh would not reproduce it.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__" "$work/logs"
  printf '#!/usr/bin/env bats\n@test "t" { true; }\n' > "$work/githooks/__tests__/a.test.bats"
  cat > "$work/bin/bats" <<'STUB'
#!/usr/bin/env bash
echo "bats warning: Executed 1 instead of expected 8 tests"
exit 1
STUB
  chmod +x "$work/bin/bats"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  # As in the hook: this suite runs against an EMPTY log directory (bats said
  # nothing before exiting), which is how "no verdict" is told apart from a test
  # failure. Without the directory the runner cannot classify and falls back to
  # the no-log branch, so the directory is part of the scenario.
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    export XP_GATE_BATS_LOG_DIR='$work/logs'
    # shellcheck source=/dev/null
    . '$ADAPTER_COMMON'
    . '$ADAPTER'
    run_tests 2>&1
  "
  [ "$status" -ne 0 ]
  [[ "$output" == *"DID NOT RUN"* ]]
  [[ "$output" == *"Executed 1 instead of expected 8"* ]]
  [[ "$output" != *"tests passed"* ]]
}

@test "AC-GATE-SHELL-TESTS-05: a missing runner library fails closed instead of skipping" {
  # The adapter sources lib/bats-runner.sh relative to its own directory. If
  # that file is not installed, an adapter that reports "no runner" and returns
  # 0 turns every later commit green on a machine where nothing ran.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/adapters" "$work/bin" "$work/githooks/__tests__"
  cp "$ADAPTER" "$work/adapters/shell.sh"
  printf '#!/usr/bin/env bats\n@test "t" { true; }\n' > "$work/githooks/__tests__/a.test.bats"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$work/bin/bats"
  chmod +x "$work/bin/bats"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER_COMMON'
    . '$work/adapters/shell.sh'
    run_tests 2>&1
  "
  [ "$status" -ne 0 ]
  [[ "$output" == *"Shell test runner missing"* ]]
  [[ "$output" != *"tests passed"* ]]
}

@test "AC-GATE-SHELL-TESTS-02: the shunit2 branch is no longer a silent no-op" {
  # The old branch detected shunit2 and returned 0 without executing it. A
  # detection that cannot run anything must not be spelled as a skip inside a
  # gate that reports PASS for it.
  run bash -c "grep -vE '^[[:space:]]*#' '$ADAPTER' | grep -nE 'Skip - shunit2'"
  [ "$status" -ne 0 ]
}

@test "AC-GATE-SHELL-TESTS-01: a project with no shell suite reports no-suite, not a pass that ran tests" {
  # Distinguishable outcome: no suite anywhere must not print the same line a
  # successful run prints.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin"
  printf '#!/usr/bin/env bash\necho x\n' > "$work/a.sh"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  run bash -c "
    cd '$work' || exit 9
    # shellcheck source=/dev/null
    . '$ADAPTER_COMMON'
    . '$ADAPTER'
    run_tests 2>&1
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"No shell test suite detected"* ]]
}
