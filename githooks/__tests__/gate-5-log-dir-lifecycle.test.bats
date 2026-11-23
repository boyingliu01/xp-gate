#!/usr/bin/env bats
#
# @test REQ-GATE5-LOG-DIR The Gate 5 test-log directory must not leak per commit
# @intent Gate 5 creates a directory, hands it to the adapter as
#         XP_GATE_BATS_LOG_DIR, and prints the runner's report -- which names the
#         full TAP path. The first version of that code said the directory was
#         "gate-owned (and removed)" while nothing removed it, so every commit
#         left one behind. The trade-off that replaces the claim: a GREEN run
#         deletes the directory (its paths are noise), a RED run keeps it (those
#         paths are the evidence the reader was just told to open).
#
#         These cases run the real hook chain in a fixture repo and inspect
#         XP_GATE_TEST_LOG_ROOT, which is where the gate mktemp's its parent.
# @covers AC-GATE5-LOG-DIR-01
# @covers AC-GATE5-LOG-DIR-02
# @covers AC-GATE5-LOG-DIR-03
#
# ASCII only.

SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

# shellcheck source=/dev/null
. "$BATS_TEST_DIRNAME/helpers/install-hook-set.bash"

setup() {
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"

  install_hook_set "$SOURCE_GITHOOKS" "$TEST_DIR/.git/hooks"
  git config core.hooksPath "$TEST_DIR/.git/hooks"

  # Own the project tier (PROJECT_GITHOOKS = <repo>/githooks). Without it the
  # global tier wins for any adapter name it already ships, so this fixture ran
  # ~/.config/xp-gate/adapters/shell.sh: an older release whose header has no
  # "per-test cap" and whose success line does not exist. Both assertions below
  # would then describe the host install instead of the code under review.
  mkdir -p "$TEST_DIR/githooks/adapters" "$TEST_DIR/githooks/lib"
  cp "$SOURCE_GITHOOKS/adapter-common.sh" "$TEST_DIR/githooks/"
  cp "$SOURCE_GITHOOKS"/adapters/*.sh "$TEST_DIR/githooks/adapters/"
  cp "$SOURCE_GITHOOKS"/lib/*.sh "$TEST_DIR/githooks/lib/"

  # Gates 2/6/8/10 run before Gate 5; stub them so this suite measures the log
  # directory, not the host toolchain (same reason as the other Gate 5 suites).
  mkdir -p "$TEST_DIR/bin"
  cat > "$TEST_DIR/bin/jscpd" << 'MOCK'
#!/bin/bash
echo '{"duplicates":[]}'
exit 0
MOCK
  cat > "$TEST_DIR/bin/lizard" << 'MOCK'
#!/bin/bash
exit 0
MOCK
  cat > "$TEST_DIR/bin/gitleaks" << 'MOCK'
#!/bin/bash
case "$*" in *--version*) echo "8.0.0"; exit 0 ;; esac
echo "[]"
exit 0
MOCK
  cat > "$TEST_DIR/bin/semgrep" << 'MOCK'
#!/bin/bash
case "$*" in *--version*) echo "1.0.0"; exit 0 ;; esac
echo '{"results":[],"errors":[]}'
exit 0
MOCK
  # A bats whose verdict is chosen by a marker file, so the two cases below
  # differ ONLY in the suite's outcome.
  cat > "$TEST_DIR/bin/bats" << 'MOCK'
#!/bin/bash
case "$*" in *--version*) echo "Bats 1.13.0"; exit 0 ;; esac
for arg in "$@"; do
  case "$arg" in
    *verdict-fail*) echo "1..1"; echo "not ok 1 verdict"; exit 1 ;;
  esac
done
echo "1..1"
echo "ok 1 verdict"
exit 0
MOCK
  chmod +x "$TEST_DIR/bin/"*
  export PATH="$TEST_DIR/bin:$PATH"

  # The log parent lives inside the fixture so the assertions are about this
  # commit's directory, not about whatever else shares TMPDIR.
  export XP_GATE_TEST_LOG_ROOT="$TEST_DIR/logroot"
  mkdir -p "$XP_GATE_TEST_LOG_ROOT"

  echo "init" > README.md
  mkdir -p src scripts
  echo 'export const x = 1;' > src/foo.ts
  printf "import { expect, test } from 'vitest';\ntest('foo', () => { expect(1 + 1).toBe(2); });\n" > src/foo.test.ts
  echo "ignore: []" > .archlint.yaml
  mkdir -p tests
  printf '#!/usr/bin/env bats\n@test "t" { true; }\n' > tests/suite.test.bats
  git add . && git commit --no-verify -q -m "init"
  rm -f .quality-history.jsonl
  rm -rf .xp-gate
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

run_fixture_hook() {
  local out
  status=0
  out=$(SKIP_VERSION_CHECK=1 "$TEST_DIR/.git/hooks/pre-commit" 2>&1) || status=$?
  output="$out"
}

# Count the directories the gate created under the injected root.
created_dirs() {
  find "$XP_GATE_TEST_LOG_ROOT" -mindepth 1 -maxdepth 1 -name 'xp-gate-gate5.*' -type d 2>/dev/null | wc -l | tr -d ' '
}

@test "AC-GATE5-LOG-DIR-01: a green test run leaves no log directory behind" {
  # A shell script (not the .bats) is what makes Gate 5 run the tests at all:
  # a .bats change alone is "docs/config" to the gate and skips the run, which
  # would leave this case green without ever creating or cleaning a directory.
  printf '#!/usr/bin/env bash
echo touched
' > scripts/lifecycle-a.sh
  git add scripts/lifecycle-a.sh
  run_fixture_hook
  # The shell suite passed: the gate must have cleaned up after itself.
  [[ "$output" == *"Shell tests passed"* ]]
  local n
  n="$(created_dirs)"
  [ "$n" -eq 0 ]
}

@test "AC-GATE5-LOG-DIR-02: a failing test run keeps the directory and prints its path" {
  # The stub in setup exits 1 for any suite whose path contains "verdict-fail".
  printf '#!/usr/bin/env bats
@test "t" { true; }
' > tests/verdict-fail.test.bats
  printf '#!/usr/bin/env bash
echo touched
' > scripts/lifecycle-b.sh
  git add scripts/lifecycle-b.sh tests/verdict-fail.test.bats
  run_fixture_hook
  [ "$status" -ne 0 ]
  [[ "$output" == *"Shell test suite failed"* ]]
  local n
  n="$(created_dirs)"
  [ "$n" -eq 1 ]
  # The path printed in the report is inside the directory that was kept.
  local kept
  kept="$(find "$XP_GATE_TEST_LOG_ROOT" -mindepth 1 -maxdepth 1 -name 'xp-gate-gate5.*' -type d 2>/dev/null | head -1)"
  [[ "$output" == *"$kept"* ]]
  # And the TAP it points at exists: a path that opens onto nothing would be
  # the same "details above" incident with a file name attached.
  local log
  log="$(grep -oE "$kept/[^ ]*\.tap" <<< "$output" | head -1)"
  [ -n "$log" ]
  [ -f "$log" ]
  # Existence alone would pass for an empty file: the evidence the reader is
  # told to open must actually name the failure that stopped the commit.
  grep -q "not ok 1 verdict" "$log"
}

@test "AC-GATE5-LOG-DIR-03: a red run that wrote no evidence leaves no directory behind" {
  # "Kept on failure" is right when the report names a log the reader can open.
  # A red that never reached the runner (here: the runner file is gone, an
  # install defect) prints no path at all, so keeping the empty directory is
  # pure leak -- one per commit, exactly the defect this batch removes.
  rm -f "$TEST_DIR/githooks/lib/bats-runner.sh"
  printf '#!/usr/bin/env bash
echo touched
' > scripts/lifecycle-c.sh
  git add scripts/lifecycle-c.sh
  run_fixture_hook
  [ "$status" -ne 0 ]
  [[ "$output" == *"Shell test runner missing"* ]]
  local n
  n="$(created_dirs)"
  [ "$n" -eq 0 ]
}
