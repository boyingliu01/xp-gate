#!/usr/bin/env bats
# @test REQ-630
# @intent #602 removed the vacuous Java arm from Gate 6 -- it piped the build into
#         `| head` and then printed "\u2705 completed" unconditionally, so a real
#         architecture violation reported success. The Go arm kept the identical
#         shape, and the issue is explicit that Java was fixed and Go was not.
#
#         `arch-go check 2>&1 | head -20` has the exit status of `head`: 0 for any
#         non-empty output. So ANY arch-go result -- including contract
#         violations -- printed "\u2705 Go architecture validation completed" and the
#         commit landed. A gate that cannot fail is not a gate.
#
#         The fix mirrors the Python arm: capture the tool's own status and block
#         on it. The pipeline still needs `head` to bound the log, so the status
#         has to come from PIPESTATUS[0], not from `$?`.
# @covers AC-630-01, AC-630-02, AC-630-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
}

# AC-630-01: the Go arm takes arch-go's own exit status.
@test "AC-630-01: the Go arm judges arch-go by PIPESTATUS, not by head's exit code" {
  local arm
  arm=$(awk '/"go"\)/{f=1} f&&/^      "java"\)/{exit} f' "$HOOK")
  [ -n "$arm" ]
  printf '%s\n' "$arm" | grep -q 'PIPESTATUS\[0\]'
}

# AC-630-02: a non-zero arch-go means BLOCKED, not "completed".
@test "AC-630-02: a failing arch-go blocks the commit" {
  local arm
  arm=$(awk '/"go"\)/{f=1} f&&/^      "java"\)/{exit} f' "$HOOK")
  printf '%s\n' "$arm" | grep -q 'BLOCKED'
  printf '%s\n' "$arm" | grep -q 'exit 1'
}

# AC-630-03: the unconditional success line must be gone from the Go arm. This is
# the actual defect: the "completed" echo ran whether the checker passed or not.
@test "AC-630-03: the Go arm only prints success after a passing status check" {
  local arm
  arm=$(awk '/"go"\)/{f=1} f&&/^      "java"\)/{exit} f' "$HOOK")
  # Structural proof: the success echo must be preceded, in the same arm, by a
  # non-zero status test that exits. Without that guard, "completed" is
  # unconditional -- which is precisely #630.
  local echo_line rc_line
  echo_line=$(printf '%s\n' "$arm" | grep -n 'Go architecture validation completed' | head -1 | cut -d: -f1)
  rc_line=$(printf '%s\n' "$arm" | grep -n '_go_arch_rc.*-ne 0' | head -1 | cut -d: -f1)
  [ -n "$echo_line" ] && [ -n "$rc_line" ]
  [ "$rc_line" -lt "$echo_line" ]
  # The status must come from the checker, not from head.
  printf '%s\n' "$arm" | grep -q 'PIPESTATUS\[0\]'
  # And the bare `$?` reading (head's status) must not be what decides the arm.
  if printf '%s\n' "$arm" | grep -qE '_go_arch_rc=\$\?'; then
    echo "the Go arm still reads \$? (head's status) instead of the checker's:"
    printf '%s\n' "$arm"
    return 1
  fi
  return 0
}
