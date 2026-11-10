#!/usr/bin/env bats
#
# @test REQ-GATE-INTEGRITY TypeScript adapter must not treat `npx <tool> --version`
#       as a local-installation probe
# @intent `run_tests()` / `run_coverage()` decided "is vitest available?" by
#         running `npx vitest --version`. `npx` does not answer that question: when
#         the package is absent locally it DOWNLOADS it from the registry and runs
#         it, so the probe always succeeds. Measured on dsh-aot-runner (a C#/Node
#         repo with no vitest at all):
#
#           $ npx vitest --version
#           vitest/5.1.0 win32-x64 node-v24.22.1     # rc=0
#           $ ls node_modules/vitest
#           (absent)
#
#         The adapter then ran `npx vitest run --coverage`, which failed with
#         "MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'", and
#         Gate 5 reported that as TESTS FAILED -- while not a single test had run.
#         Two harms in one: a false block, and a network fetch + execution of an
#         unrelated package on every commit.
#
#         This is the same convention AGENTS.md states for `XP_GATE_NPX_PROBE`
#         (answering "is it installed?" must not install it). The TypeScript side
#         already honours it in src/gates/common-process.ts; the shell adapter did
#         not.
#
# @covers AC-NPX-PROBE-01 detection never lives behind npx
# @covers AC-NPX-PROBE-02 a locally installed runner is still detected
# @covers AC-NPX-PROBE-03 an absent runner is reported as SKIP, not as a test failure
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/typescript.sh"
  COMMON="$REPO_ROOT/githooks/adapter-common.sh"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/bin"
  # npx stub: logs every invocation. `--version` "succeeds" exactly like the real
  # npx does after it downloads the package, so any leftover `--version` probe in
  # the adapter is visible in $WORK/npx.log as a call that should not happen.
  cat > "$WORK/bin/npx" <<'STUB'
#!/bin/sh
echo "npx $*" >> "$NPX_LOG"
case "$*" in
  *--version*)
    case "$*" in
      *vitest*) echo "vitest/5.1.0 stub" ;;
      *jest*)   echo "jest 30.0.0 stub" ;;
      *biome*)  echo "Version: 2.0.0 stub" ;;
      *)        echo "stub 1.0.0" ;;
    esac
    exit 0 ;;
esac
exit 0
STUB
  chmod +x "$WORK/bin/npx"
  export NPX_LOG="$WORK/npx.log"
  : > "$NPX_LOG"
}

teardown() {
  rm -rf "$WORK"
}

# Runs an adapter function with the npx stub first on PATH.
#
# adapter-common.sh is sourced FIRST: typescript.sh assumes run_without_git_context
# is already defined (it is provided there, not in the adapter). Without it the
# adapter silently fails every probe and the assertions below would pass for the
# wrong reason -- a green test that never reached the code under test.
_run_fn() {
  local fn="$1"
  # PATH is extended in the OUTER shell so the inner $PATH expands to the real
  # system path. Writing it inside the quoted script as \$PATH would work too, but
  # an accidental unescaped $PATH there truncates PATH to the stub dir alone --
  # which silently removes mktemp/tee/grep and makes every call look unrunnable.
  local stub_path="$WORK/bin:$PATH"
  run bash -c "
    export PATH='$stub_path'
    export NPX_LOG='$NPX_LOG'
    cd '$WORK'
    source '$COMMON'
    source '$ADAPTER'
    $fn
  "
}

@test "AC-NPX-PROBE-01: run_tests never issues a --version probe" {
  _run_fn run_tests
  # Assert the LOG, not the absence of a log line: an empty log also results from
  # a broken harness, which would make this test green without testing anything.
  # The harness is proven live by AC-NPX-PROBE-02, which requires the local
  # binary to be found and run.
  run grep -E '(vitest|jest) --version' "$NPX_LOG"
  [ "$status" -ne 0 ]
}

@test "AC-NPX-PROBE-02: a locally installed runner is detected and executed" {
  # Local install shape: node_modules/.bin/vitest exists. The adapter must find it
  # there (a real install resolves through that binary, not through npx).
  mkdir -p "$WORK/node_modules/.bin"
  cat > "$WORK/node_modules/.bin/vitest" <<'STUB'
#!/bin/sh
echo "LOCAL_VITEST ran: $*" >&2
exit 0
STUB
  chmod +x "$WORK/node_modules/.bin/vitest"
  _run_fn run_tests
  [ "$status" -eq 0 ]
  [[ "$output" == *"LOCAL_VITEST"* ]]
}

@test "AC-NPX-PROBE-02: a locally installed jest is detected when vitest is absent" {
  mkdir -p "$WORK/node_modules/.bin"
  cat > "$WORK/node_modules/.bin/jest" <<'STUB'
#!/bin/sh
echo "LOCAL_JEST ran: $*" >&2
exit 0
STUB
  chmod +x "$WORK/node_modules/.bin/jest"
  _run_fn run_tests
  [ "$status" -eq 0 ]
  [[ "$output" == *"LOCAL_JEST"* ]]
}

@test "AC-NPX-PROBE-03: an absent runner is SKIP (rc=0), never reported as a failure" {
  _run_fn run_tests
  # rc=0 with an explicit notice. Returning 1 here is exactly what turned "nothing
  # to run" into "TESTS FAILED" for a repo that simply does not use vitest/jest.
  [ "$status" -eq 0 ]
  [[ "$output" == *"No test runner"* || "$output" == *"SKIP"* ]]
}

@test "AC-NPX-PROBE-01: run_coverage never issues a --version probe" {
  _run_fn run_coverage
  run grep -E '(vitest|jest) --version' "$NPX_LOG"
  [ "$status" -ne 0 ]
}

@test "AC-NPX-PROBE-02: a locally installed runner drives coverage" {
  mkdir -p "$WORK/node_modules/.bin"
  cat > "$WORK/node_modules/.bin/vitest" <<'STUB'
#!/bin/sh
echo "LOCAL_VITEST_COV ran: $*" >&2
exit 0
STUB
  chmod +x "$WORK/node_modules/.bin/vitest"
  _run_fn run_coverage
  [ "$status" -eq 0 ]
  [[ "$output" == *"LOCAL_VITEST_COV"* ]]
  [[ "$output" == *"--coverage"* ]]
}

@test "AC-NPX-PROBE-03: absent coverage runner is SKIP (rc=0), not a failure" {
  _run_fn run_coverage
  [ "$status" -eq 0 ]
  [[ "$output" == *"No test runner"* || "$output" == *"SKIP"* ]]
}

@test "AC-NPX-PROBE-01: biome detection never issues a --version probe" {
  _run_fn run_biome_lint
  run grep -E 'biome --version' "$NPX_LOG"
  [ "$status" -ne 0 ]
}

@test "AC-NPX-PROBE-04: a crashing runner is not reported as a test failure" {
  # The second half of the same confusion: a runner that COULD NOT RUN must not be
  # reported as a runner that found failing tests. Here the local binary exists but
  # exits with a dependency error, mirroring the real
  # "MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'".
  mkdir -p "$WORK/node_modules/.bin"
  cat > "$WORK/node_modules/.bin/vitest" <<'STUB'
#!/bin/sh
echo "MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'" >&2
exit 1
STUB
  chmod +x "$WORK/node_modules/.bin/vitest"
  _run_fn run_coverage
  # A genuine test failure and an unrunnable runner are different verdicts; the
  # output must say so rather than claiming tests failed.
  [[ "$output" == *"could not run"* || "$output" == *"missing dependency"* || "$output" == *"cannot run"* ]]
}
