#!/usr/bin/env bats
# @test REQ-475
# @intent When semgrep exits with a runtime error (2, intermittent in the field when the
#         remote ruleset fetch fails), Gate 10 printed only "semgrep runtime error" and
#         swallowed the captured output. The user could not tell a network failure from
#         a bad path from a broken ruleset. The gate must show what the tool actually
#         said, while keeping the SKIP verdict and the exit-code semantics unchanged.
# @covers AC-475-01, AC-475-02, AC-475-03, AC-475-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-10.sh"
  TEST_DIR="$(mktemp -d)"

  mkdir -p "$TEST_DIR/bin"
  cd "$TEST_DIR" || return 1
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  # Without this, the machine-wide core.hooksPath runs the real gate suite on every
  # fixture commit.
  git config core.hooksPath .git/hooks
  echo "seed" > README.md
  git add README.md
  git commit -q -m "seed"
  echo "export const value = 1;" > app.ts
  git add app.ts
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Sources gate-10.sh with a stub semgrep whose behaviour is fixed by the two
# STUB_* variables in the stub script itself.
run_gate_with_semgrep() {
  (
    set -u
    cd "$TEST_DIR" || exit 1
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    GATE_10_STATUS=""
    HOME="$TEST_DIR/no-home"
    PATH="$TEST_DIR/bin:$PATH"
    # shellcheck disable=SC1091
    source "$GATE"
    printf 'STATUS=%s' "$GATE_10_STATUS"
  )
}

write_semgrep_stub() {
  local exit_code="$1" message="$2"
  cat > "$TEST_DIR/bin/semgrep" << STUB
#!/bin/sh
echo "$message" >&2
exit $exit_code
STUB
  chmod +x "$TEST_DIR/bin/semgrep"
}

@test "AC-475-01: an exit-2 run shows the tool's real error before skipping" {
  write_semgrep_stub 2 "Failed to fetch ruleset p/security-audit: connection timed out"
  run run_gate_with_semgrep
  [[ "$output" == *"connection timed out"* ]]
  [[ "$output" == *"SKIPPED - SAST"* ]]
}

@test "AC-475-02: a runtime error still SKIPs, it never BLOCKs" {
  write_semgrep_stub 2 "some internal failure"
  run run_gate_with_semgrep
  [[ "$output" == *"STATUS=SKIP"* ]]
  [[ "$output" != *"BLOCKED"* ]]
  [ "$status" -eq 0 ]
}

@test "AC-475-03: the verdict for the other exit codes is unchanged" {
  write_semgrep_stub 0 '{"results":[]}'
  run run_gate_with_semgrep
  [[ "$output" == *"STATUS=PASS"* ]]
}

@test "AC-475-04 anti-vacuity: the error branch prints the captured output, not just its own line" {
  # The defect was that SEMGREP_OUTPUT was captured and never shown on this path.
  run awk '/semgrep runtime error/,/GATE_10_STATUS="SKIP"/' "$GATE"
  [[ "$output" == *"SEMGREP_OUTPUT"* ]]
}
