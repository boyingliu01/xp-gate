#!/usr/bin/env bats
#
# @test REQ-GATE-SHELL-BATS-RESOLUTION
# @intent `run_tests()` in the shell adapter probed `command -v bats` and nothing
#         else. bats is a devDependency, so a real install puts it at
#         node_modules/.bin/bats -- which is NOT on PATH when a git hook runs (git
#         does not source the shell profile, and npm only adds node_modules/.bin
#         for `npm run` scripts). Measured here: `command -v bats` was empty while
#         node_modules/.bin/bats existed and was executable.
#
#         The adapter therefore printed "bats not available, skipping shell test
#         suite" and returned 0 on every real invocation -- a skip that reads as
#         "nothing to check" when a suite was installed and never ran.
#
#         Scope note, because it decides what is deliberately NOT changed here:
#         the .bats contracts are owned by CI's `bats-contracts` job, which shards
#         them across runners. quality-gates.yml says so in as many words -- "do
#         not re-add a silent copy here" -- because running them serially was
#         measured at 18m47s of a 22m24s job. This file fixes only HOW the adapter
#         finds bats, not WHETHER the hook runs it. Making the hook run the suites
#         would undo that optimisation, which is a decision above this adapter.
#
# @covers AC-SHELLBATS-01 AC-SHELLBATS-02
#
# Why the pre-existing adapter-shell-tests.test.bats never caught this: every one
# of its cases prepends a fake bats directory to PATH, which is exactly the
# condition that does not hold during a hook run. The tests below deliberately do
# not do that -- the first asserts `bats` is absent from PATH before testing the
# fallback, so the precondition cannot silently stop holding.
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/shell.sh"
}

@test "AC-SHELLBATS-01: run_tests finds node_modules/.bin/bats when bats is not on PATH" {
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__" "$work/node_modules/.bin"

  cat > "$work/githooks/__tests__/sample.test.bats" <<'SUITE'
#!/usr/bin/env bats
@test "trivially passing" { [ 1 -eq 1 ]; }
SUITE

  # Stand-in for the real devDependency, at the path npm actually installs to.
  cat > "$work/node_modules/.bin/bats" <<'STUB'
#!/usr/bin/env bash
echo "BATS_RAN"
exit 0
STUB
  chmod +x "$work/node_modules/.bin/bats"

  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:/usr/bin:/bin'
    export PATH
    command -v bats >/dev/null 2>&1 && { echo 'precondition broken: bats is on PATH'; exit 7; }
    # shellcheck source=/dev/null
    . '$ADAPTER'
    run_tests 2>&1
  "

  [[ "$output" != *"bats not available"* ]] ||
    { echo "the adapter skipped a suite that WAS installed locally: $output"; return 1; }
  [[ "$output" == *"BATS_RAN"* ]] ||
    { echo "node_modules/.bin/bats was not executed: $output"; return 1; }
  [ "$status" -eq 0 ]
}

@test "AC-SHELLBATS-01: bats is resolved from an ancestor node_modules/.bin" {
  # npm hoists dependencies to the workspace root, so a project nested inside a
  # workspace must resolve the same way -- this is why typescript.sh walks
  # ancestors. Without it, a nested call reports "bats not available" for a tool
  # installed two levels up.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/node_modules/.bin" "$work/pkg/githooks/__tests__"

  printf '#!/usr/bin/env bats\n@test "x" { [ 1 -eq 1 ]; }\n' \
    > "$work/pkg/githooks/__tests__/sample.test.bats"
  cat > "$work/node_modules/.bin/bats" <<'STUB'
#!/usr/bin/env bash
echo "ANCESTOR_BATS_RAN"
exit 0
STUB
  chmod +x "$work/node_modules/.bin/bats"

  run bash -c "
    cd '$work/pkg' || exit 9
    PATH='$work/bin:/usr/bin:/bin'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER'
    run_tests 2>&1
  "

  [[ "$output" == *"ANCESTOR_BATS_RAN"* ]] ||
    { echo "an ancestor node_modules/.bin was not searched: $output"; return 1; }
}

@test "AC-SHELLBATS-02: a genuinely missing bats still reports skip, not a silent pass" {
  # Anti-vacuity for the fix: widening resolution must not turn "nothing
  # installed" into "claimed to run". The distinction has to survive.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__"

  printf '#!/usr/bin/env bats\n@test "would pass" { [ 1 -eq 1 ]; }\n' \
    > "$work/githooks/__tests__/sample.test.bats"

  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:/usr/bin:/bin'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER'
    run_tests 2>&1
  "

  [[ "$output" == *"bats not available"* ]] ||
    { echo "a truly missing bats must still say so, got: $output"; return 1; }
}

@test "AC-SHELLBATS-02: a failing locally-installed suite makes run_tests fail" {
  # The verdict must come from the suite wherever it was found. A resolution fix
  # that locates bats but discards its exit status would be worse than the skip.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__" "$work/node_modules/.bin"

  printf '#!/usr/bin/env bats\n@test "trivially failing" { [ 1 -eq 2 ]; }\n' \
    > "$work/githooks/__tests__/failing.test.bats"

  cat > "$work/node_modules/.bin/bats" <<'STUB'
#!/usr/bin/env bash
echo "not ok 1 trivially failing"
exit 1
STUB
  chmod +x "$work/node_modules/.bin/bats"

  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:/usr/bin:/bin'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER'
    run_tests 2>&1
  "

  [ "$status" -ne 0 ] ||
    { echo "run_tests returned 0 for a failing suite found at node_modules/.bin"; return 1; }
}

@test "AC-SHELLBATS-02: a globally installed bats on PATH still works" {
  # Someone with a system bats and no local devDependency must keep working. The
  # local search is tried first, but it must not become the only rung.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/githooks/__tests__"

  printf '#!/usr/bin/env bats\n@test "x" { [ 1 -eq 1 ]; }\n' \
    > "$work/githooks/__tests__/sample.test.bats"
  cat > "$work/bin/bats" <<'STUB'
#!/usr/bin/env bash
echo "PATH_BATS_RAN"
exit 0
STUB
  chmod +x "$work/bin/bats"

  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:/usr/bin:/bin'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER'
    run_tests 2>&1
  "

  [[ "$output" == *"PATH_BATS_RAN"* ]] ||
    { echo "a bats on PATH was not used: $output"; return 1; }
}
