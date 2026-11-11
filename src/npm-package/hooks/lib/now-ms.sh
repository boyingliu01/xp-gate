#!/bin/bash
# ============================================================================
# now_ms() — Cross-platform epoch-milliseconds timestamp (Issue #370 fix)
#
# RETURNS: epoch milliseconds on stdout, or nothing (empty) when no source is
# available. Callers treat empty as "unmeasurable", never as 0: a fabricated zero
# would make every duration look like an instant gate.
#
# ORDER OF METHODS, fastest first. This function is called twice per gate, so its
# per-call cost is multiplied by 2 x (number of gates) on every commit:
#
#   1. $EPOCHREALTIME  — bash 5+ builtin, NO fork, ~0 ms.
#                        "1794406209.964280" -> drop the dot -> microseconds.
#   2. date +%s%3N     — one fork, ~5 ms where the platform supports %N.
#                        Git Bash on Windows historically printed a literal "N"
#                        ("1753001234N") and exited 0, so the output is validated
#                        and a non-numeric result is REJECTED rather than used.
#   3. date +%s        — whole seconds only; multiplied by 1000. Coarse, but it
#                        still separates "gates are slow" from "the hook around
#                        them is".
#
# `node -e 'Date.now()'` used to be method 1. It is correct and cross-platform but
# costs ~580 ms per call on Windows, and at 2-4 calls per gate across 14 gates it
# added ~60 s to every commit (#798). It is deliberately NOT used here: a clock
# that dominates the thing it measures is worse than a clock with fewer digits.
#
# Source this file: source "$(dirname "${BASH_SOURCE[0]}")/lib/now-ms.sh"
# ============================================================================

now_ms() {
  local ts

  # 1. bash 5+ builtin clock. Zero forks.
  if [ -n "${EPOCHREALTIME:-}" ]; then
    case "$EPOCHREALTIME" in
      *[!0-9.]* | "") : ;; # unexpected shape, fall through
      *)
        # "1794406209.964280" -> "1794406209964280" -> first 13 digits = ms.
        ts="${EPOCHREALTIME/./}"
        case "$ts" in
          [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*)
            echo "${ts:0:13}"
            return
            ;;
        esac
        ;;
    esac
  fi

  # 2. date with nanoseconds. Validated: Git Bash may emit a literal "N".
  ts=$(date +%s%3N 2>/dev/null)
  case "$ts" in
    *[!0-9]* | "") : ;; # non-numeric (the "N" bug) — reject, do not guess
    *)
      # Guard against the seconds-only shape a %N-less date would produce.
      if [ "${#ts}" -ge 12 ]; then
        echo "$ts"
        return
      fi
      ;;
  esac

  # 3. Whole seconds. Coarse but honest.
  ts=$(date +%s 2>/dev/null)
  case "$ts" in
    *[!0-9]* | "") return ;;
    *) echo $((ts * 1000)) ;;
  esac
}
