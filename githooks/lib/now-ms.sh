#!/bin/bash
# ============================================================================
# now_ms() — Cross-platform epoch-milliseconds timestamp (Issue #370 fix)
#
# Windows Git Bash's `date +%s%3N` outputs literal "N" (e.g. "1753001234N")
# and exits 0, so || fallback chains never trigger. This function:
#   1. Prefers `node -e 'console.log(Date.now())'` (cross-platform, always ms)
#   2. Validates output with ^[0-9]+$ regex
#   3. Falls back to `date +%s` (seconds × 1000) if node output is invalid
#   4. Final fallback: echo 0
#
# Source this file: source "$(dirname "${BASH_SOURCE[0]}")/lib/now-ms.sh"
# ============================================================================

now_ms() {
  local ts
  # Preferred: node (cross-platform, always produces epoch milliseconds)
  ts=$(node -e 'console.log(Date.now())' 2>/dev/null)
  if [[ "$ts" =~ ^[0-9]+$ ]]; then
    echo "$ts"
    return
  fi

  # Fallback: date +%s (seconds only — multiply by 1000 for ms)
  ts=$(date +%s 2>/dev/null)
  if [[ "$ts" =~ ^[0-9]+$ ]]; then
    echo $((ts * 1000))
    return
  fi

  # Final fallback
  echo 0
}
