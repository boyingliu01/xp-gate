#!/bin/bash
# ============================================================================
# audit-sanitize.sh — honest gate-duration bookkeeping (REQ-B, #536 family)
#
# .xp-gate/audit.jsonl carried 389 records whose duration_ms was an epoch-
# sized integer: a poisoned start_ms (empty -> arithmetic 0, or a SECONDS-unit
# value from a pre-#370 code path) turned `end - start` into "now". The old
# handler clamped negatives to 0 and flagged >2h runs with duration_anomaly,
# but still wrote the astronomical number itself. Fail closed on the input
# instead: when start_ms cannot be a millisecond epoch, record null + reason
# so every consumer can exclude the sample instead of averaging a lie.
#
# Source this file: source "$(dirname "${BASH_SOURCE[0]}")/lib/audit-sanitize.sh"
# ============================================================================

# Millisecond epochs are 13 digits from 2001 through 2286; seconds epochs are
# 10 digits in that whole window. A 10-digit start is therefore provably the
# wrong unit, and anything else non-numeric is corruption. Both cases yield
# "null"; a valid 13-digit value passes through untouched.
sanitize_start() {
  local s="$1"
  case "$s" in
    ''|*[!0-9]*) printf 'null' ;;
    *)
      if [ "${#s}" -eq 13 ]; then
        printf '%s' "$s"
      else
        printf 'null'
      fi
      ;;
  esac
}

# compute_duration_ms <start_ms> <end_ms> -> delta | null
compute_duration_ms() {
  local clean_end clean_start
  clean_start=$(sanitize_start "$1")
  clean_end=$(sanitize_start "$2")
  if [ "$clean_start" = "null" ] || [ "$clean_end" = "null" ]; then
    printf 'null'
    return
  fi
  local delta=$((clean_end - clean_start))
  if [ "$delta" -lt 0 ]; then
    # Clock skew between two now_ms() calls is rarer than poisoning but the
    # same rule applies: a negative runtime must never masquerade as 0.
    printf 'null'
    return
  fi
  printf '%s' "$delta"
}
