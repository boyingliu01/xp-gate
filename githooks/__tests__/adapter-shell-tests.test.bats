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
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/shell.sh"
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
    . '$ADAPTER'
    run_tests 2>&1
  "
  [ "$status" -ne 0 ]
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
    . '$ADAPTER'
    run_tests 2>&1
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"No shell test suite detected"* ]]
}
