#!/usr/bin/env bash
set -euo pipefail

# Guards the canonical githooks trees against mirror drift in the npm package:
#   githooks/<file>        -> src/npm-package/hooks/<file>
#   githooks/adapters/<f>  -> src/npm-package/adapters/<f>
# Byte drift and executable-bit drift both break consumers, so every pair is
# compared for content AND for the Git index mode.

fail() {
  printf '%s\n' "FAIL: $1" >&2
  exit 1
}

HOOK_MIRROR_FILES="adapter-common.sh gate-3.sh gate-4.sh gate-7.sh gate-8.sh gate-9.sh gate-10.sh gate-12-file-hygiene.sh post-merge pre-commit pre-push sprint-gate.sh lib/now-ms.sh lib/typecheck.sh lib/validate-code-walkthrough.cjs"

in_git_repo() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1
}

index_mode() {
  git -c core.quotepath=false ls-files -s -- "$1" | sed -n '1p' | cut -d' ' -f1
}

compare_pair() {
  canonical="$1"
  mirror="$2"

  [ -f "$canonical" ] || fail "missing canonical file: $canonical"
  [ -f "$mirror" ] || fail "missing mirror file: $mirror"
  cmp -s "$canonical" "$mirror" || fail "$mirror differs from canonical $canonical"

  if in_git_repo; then
    canonical_mode=$(index_mode "$canonical")
    mirror_mode=$(index_mode "$mirror")
    [ -n "$canonical_mode" ] || fail "canonical file is not tracked: $canonical"
    [ -n "$mirror_mode" ] || fail "mirror file is not tracked: $mirror"
    [ "$canonical_mode" = "$mirror_mode" ] || fail "mode mismatch: $canonical ($canonical_mode) vs $mirror ($mirror_mode)"
  fi
}

expected_hook_mirrors=$(printf '%s\n' $HOOK_MIRROR_FILES | LC_ALL=C sort)
actual_hook_mirrors=$([ -d src/npm-package/hooks ] && find src/npm-package/hooks -type f | sed 's|^src/npm-package/hooks/||' | LC_ALL=C sort || true)
[ "$expected_hook_mirrors" = "$actual_hook_mirrors" ] || fail "hook mirror file set drifted (expected exactly: $(printf '%s' "$HOOK_MIRROR_FILES" | tr '\n' ' '))"

for rel in $HOOK_MIRROR_FILES; do
  compare_pair "githooks/$rel" "src/npm-package/hooks/$rel"
done

[ -d githooks/adapters ] || fail "missing canonical adapters directory: githooks/adapters"
[ -d src/npm-package/adapters ] || fail "missing mirror adapters directory: src/npm-package/adapters"

tree_diff=$(diff -rq githooks/adapters src/npm-package/adapters 2>&1 || true)
[ -z "$tree_diff" ] || fail "adapter mirror tree drift:
$tree_diff"

if in_git_repo; then
  canonical_modes=$(git -c core.quotepath=false ls-files -s -- githooks/adapters | sed 's|^\([0-9][0-9]*\) [0-9a-f]* [0-9]*\t|MODE \1 |; s|githooks/adapters/|adapters/|' | LC_ALL=C sort)
  mirror_modes=$(git -c core.quotepath=false ls-files -s -- src/npm-package/adapters | sed 's|^\([0-9][0-9]*\) [0-9a-f]* [0-9]*\t|MODE \1 |; s|src/npm-package/adapters/|adapters/|' | LC_ALL=C sort)
  [ "$canonical_modes" = "$mirror_modes" ] || fail "adapter mirror mode drift:
$(diff <(printf '%s\n' "$canonical_modes") <(printf '%s\n' "$mirror_modes") | sed -n '2,12p')"
fi

printf '%s\n' "PASS: canonical githooks and npm package mirrors are byte- and mode-identical"
