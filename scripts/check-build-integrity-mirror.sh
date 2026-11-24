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

# The shared --post-sync check; see scripts/lib/mirror-post-sync.sh for why it is
# separate from the default "does the mirror match" verifier.
# shellcheck source=scripts/lib/mirror-post-sync.sh
. "$(dirname "$0")/lib/mirror-post-sync.sh"
xp_gate_assert_post_sync "$mirror" "$@" || [ $? -eq 2 ] || exit $?

# `__tests__/` is deliberately absent from the mirror: it holds the source tree's
# own vitest suites, which the npm package neither ships nor runs. Before P1-E
# step 2 the mirror carried a stale copy of that directory, so a plain recursive
# diff happened to agree; once the mirror became a generated artifact
# (src/npm-package/scripts/generate-mirrors.cjs, 9 files) the generator correctly
# stopped emitting it and the recursive diff started reporting
# "Only in src/build-integrity: __tests__" on every run.
#
# Exclude rather than deleting the canonical tests: the suites are real, they are
# just not mirror content. `-x` matches the directory name at any depth, which is
# what "tests anywhere in this tree are not shipped" means.
if ! diff -ru -x '__tests__' "$canonical" "$mirror"; then
  printf '%s\n' "FAIL: $mirror differs from canonical $canonical before sync" >&2
  exit 1
fi

printf '%s\n' "PASS: $mirror matches canonical $canonical"
