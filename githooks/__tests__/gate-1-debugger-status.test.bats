#!/usr/bin/env bats
#
# @test REQ-GATE1-DEBUGGER-STATUS
# @intent Gate 1 blocks the commit but records a PASS, so the journal says the
#         gate found nothing while the console says it found a debugger statement.
#
#         Measured in a real repo with a real hook. Staged file:
#             src/bad.ts -> "export function f(a: any) {\n  debugger;\n  return a;\n}"
#
#         Console:
#             → Gate 1: Code Quality (static analysis + linting)...
#                ── Checking typescript ──
#             ✅ PASSED - TypeScript static analysis.
#             ✅ PASSED - ESLint linting.
#             ❌ BLOCKED - 'debugger' statements detected:
#             src/bad.ts:2:  debugger;
#             Remove debugger statements before committing.
#                 Gate 1: Code Quality                          PASS
#
#         The commit IS blocked -- the arm does `return 1`, and that return
#         exits gate_1_run() from inside the language loop. What is wrong is the
#         recorded verdict: the debugger arm never assigns GATE_1_STATUS, so it
#         keeps the "PASS" set at the top of the body. The audit row and the
#         quality report therefore both say PASS.
#
#         This is the "not checked must never be indistinguishable from passed"
#         family, in its louder direction: a check that DID find something is
#         recorded as not having found it. The console and the journal disagree,
#         and the journal is the one anybody reads afterwards.
#
#         The same omission exists on the ESLint-error path and the
#         tsc-error path -- every arm that returns without setting the status.
#         This test pins the debugger arm, which is the one measured end to end.
#
# @covers AC-GATE1-DEBUGGER-01 AC-GATE1-DEBUGGER-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ENTRY="$REPO/githooks/gate-entries/gate-1-entry.sh"
}

@test "AC-GATE1-DEBUGGER-01: a blocking arm sets FAIL before it returns" {
  # Structural, in the form that catches the defect: find the debugger BLOCKED
  # message, then require a GATE_1_STATUS assignment between it and its return.
  local line
  # Skip comment lines: the arm's own doc block quotes this same message, and
  # `head -1` found the quote first, so the window never contained the code.
  line=$(grep -n "BLOCKED - 'debugger' statements detected" "$ENTRY"     | grep -vE ':[[:space:]]*#' | head -1 | cut -d: -f1)
  [ -n "$line" ] || { echo "debugger arm not found"; return 1; }

  # The arm's closing `return 1` is within the next 12 lines.
  local window
  window=$(sed -n "${line},$((line + 12))p" "$ENTRY")

  printf '%s' "$window" | grep -q 'return 1' || {
    echo "expected the debugger arm to return 1 within 12 lines of its message"
    return 1
  }
  printf '%s' "$window" | grep -qE 'GATE_1_STATUS="(FAIL|BLOCK)"' || {
    echo "the debugger arm returns 1 without setting GATE_1_STATUS=FAIL, so the"
    echo "initial PASS survives into the audit row and the quality report."
    echo "Arm:"
    printf '%s\n' "$window"
    return 1
  }
}

@test "AC-GATE1-DEBUGGER-02: no blocking return leaves the status at PASS" {
  # Generalised sweep: every `return 1` in the gate body must be preceded in the
  # same arm by a status assignment. Reported as a list so the next omission is
  # named rather than rediscovered.
  local offenders="" lineno=0
  while IFS= read -r l; do
    lineno=$((lineno + 1))
    case "$l" in
      *'return 1'*)
        # Look back up to 15 lines for a status assignment. Deliberately generous:
        # an arm may echo several lines before returning.
        local from=$((lineno - 15)); [ "$from" -lt 1 ] && from=1
        if ! sed -n "${from},$((lineno - 1))p" "$ENTRY" | grep -qE 'GATE_1_STATUS="(FAIL|BLOCK|SKIP|WARN)"'; then
          offenders="$offenders $lineno"
        fi
        ;;
    esac
  done < "$ENTRY"

  [ -z "$offenders" ] || {
    echo "these 'return 1' lines have no GATE_1_STATUS assignment in the 15 lines"
    echo "above them, so the verdict they block on is recorded as whatever the"
    echo "status was before (usually PASS):"
    echo "  lines:$offenders"
    return 1
  }
}