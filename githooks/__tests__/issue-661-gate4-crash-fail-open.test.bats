#!/usr/bin/env bats
# @test REQ-661
# @intent Gate 4 reported `PASSED - Principles checker (no errors found).` on a
#         Windows global install where the checker had never loaded. The crash was
#         visible in the output right above the verdict:
#
#           Error [ERR_MODULE_NOT_FOUND]: Cannot find module
#             'C:\c\Users\think\.config\xp-gate\modules\principles\index.ts'
#           PASSED - Principles checker (no errors found).
#
#         Two defects, and the second is the one that survived the first fix:
#
#         1. `$HOME` under Git-Bash is POSIX (`/c/Users/think`), and native node
#            reads a leading `/` as the current drive root, so the path became
#            `C:\c\Users\...`. Fixed by converting through `to_native_path`
#            (the #581/#582 class).
#
#         2. Exit >= 2 -- the checker did not RUN -- was recorded as SKIP, and
#            pre-commit treats SKIP as non-blocking, so a tool failure was absorbed
#            into a green light. This is the serious half: a gate that cannot run
#            must not report success (#499/#570), and the user is told their code
#            passed a check that never executed.
#
#         The distinction Gate 4 must keep:
#           - tool NOT INSTALLED (no npx/tsx) -> SKIP is honest, nothing claimed;
#           - tool PRESENT but CRASHED      -> WARN. Not a pass (nothing was
#             checked), and not a silent skip (the user must know their code went
#             unaudited). WARN rather than FAIL because the COMMIT is not
#             necessarily bad -- the tool is broken -- and blocking every commit
#             until node/tsx is repaired would blame the change for an
#             environment fault. What must never happen is the green light.
#
#         This file pins (2). Defect (1) is asserted structurally, because
#         reproducing a real Windows `$HOME` shape inside bats would test the
#         fixture instead of the gate.
# @covers AC-670-46, AC-670-47, AC-670-48

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-4.sh"
}

# Print the executable lines (comments stripped) of the exit>=2 branch.
# Comments are stripped because the fix explains the old defect by quoting its
# verdict, and matching that prose would fail the test on a correct fix.
exit_ge_2_branch() {
  awk '/if \[ "\$PRINCIPLES_EXIT" -ge 2 \]; then/{f=1} f&&/^        else$/{exit} f' "$GATE" \
    | grep -vE '^[[:space:]]*#'
}

# AC-670-46: the checker path is converted before it reaches a native binary.
@test "AC-670-46: PRINCIPLES_DIR is converted via to_native_path before run_tsx" {
  [ -f "$GATE" ]
  local conv_line=''
  local run_line=''
  conv_line=$(grep -n 'PRINCIPLES_DIR="\$(to_native_path' "$GATE" | head -1 | cut -d: -f1)
  run_line=$(grep -n 'run_tsx "\$PRINCIPLES_DIR/index.ts"' "$GATE" | head -1 | cut -d: -f1)
  [ -n "$conv_line" ] || { echo "PRINCIPLES_DIR never converted to a native path"; return 1; }
  [ -n "$run_line" ] || { echo "run_tsx invocation not found"; return 1; }
  # The conversion must come BEFORE the first invocation, or the checker still
  # receives the POSIX value.
  [ "$conv_line" -lt "$run_line" ] \
    || { echo "conversion at line $conv_line happens after the call at $run_line"; return 1; }
}

# AC-670-47: a checker that crashes is never reported as PASSED, and never
# silently SKIPPED.
@test "AC-670-47: exit >= 2 yields WARN, not PASS and not a silent SKIP" {
  local code=''
  code=$(exit_ge_2_branch)
  [ -n "$code" ] || { echo "exit>=2 branch not found"; return 1; }

  # No pass verdict for a check that did not execute.
  if printf '%s\n' "$code" | grep -q 'PASSED'; then
    echo "exit>=2 branch prints PASSED:"
    printf '%s\n' "$code"
    return 1
  fi
  # No silent SKIP either.
  if printf '%s\n' "$code" | grep -qE 'GATE_4_STATUS="SKIP"'; then
    echo "checker crash still recorded as SKIP (pre-commit treats SKIP as non-blocking):"
    printf '%s\n' "$code"
    return 1
  fi
  # And the verdict it DOES reach must be one that cannot read as healthy.
  printf '%s\n' "$code" | grep -qE 'GATE_4_STATUS="WARN"|GATE_4_STATUS="FAIL"' \
    || { echo "crash records no verdict at all"; return 1; }
}

# AC-670-48: the crash is attributed and surfaced, not swallowed.
@test "AC-670-48: a crashed checker names the failure and its reason" {
  local code=''
  code=$(exit_ge_2_branch)
  [ -n "$code" ] || { echo "exit>=2 branch not found"; return 1; }

  # A reason code the parent can journal -- "no files" and "tool crashed" must not
  # look the same in the audit log.
  printf '%s\n' "$code" | grep -q 'GATE_4_REASON=' \
    || { echo "no GATE_4_REASON recorded for a crash"; return 1; }
  # And the user must be told the check did not run, in a way they can act on.
  printf '%s\n' "$code" | grep -qiE 'did not run|not verified|failed to run|execution error' \
    || { echo "message does not state that the check did not run"; return 1; }
}
