#!/usr/bin/env bats
#
# @test REQ-BATS-RUNNER The Shell test arm must bound every run and name every outcome
# @intent Four outcomes of one bats suite must not read as one message. Before this
#         runner existed, `run_tests` warned and continued on any non-zero exit
#         without a `not ok` line. Measured consequences: a bats that crashed on
#         start (empty log) was reported as an unverified skip-in-passing, and a
#         suite whose output arrived late was cut off by Gate 5's `head -50`, so
#         the commit said "Tests FAILED" and named no suite.
#
#         These tests drive the REAL runner against stub `bats` executables, one
#         per outcome, and assert both the words and the exit status: a runner
#         that names the wrong cause sends the reader to the wrong file.
# @covers AC-BATS-RUNNER-01
# @covers AC-BATS-RUNNER-02
# @covers AC-BATS-RUNNER-03
# @covers AC-BATS-RUNNER-04
# @covers AC-BATS-RUNNER-05
# @covers AC-BATS-RUNNER-06
# @covers AC-BATS-RUNNER-07
# @covers AC-BATS-RUNNER-08
# @covers AC-BATS-RUNNER-09
# @covers AC-BATS-RUNNER-10
# @covers AC-BATS-RUNNER-11
#
# ASCII only.

setup() {
  RUNNER="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/lib/bats-runner.sh"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/bin" "$WORK/logs"
  SUITE="$WORK/sample.test.bats"
  printf '#!/usr/bin/env bats\n@test "t" { true; }\n' > "$SUITE"
  # run_without_git_context is provided by adapter-common.sh in the hook. A stub
  # keeps these tests about the runner's judgement, not the hook's plumbing; the
  # isolation itself is covered by adapter-shell-tests.test.bats.
  run_without_git_context() { "$@"; }
  export -f run_without_git_context
  # The hook always hands the runner a log directory (gate-5 makes one). This
  # setup mirrors that, so the tests exercise the file-based path; the
  # no-directory fallback is covered by AC-BATS-RUNNER-08.
  export XP_GATE_BATS_LOG_DIR="$WORK/logs"
}

teardown() {
  rm -rf "$WORK"
}

# stub_bats <tap-output> <exit-code>: a fake bats that prints and exits.
#
# The TAP goes to a payload file read with `cat`, not to a here-document: one
# fixture's text routinely contains a word the here-document terminator would
# match, and the two heredocs then swallow the `exit` line. A stub that never
# reaches `exit 1` makes every "must fail" test pass for the wrong reason.
stub_bats() {
  printf '%s\n' "$1" > "$WORK/payload.tap"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'echo "caps=${BATS_TEST_TIMEOUT:-unset}" >&2\n'
    printf 'cat %s\n' "'$WORK/payload.tap'"
    printf 'exit %s\n' "$2"
  } > "$WORK/bin/bats"
  chmod +x "$WORK/bin/bats"
  PATH="$WORK/bin:$PATH"
  export PATH
  # --tap is the contract: the runner asks for TAP so a verdict is one line.
  printf '%s\n' "$SUITE" > "$WORK/suites.txt"
}

@test "AC-BATS-RUNNER-01: a passing suite is silent apart from its tail, and does not leak the cap" {
  stub_bats "$(printf '1..2\nok 1 first\nok 2 second')" 0
  run bash -c ". '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"1..2"* ]]
  [[ "$output" == *"ok 2 second"* ]]
  [[ "$output" == *"✅ Shell tests passed (1 suite(s))"* ]]
}

@test "AC-BATS-RUNNER-02: a failing test stops the run and names the suite and the test" {
  stub_bats "$(printf '1..2\nok 1 first\nnot ok 2 second\n# second failed')" 1
  run bash -c ". '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not ok 2 second"* ]]
  [[ "$output" == *"sample.test.bats FAILED"* ]]
  [[ "$output" == *"❌ Shell tests FAILED at suite 1/1"* ]]
  [[ "$output" != *"✅ Shell tests passed"* ]]
}

@test "AC-BATS-RUNNER-03: a runner that exits non-zero with no verdict is 'DID NOT RUN', not a warning" {
  stub_bats "$(printf 'bats: command not found internally\nerror: could not load helper')" 3
  run bash -c ". '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"DID NOT RUN"* ]]
  [[ "$output" == *"runner fault, not a test failure"* ]]
  [[ "$output" != *"continuing"* ]]
}

@test "AC-BATS-RUNNER-04: an empty log after a non-zero exit is 'without starting a test'" {
  stub_bats "" 2
  # The stub prints `caps=` on stderr, so make it silent to model "bats never
  # got as far as printing anything".
  printf '#!/usr/bin/env bash\nexit 2\n' > "$WORK/bin/bats"
  chmod +x "$WORK/bin/bats"
  run bash -c ". '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"DID NOT RUN: bats exited 2 without starting a test"* ]]
}

@test "AC-BATS-RUNNER-05: the per-test cap reaches bats, defaults to 300 and refuses non-numbers" {
  # No `| tail`: the stub's stderr is written by bats at some point during the
  # run, so filtering the stream can drop it. The whole report is examined.
  stub_bats "$(printf '1..1\nok 1 only')" 0
  run bash -c ". '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"caps=300"* ]]
  run bash -c "XP_GATE_BATS_TEST_TIMEOUT=900; export XP_GATE_BATS_TEST_TIMEOUT; . '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [[ "$output" == *"caps=900"* ]]
  # A typo must not reach bats as BATS_TEST_TIMEOUT=abc (which reads as a crash).
  run bash -c "XP_GATE_BATS_TEST_TIMEOUT=abc; export XP_GATE_BATS_TEST_TIMEOUT; . '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [[ "$output" == *"caps=300"* ]]
  run bash -c "XP_GATE_BATS_TEST_TIMEOUT=0; export XP_GATE_BATS_TEST_TIMEOUT; . '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [[ "$output" == *"caps=300"* ]]
}

@test "AC-BATS-RUNNER-06: a truncated plan (exit 1, no not ok) is not reported as a test failure" {
  # bats --abort on a suite whose plan was cut short exits 1 with no verdict.
  # Calling that "FAILED" blames the test; calling it a pass would be worse.
  stub_bats "$(printf '1..8\nok 1 first\nexecuted 1 test')" 1
  run bash -c ". '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"DID NOT RUN"* ]]
  [[ "$output" != *"sample.test.bats FAILED"* ]]
}

@test "AC-BATS-RUNNER-07: a failing suite's report stays short enough for Gate 5's head -50" {
  # 200 passing lines before the failure: a report that dumped the log would
  # push its own verdict past Gate 5's cut, which is the incident this repo hit.
  local body i
  body="1..201"
  for i in $(seq 1 200); do body="$body"$'\n'"ok $i"; done
  body="$body"$'\n'"not ok 201 the one that matters"
  stub_bats "$body" 1
  run bash -c ". '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not ok 201 the one that matters"* ]]
  [[ "$output" == *"❌ Shell tests FAILED at suite 1/1"* ]]
  local lines
  lines="$(printf '%s\n' "$output" | wc -l | tr -d ' ')"
  [ "$lines" -le 50 ]
}

@test "AC-BATS-RUNNER-08: with no log directory the report says so instead of naming a path" {
  unset XP_GATE_BATS_LOG_DIR
  stub_bats "$(printf '1..2\nok 1 first\nnot ok 2 second')" 1
  run bash -c ". '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [ "$status" -ne 0 ]
  # The failure's own evidence is what makes this branch usable: exit status
  # alone, with the output dropped, is the "Tests FAILED, names nothing" hole.
  [[ "$output" == *"not ok 2 second"* ]]
  [[ "$output" == *"XP_GATE_BATS_LOG_DIR is unset"* ]]
  [[ "$output" != *"Log: "* ]]
  [[ "$output" == *"❌ Shell tests FAILED at suite 1/1"* ]]
}

@test "AC-BATS-RUNNER-09: the first failure stops the run, later suites are not blamed" {
  local second="$WORK/second.test.bats"
  printf '#!/usr/bin/env bats\n@test "t" { true; }\n' > "$second"
  stub_bats "$(printf '1..1\nnot ok 1 boom')" 1
  # stub_bats rewrites suites.txt, so the two-suite list is written after it.
  printf '%s\n%s\n' "$SUITE" "$second" > "$WORK/suites.txt"
  run bash -c ". '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"1 of 2 suite(s) reached"* ]]
  [[ "$output" != *"second.test.bats"*"FAILED"* ]]
}

@test "AC-BATS-RUNNER-10: a suite whose whole plan is skipped says so, and is not green" {
  # `1..0 # SKIP` is how bats reports "every test in the file was skipped". It
  # has to block (a suite that verifies nothing is a one-line way to silence
  # the gate) but it must not read as "a test failed", or the reader goes
  # looking for a failure the log does not contain.
  stub_bats "$(printf '1..0 # SKIP all tests skipped')" 0
  run bash -c ". '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Every test in this suite was skipped"* ]]
  [[ "$output" == *"1..0 # SKIP all tests skipped"* ]]
  [[ "$output" != *"✅ Shell tests passed"* ]]
}

@test "AC-BATS-RUNNER-11: a log of whitespace is 'without starting a test', not a crash" {
  # A runner that prints only a newline produced no explanation; the crashed
  # arm then prints a deduplicated tail, i.e. blank lines, as the reason.
  stub_bats "" 2
  printf '#!/usr/bin/env bash\nprintf "\\n\\n"\nexit 2\n' > "$WORK/bin/bats"
  chmod +x "$WORK/bin/bats"
  run bash -c ". '$RUNNER'; run_bats_suites '$(cat "$WORK/suites.txt")'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"without starting a test"* ]]
  [[ "$output" != *"with no test verdict"* ]]
}
