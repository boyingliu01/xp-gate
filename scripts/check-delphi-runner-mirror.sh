#!/usr/bin/env bash
set -euo pipefail

canonical="scripts/delphi-external-review.cjs"
mirror="src/npm-package/scripts/delphi-external-review.cjs"

if [ "${1:-}" = "--post-sync" ]; then
  status=$(git status --porcelain --untracked-files=all -- "$mirror")
  if [ -n "$status" ]; then
    printf '%s\n' "FAIL: sync changed committed $mirror mirror" >&2
    printf '%s\n' "$status" >&2
    exit 1
  fi
  printf '%s\n' "PASS: sync left committed $mirror unchanged"
  exit 0
fi

if [ ! -f "$canonical" ] || [ ! -f "$mirror" ]; then
  printf '%s\n' "FAIL: Delphi runner mirror pair is incomplete: $canonical -> $mirror" >&2
  exit 1
fi

if ! cmp -s "$canonical" "$mirror"; then
  printf '%s\n' "FAIL: $mirror differs from canonical $canonical before sync" >&2
  exit 1
fi

printf '%s\n' "PASS: $mirror matches canonical $canonical"
