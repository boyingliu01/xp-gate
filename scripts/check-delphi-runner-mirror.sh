#!/usr/bin/env bash
set -euo pipefail

canonical="scripts/delphi-external-review.cjs"
mirror="src/npm-package/scripts/delphi-external-review.cjs"

validate_regular_file() {
  file_path="$1"
  if [ -L "$file_path" ] || [ ! -f "$file_path" ]; then
    printf '%s\n' "FAIL: mirror path must be a regular file: $file_path" >&2
    exit 1
  fi
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    mode=$(git ls-files -s -- "$file_path" | cut -d' ' -f1)
    if [ -n "$mode" ] && [ "$mode" != "100644" ] && [ "$mode" != "100755" ]; then
      printf '%s\n' "FAIL: mirror path has invalid Git mode $mode: $file_path" >&2
      exit 1
    fi
  fi
}

validate_regular_file "$canonical"
validate_regular_file "$mirror"

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

if ! cmp -s "$canonical" "$mirror"; then
  printf '%s\n' "FAIL: $mirror differs from canonical $canonical before sync" >&2
  exit 1
fi

printf '%s\n' "PASS: $mirror matches canonical $canonical"
