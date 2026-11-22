#!/usr/bin/env bats
# @test REQ-G13-TS-DECLARES-TYPE-CHECKER
#
# @intent Gate 13 checked nothing on TypeScript projects. The adapter declared no
# `compiler_check_command`, so on every .ts change the gate printed
#
#     i  No compile-time checker declared by this project's language adapter.
#     Gate 13 (SKIP) completed in 0s
#
# Measured 2026-11-22 in a fixture that shipped a tsconfig with `"strict": true`
# and a parameter with no type: `tsc --noEmit` reported TS7006, and the gate
# recorded SKIP without invoking it. TypeScript is the language this repository is
# written in, so the gate was blind to type errors in the code that defines it.
#
# The fix is a declaration, not a special case: the contract at
# gate-13-compiler-strictness.sh:1132 is "an adapter may declare a command, or
# declare nothing", and nothing makes the gate record SKIP with a reason. These
# tests pin both halves -- the command exists, and its silence is deliberate.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/typescript.sh"
}

# Load the adapter's functions without running its dispatch.
load_adapter() {
  # shellcheck disable=SC1090
  source "$ADAPTER"
}

# @covers the adapter declares a type checker at all
@test "the typescript adapter declares compiler_check_command" {
  run grep -qE '^compiler_check_command\(\)' "$ADAPTER"
  [ "$status" -eq 0 ]
}

# @covers the declared command is tsc --noEmit, the type checker and not a bundler
@test "the declared command is tsc --noEmit" {
  run bash -c "cd '$BATS_TEST_TMPDIR' && touch tsconfig.json && source '$ADAPTER' && compiler_check_command"
  [ "$status" -eq 0 ]
  [[ "$output" == *"tsc"* ]]
  [[ "$output" == *"--noEmit"* ]]
}

# @covers SILENCE when there is no tsconfig -- the important half
#
# tsc without a config applies its own defaults, which are not the project's
# strictness setting. Running it would report on a configuration nobody chose, and
# inventing a command is the exact defect this repository keeps fixing: a verdict
# the gate did not compute. Empty output makes the gate record SKIP with a reason.
@test "no tsconfig means no command, so the gate reports SKIP rather than PASS" {
  local empty="$BATS_TEST_TMPDIR/no-tsconfig"
  mkdir -p "$empty"
  run bash -c "cd '$empty' && source '$ADAPTER' && compiler_check_command"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# @covers the command never installs what it was asked to detect
#
# `npx tsc` would download a compiler during a gate. A gate must never wait on the
# network, and a probe must not install the thing it is probing for.
@test "the declared command does not use npx" {
  run bash -c "cd '$BATS_TEST_TMPDIR' && touch tsconfig.json && source '$ADAPTER' && compiler_check_command"
  [[ "$output" != *"npx"* ]]
}

# @covers a broken fixture is a probe bug, not a gate verdict
#
# The probe once truncated a multi-line second file with `read`, which takes one
# line, so tsconfig.json became a bare "{". tsc then reported TS1005 and the probe
# read that as the gate refusing clean code. The helper that writes probe files has
# to preserve multi-line content.
@test "the probe helper preserves multi-line second files" {
  run grep -qF 'xcontent=${extra#*"$TAB"}' "$REPO_ROOT/scripts/gate-language-probe.sh"
  [ "$status" -eq 0 ]
  # And it must not go back to `read`, which consumes a single line.
  run grep -c 'IFS=\$TAB read -r xpath xcontent' "$REPO_ROOT/scripts/gate-language-probe.sh"
  [ "$output" = "0" ]
}
