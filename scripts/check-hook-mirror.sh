#!/usr/bin/env bash
set -euo pipefail

# Guards the canonical trees against mirror drift in the npm package:
#   githooks/<file>          -> src/npm-package/hooks/<file>
#   githooks/adapters/<f>    -> src/npm-package/adapters/<f>
#   githooks/<root .sh>      -> src/npm-package/<root .sh>
#   src/principles/**        -> src/npm-package/principles/**
# The last two were UNGUARDED until #507 Delphi round-1 A-MAJOR-4 -- the
# sprint hand-copied 280+ lines of java.ts into an unguarded mirror, which is
# exactly the drift this script exists to prevent.
# Byte drift and executable-bit drift both break consumers, so every pair is
# compared for content AND for the Git index mode.

fail() {
  printf '%s\n' "FAIL: $1" >&2
  exit 1
}

HOOK_MIRROR_FILES="adapter-common.sh gate-3.sh gate-4.sh gate-7.sh gate-8.sh gate-9.sh gate-10.sh gate-12-file-hygiene.sh post-merge pre-commit pre-push sprint-gate.sh lib/coverage-total.sh lib/python-test-selection.sh lib/python-incremental-typecheck.sh lib/now-ms.sh lib/audit-sanitize.sh lib/jscpd-run.sh lib/sprint-gate-report.sh lib/test-failure.sh lib/typecheck.sh lib/ccn-ratchet.sh lib/validate-code-walkthrough.cjs"

# Root-level shell copies (githooks/<f> -> src/npm-package/<f>). Same set as
# the hooks/ copies minus hook-only entry points (post-merge/pre-commit/
# pre-push live only under hooks/).
ROOT_MIRROR_FILES="adapter-common.sh gate-3.sh gate-4.sh gate-7.sh gate-8.sh gate-9.sh gate-10.sh gate-12-file-hygiene.sh sprint-gate.sh"

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

# shellcheck disable=SC2086  # word splitting IS the intent: one file per line
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

# Root-level shell copies (#507 Delphi round-1 A-MAJOR-4).
# shellcheck disable=SC2086  # word splitting IS the intent: iterate names
for rel in $ROOT_MIRROR_FILES; do
  [ -f "githooks/$rel" ] || fail "missing canonical root file: githooks/$rel"
  [ -f "src/npm-package/$rel" ] || fail "missing root mirror file: src/npm-package/$rel"
  compare_pair "githooks/$rel" "src/npm-package/$rel"
done

# Principles tree is a full mirror (#507 Delphi round-1 A-MAJOR-4) -- rules,
# adapters and their tests are shipped in the npm package. A recursive diff
# covers future files automatically; no file list to drift.
[ -d src/principles ] || fail "missing canonical principles directory: src/principles"
[ -d src/npm-package/principles ] || fail "missing mirror principles directory: src/npm-package/principles"
principles_diff=$(diff -rq src/principles src/npm-package/principles 2>&1 || true)
[ -z "$principles_diff" ] || fail "principles mirror tree drift:
$principles_diff"

# Plugin source trees (#542): plugins/<name>/src <-> src/npm-package/plugins/<name>/src.
# The r16 walkthrough TS fix was applied mirror-only in v0.27.3 and prepack's
# canonical->mirror sync silently rolled it back -- the published tarball then
# shipped two divergent implementations of delphi-config.ts inside one package.
# Any plugin with a canonical src/ must be mirrored byte-for-byte; the loop
# discovers plugins dynamically so a new plugin cannot dodge the guard.
if [ -d plugins ]; then
  for canonical_src in plugins/*/src; do
    [ -d "$canonical_src" ] || continue
    mirror_src="src/npm-package/$canonical_src"
    [ -d "$mirror_src" ] || fail "plugin mirror missing: $mirror_src (canonical: $canonical_src)"
    plugin_diff=$(diff -rq "$canonical_src" "$mirror_src" 2>&1 || true)
    [ -z "$plugin_diff" ] || fail "plugin src mirror drift ($canonical_src vs $mirror_src):
$plugin_diff"
    if in_git_repo; then
      # Strip the tree prefix so only MODE <mode> <relpath> lines are compared.
      plugin_canonical_modes=$(git -c core.quotepath=false ls-files -s -- "$canonical_src" | sed 's|^\([0-9][0-9]*\) [0-9a-f]* [0-9]*\t|MODE \1 |; s|'"$canonical_src"'/||' | LC_ALL=C sort)
      plugin_mirror_modes=$(git -c core.quotepath=false ls-files -s -- "$mirror_src" | sed 's|^\([0-9][0-9]*\) [0-9a-f]* [0-9]*\t|MODE \1 |; s|'"$mirror_src"'/||' | LC_ALL=C sort)
      [ "$plugin_canonical_modes" = "$plugin_mirror_modes" ] || fail "plugin src mirror mode drift ($canonical_src vs $mirror_src):
$(diff <(printf '%s\n' "$plugin_canonical_modes") <(printf '%s\n' "$plugin_mirror_modes") | sed -n '2,12p')"
    fi
  done
fi

printf '%s\n' "PASS: canonical githooks and npm package mirrors are byte- and mode-identical"
