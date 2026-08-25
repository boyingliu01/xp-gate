#!/usr/bin/env bash
set -euo pipefail

canonical_dir="githooks/lib"
mirror_dir="src/npm-package/hooks/lib"

fail() {
  printf '%s\n' "FAIL: $1" >&2
  exit 1
}

[ -d "$canonical_dir" ] || fail "missing canonical hook library directory: $canonical_dir"
[ -d "$mirror_dir" ] || fail "missing generated hook library directory: $mirror_dir"

canonical_files=$(find "$canonical_dir" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)
mirror_files=$(find "$mirror_dir" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)
[ "$canonical_files" = "$mirror_files" ] || fail "hook library file sets differ"

while IFS= read -r name; do
  [ -n "$name" ] || continue
  canonical="$canonical_dir/$name"
  mirror="$mirror_dir/$name"
  if [ -L "$canonical" ] || [ ! -f "$canonical" ]; then
    fail "canonical path must be a regular file: $canonical"
  fi
  if [ -L "$mirror" ] || [ ! -f "$mirror" ]; then
    fail "mirror path must be a regular file: $mirror"
  fi
  cmp -s "$canonical" "$mirror" || fail "$mirror differs from canonical $canonical"
done <<EOF
$canonical_files
EOF

printf '%s\n' "PASS: generated hook libraries match canonical githooks/lib"
