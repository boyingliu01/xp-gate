#!/usr/bin/env bash
# ============================================================================
# The `--post-sync` check every mirror verifier shares.
#
# A mirror verifier has two jobs that look alike and are not:
#
#   default       is the mirror, as committed, identical to its canonical source?
#   --post-sync   did the sync command just change the committed mirror?
#
# The second is what catches a sync that silently rewrites a file nobody edited --
# a generator emitting different bytes on a different machine, say. Both copies of
# this check were byte-identical, and the rule is one rule.
#
# Usage (source this file, then):
#   xp_gate_assert_post_sync "$mirror" "$@"
# ============================================================================

# Exit 0 when the sync left the committed mirror untouched, 1 when it changed it.
#
# `--untracked-files=all` matters: a sync that EMITS A NEW FILE changes nothing
# that a default `git status` would show, and that new file would ship unverified.
xp_gate_assert_post_sync() {
  local mirror="$1"
  shift

  if [ "${1:-}" != "--post-sync" ]; then
    return 2
  fi

  local status
  status=$(git status --porcelain --untracked-files=all -- "$mirror")
  if [ -n "$status" ]; then
    printf '%s\n' "FAIL: sync changed committed $mirror mirror" >&2
    printf '%s\n' "$status" >&2
    exit 1
  fi
  printf '%s\n' "PASS: sync left committed $mirror unchanged"
  exit 0
}
