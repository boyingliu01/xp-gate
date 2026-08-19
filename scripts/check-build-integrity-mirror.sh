#!/usr/bin/env bash
set -euo pipefail

canonical="src/build-integrity"
mirror="src/npm-package/build-integrity"

validate_regular_tree() {
  tree_path="$1"
  if [ -L "$tree_path" ] || [ ! -d "$tree_path" ]; then
    printf '%s\n' "FAIL: mirror path must be a regular directory: $tree_path" >&2
    exit 1
  fi
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    invalid_mode=$(git ls-files -s -- "$tree_path" | while IFS=' ' read -r mode _rest; do
      if [ "$mode" != "100644" ] && [ "$mode" != "100755" ]; then
        printf '%s' "$mode"
        break
      fi
    done)
    if [ -n "$invalid_mode" ]; then
      printf '%s\n' "FAIL: mirror tree contains invalid Git mode $invalid_mode: $tree_path" >&2
      exit 1
    fi
  fi
}

validate_regular_tree "$canonical"
validate_regular_tree "$mirror"

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
