#!/usr/bin/env bash
#
# xp-gate-version-check.sh — Claude Code PostToolUse hook
#
# Checks whether a newer xp-gate version is available.
# Caches the check result in /tmp/.xp-gate-version-checked with 5-minute TTL.
# Uses flock for concurrent-session safety.
#

set -e

CACHE_FILE="/tmp/.xp-gate-version-checked"
CACHE_TTL=300  # 5 minutes

# ── flock-based concurrent access guard ──
LOCK_FILE="/tmp/.xp-gate-version-check.lock"
exec 200>"$LOCK_FILE"
flock -n 200 2>/dev/null || exit 0  # another instance is already checking

# ── Check cache validity ──
if [[ -f "$CACHE_FILE" ]]; then
  read -r CACHED_VERSION CACHED_TS < "$CACHE_FILE" 2>/dev/null || true
  NOW=$(date +%s 2>/dev/null || echo 0)
  if [[ -n "$CACHED_TS" && -n "$NOW" ]]; then
    AGE=$(( NOW - CACHED_TS ))
    if [[ "$AGE" -lt "$CACHE_TTL" ]]; then
      # cache valid — no output needed unless outdated
      exit 0
    fi
  fi
fi

# ── Check version via xp-gate CLI ──
if ! command -v xp-gate &>/dev/null; then
  echo "[xp-gate] CLI not found — install with: npm install -g @boyingliu01/xp-gate" >&2
  exit 0
fi

# run with 5-second timeout, capture exit code
set +e
PREVIEW=$(xp-gate upgrade --preview 2>/dev/null)
EXIT_CODE=$?
set -e

if [[ "$EXIT_CODE" -ne 0 || -z "$PREVIEW" ]]; then
  # check failed — update cache with empty to avoid retry storm
  echo "failed $(date +%s)" > "$CACHE_FILE"
  exit 0
fi

# parse JSON to extract outdated flag and remote version
REMOTE=$(echo "$PREVIEW" | grep -o '"remote":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo '')
OUTDATED=$(echo "$PREVIEW" | grep -o '"outdated":true' 2>/dev/null || echo '')

# update cache (even if not outdated)
echo "$REMOTE $(date +%s)" > "$CACHE_FILE"

if [[ -n "$REMOTE" && -n "$OUTDATED" ]]; then
  echo "[xp-gate] New version v${REMOTE} available — run: xp-gate upgrade" >&2
fi

exit 0
