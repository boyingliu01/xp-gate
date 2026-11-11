#!/usr/bin/env bash
# ============================================================================
# gate-11 entry — extracted from pre-commit by scripts/extract-gates.cjs
#
# WHY THIS FILE EXISTS (#798)
#   The gate order used to BE the physical order of blocks in a 6341-line
#   hook, so changing the order meant moving thousands of lines. An attempt at
#   that also moved the hook epilogue, after which every gate past Gate 13
#   silently stopped running while `bash -n`, a line count and five ordering
#   tests all passed. Gate 5a stopped blocking and only a behavioural test
#   noticed. With one file per gate, order is a list of names in
#   pre-commit's GATE_ORDER and cannot detach a body from its position.
#
# THE BODY BELOW IS A BYTE-EXACT SLICE of the original block. It is wrapped
# in a function so the gate keeps its own variable scope, and is called from
# pre-commit at the point the driver reaches it. Edit the gate here from now
# on - there is no copy left in the hook.
# ============================================================================

# ============================================================================
# GATE 11: Sprint Flow Enforcement
# Validates sprint state consistency (delphi-review APPROVED before BUILD)
# Uses sprint-gate.sh for standalone validation logic
# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_11_run() {
GATE_11_START=$(gate_start_ms)
GATE_11_STATUS="PASS"

# BEGIN SPRINT_GATE_SCRIPT RESOLUTION
# Every tier is a *directory*; the resolver returns the first one that actually holds
# sprint-gate.sh. The chain used to stop at the gate-script directories, but the flat
# global layout ($GATE_DIR -> ~/.config/xp-gate/adapters) carries gate-3/4/7/8/9/10.sh
# and never this script: update-hooks installs sprint-gate.sh under
# ~/.config/xp-gate/hooks, which nothing probed, so a correctly installed machine was
# told the file was missing (#476).
SPRINT_GATE_CANDIDATES=(
  "$GATE_DIR"
  "$(git rev-parse --show-toplevel 2>/dev/null)/githooks"
  "$SCRIPT_DIR"
  "$HOME/.config/xp-gate/hooks"
)
SPRINT_GATE_SCRIPT=$(resolve_sprint_gate_script ${SPRINT_GATE_CANDIDATES[@]+"${SPRINT_GATE_CANDIDATES[@]}"})
# END SPRINT_GATE_SCRIPT RESOLUTION

echo "→ Gate 11: Sprint Flow Enforcement..."

if [ -n "$SPRINT_GATE_SCRIPT" ]; then
  # The decision JSON was piped straight to the terminal with no heading, so it landed
  # under Gate 10's banner and a legitimate "skip: not a sprint project" looked like a
  # bare machine object. The exit status stays the authority for blocking; the JSON only
  # decides which words the user reads.
  SPRINT_GATE_EXIT=0
  SPRINT_GATE_OUTPUT=$(bash "$SPRINT_GATE_SCRIPT" --pre-commit 2>&1) || SPRINT_GATE_EXIT=$?
  SPRINT_GATE_DECISION=$(sprint_gate_decision "$SPRINT_GATE_OUTPUT")
  SPRINT_GATE_DETAIL=$(sprint_gate_detail "$SPRINT_GATE_OUTPUT")

  if [ "$SPRINT_GATE_EXIT" -ne 0 ]; then
    GATE_11_STATUS="BLOCK"
    echo "❌ BLOCKED - Gate 11: Sprint Flow (${SPRINT_GATE_DETAIL:-sprint gate denied})"
    printf '%s\n' "$SPRINT_GATE_OUTPUT" | sed 's/^/     /'
    record_gate_audit "gate-11" "sprint-flow" "$GATE_11_STATUS" "1" "$GATE_11_START"
    # Sprint gate failure is a hard block — exit immediately
    return 1
  fi

  case "$SPRINT_GATE_DECISION" in
    skip)
      echo "⏭️  SKIPPED - Gate 11: Sprint Flow (${SPRINT_GATE_DETAIL:-no reason given})"
      GATE_11_STATUS="SKIP"
      ;;
    allow)
      # #584: `allow` covered three different outcomes and all of them became
      # PASS, so a sprint that was never examined raised PASSED_COUNT and the
      # score. Only a genuinely validated sprint certifies this gate; the rest
      # declined to evaluate and must read as SKIP with the real reason shown.
      SPRINT_GATE_ALLOW_REASON=$(sprint_gate_allow_reason "$SPRINT_GATE_OUTPUT")
      if [ "$SPRINT_GATE_ALLOW_REASON" = "checks-passed" ]; then
        echo "✅ PASSED - Gate 11: Sprint Flow (${SPRINT_GATE_DETAIL:-sprint state validated})"
      else
        echo "⏭️  SKIPPED - Gate 11: Sprint Flow (${SPRINT_GATE_ALLOW_REASON}: ${SPRINT_GATE_DETAIL:-not evaluated})"
        GATE_11_STATUS="SKIP"
      fi
      ;;
    *)
      # A run that succeeded but said nothing this gate understands. Pass on the exit
      # status, but keep the raw output visible rather than inventing a verdict.
      echo "✅ PASSED - Gate 11: Sprint Flow (no recognisable decision in the gate output)"
      printf '%s\n' "$SPRINT_GATE_OUTPUT" | sed 's/^/     /'
      ;;
  esac
else
  echo "⏭️  SKIPPED - Gate 11: Sprint Flow (sprint-gate.sh not found; searched: $(IFS=', '; printf '%s' "${SPRINT_GATE_CANDIDATES[*]}"))"
  GATE_11_STATUS="SKIP"
fi

# Issue #524: pair the units. gate_start_ms is epoch MILLISECONDS (#370 helper);
# the old `date +%s` end was epoch SECONDS, so the subtraction printed about
# -1.79e12 s and poisoned .xp-gate/reports/pre-commit/*.json. now_ms is the same
# helper gate_start_ms delegates to; display divides by 1000.
GATE_11_END=$(now_ms)
GATE_11_DURATION_MS=$((GATE_11_END - GATE_11_START))
if [ "$GATE_11_DURATION_MS" -lt 0 ] 2>/dev/null; then
  # Clock skew or a poisoned timestamp must not print a negative runtime.
  GATE_11_DURATION_MS=0
fi
GATE_11_DURATION=$((GATE_11_DURATION_MS / 1000))
echo "   Gate 11 ($GATE_11_STATUS) completed in ${GATE_11_DURATION}s"
record_gate_audit "gate-11" "sprint-flow" "$GATE_11_STATUS" "0" "$GATE_11_START"
echo ""
# ============================================================================
  return 0
}



# Called by pre-commit's ordered driver.

