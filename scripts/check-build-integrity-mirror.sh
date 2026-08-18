#!/usr/bin/env bash
set -euo pipefail

canonical="src/build-integrity"
mirror="src/npm-package/build-integrity"

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

if ! diff -ru "$canonical" "$mirror"; then
  printf '%s\n' "FAIL: $mirror differs from canonical $canonical before sync" >&2
  exit 1
fi

printf '%s\n' "PASS: $mirror matches canonical $canonical"
