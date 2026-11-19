#!/usr/bin/env bats
#
# @test REQ-GATE-TS-DECLARED-RUNNER The TypeScript adapter must honour the test
#       command the project declares, not only the two runners it knows by name
# @intent `run_tests()` checked `node_modules/.bin/vitest` and
#         `node_modules/.bin/jest` and, failing both, printed
#
#           SKIP - No test runner installed locally
#
#         and returned 0. That is right for a project with no tests, and wrong
#         for a project that declares its runner in package.json -- which is the
#         project's own statement of how its tests run, on the same footing as
#         the `node_modules/.bin` probe. Node ships a test runner built in
#         (`node --test`, Node 18+), so "no test runner installed locally" is
#         now frequently false: measured on a fixture whose package.json says
#         `"test": "node --test"` with a deliberately failing assertion, Gate 5
#         reported SKIP, the commit walked past it, and the failing test was
#         never run. A SKIP whose stated reason is not true is worse than no
#         check: it reads as "this project has no tests to run".
#
#         The `scripts.test` route does NOT reintroduce the npx problem this
#         file warns about at the top of typescript.sh: it runs what the project
#         declared, locally, and installs nothing.
#
# @covers AC-GATE-TS-DECLARED-RUNNER-01  a declared runner is used
# @covers AC-GATE-TS-DECLARED-RUNNER-02  a declared runner's failure propagates
# @covers AC-GATE-TS-DECLARED-RUNNER-03  no declaration => still SKIP, not BLOCK
# @covers AC-GATE-TS-DECLARED-RUNNER-04  a vitest/jest install still wins
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/typescript.sh"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/bin"
  cd "$WORK" || return 1
}

teardown() {
  cd /
  rm -rf "$WORK"
}

# Give the fixture a package.json whose test script records that it ran, and a
# config so nothing else in the adapter's path has to exist.
with_test_script() {
  printf '%s\n' "$1" > package.json
  mkdir -p src
  printf 'export const x = 1;\n' > src/a.ts
}

@test "AC-GATE-TS-DECLARED-RUNNER-01: a declared test script is executed" {
  # The runner only has to prove it ran. Exit 0 = passing suite.
  with_test_script '{"name":"p","scripts":{"test":"touch ran.marker"}}'

  run bash -c "cd '$WORK' && source '$REPO_ROOT/githooks/adapter-common.sh' 2>/dev/null; source '$ADAPTER' 2>/dev/null; run_tests"

  [ -f "$WORK/ran.marker" ]
}

@test "AC-GATE-TS-DECLARED-RUNNER-02: a failing declared runner is reported as a failure" {
  # This is the whole point: a failing suite must not exit 0. Before the fix the
  # adapter did not run it at all and returned 0 with a SKIP line.
  with_test_script '{"name":"p","scripts":{"test":"exit 1"}}'

  run bash -c "cd '$WORK' && source '$REPO_ROOT/githooks/adapter-common.sh' 2>/dev/null; source '$ADAPTER' 2>/dev/null; run_tests"

  [ "$status" -ne 0 ]
}

@test "AC-GATE-TS-DECLARED-RUNNER-03: no test script and no installed runner stays SKIP (exit 0)" {
  # The anti-vacuity guard in the other direction. A project with nothing to run
  # must NOT start blocking -- that was the #454 regression, and the fix for a
  # missed runner must not resurrect it.
  with_test_script '{"name":"p"}'

  run bash -c "cd '$WORK' && source '$REPO_ROOT/githooks/adapter-common.sh' 2>/dev/null; source '$ADAPTER' 2>/dev/null; run_tests"

  [ "$status" -eq 0 ]
  printf '%s' "$output" | grep -q "SKIP"
}

@test "AC-GATE-TS-DECLARED-RUNNER-04: an installed vitest still takes precedence over scripts.test" {
  # The declared script is a FALLBACK for the case the named runners do not
  # cover. A project with vitest installed keeps the existing path, including
  # its output shape, which the gate's failure handler parses.
  with_test_script '{"name":"p","scripts":{"test":"touch declared.marker"}}'
  mkdir -p node_modules/.bin
  cat > node_modules/.bin/vitest <<'STUB'
#!/usr/bin/env bash
touch vitest.marker
exit 0
STUB
  chmod +x node_modules/.bin/vitest

  run bash -c "cd '$WORK' && source '$REPO_ROOT/githooks/adapter-common.sh' 2>/dev/null; source '$ADAPTER' 2>/dev/null; run_tests"

  [ -f "$WORK/vitest.marker" ]
  [ ! -f "$WORK/declared.marker" ]
}
