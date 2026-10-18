#!/usr/bin/env bats
# @test REQ-543
# @intent semgrep 1.171 silently ignores .semgrepignore when files are passed as
#         explicit targets (measured: file target -> findings survive every form
#         of ignore/exclude/--exclude-rule; dir target + --include -> ignore is
#         honored). Gate 10 passed `./file` per staged file, so the audited
#         suppressions in .semgrepignore never applied and an ignored finding on
#         a NEW path blocked commits it must not block. The gate now passes each
#         staged file's DIRECTORY as a target plus --include=<basename>, which
#         scans exactly the staged set AND lets semgrep apply its own ignore file.
# @covers AC-543-01, AC-543-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-10.sh"
  TEST_DIR="$(mktemp -d)"

  mkdir -p "$TEST_DIR/bin" "$TEST_DIR/src/lib" "$TEST_DIR/src/ok"
  cd "$TEST_DIR" || return 1
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  git config core.hooksPath .git/hooks
  echo "seed" > README.md
  git add README.md
  git commit --no-verify -q -m "seed"

  # Audited suppression, same shape as the repo's real .semgrepignore.
  printf '# fixture ignore\nsrc/lib/suppressed.ts\n' > .semgrepignore
  # Two files that trigger detect-child-process identically.
  printf 'const cp = require("child_process");\nexport function f(cmd: string) { return cp.execSync(cmd); }\n' > src/lib/suppressed.ts
  printf 'const cp = require("child_process");\nexport function g(cmd: string) { return cp.execSync(cmd); }\n' > src/ok/flagged.ts
  git add src/lib/suppressed.ts src/ok/flagged.ts .semgrepignore
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Real semgrep when installed; SKIP otherwise (this test asserts ignore
# semantics of the tool+args combination, a stub could not express them).
require_real_semgrep() {
  command -v semgrep >/dev/null 2>&1 || skip "semgrep not installed"
}

run_gate() {
  # The gate's blocking branch calls `exit 1` — inside a subshell that would
  # end the subshell before STATUS could print (the multifile suite avoids this
  # because its stub never blocks). Run in a child bash and carry the status in
  # its output.
  local runner="$TEST_DIR/run-gate.sh"
  cat > "$runner" << RUNNER
set -u
cd "$TEST_DIR" || exit 1
gate_start_ms() { echo 0; }
record_gate_audit() { :; }
GATE_10_STATUS=""
HOME="$TEST_DIR/no-home"
trap 'printf "STATUS=%s\n" "\${GATE_10_STATUS:-EXITED}"' EXIT
# shellcheck disable=SC1091
source "$GATE"
printf 'STATUS=%s\n' "\$GATE_10_STATUS"
RUNNER
  bash "$runner"
}

@test "AC-543-01: an ignored file's finding does not block (only the flagged one blocks)" {
  require_real_semgrep
  run run_gate
  # The gate must BLOCK on src/ok/flagged.ts alone...
  # The gate's blocking branch sets STATUS=FAIL and calls `exit 1`.
  [ "$status" -eq 1 ]
  [[ "$output" == *"STATUS=FAIL"* ]]
  # ...and its findings list must contain ONLY that file.
  [[ "$output" == *"flagged.ts"* ]]
  [[ "$output" != *"suppressed.ts"* ]]
}

@test "AC-543-02: with only the ignored file staged, the gate PASSES (suppression is real)" {
  require_real_semgrep
  git reset -q HEAD src/ok/flagged.ts
  rm -f src/ok/flagged.ts
  run run_gate
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=PASS"* ]]
}
