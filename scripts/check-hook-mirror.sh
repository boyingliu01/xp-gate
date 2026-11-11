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

# install.sh is repo-side tooling rather than a published hook, but Gate 12b
# (pre-commit) requires a package mirror for every githooks/* file a diff
# touches, so syncHooks() now copies it and this list must expect it (REQ-DEPLOY-001).
HOOK_MIRROR_FILES="adapter-common.sh hook-module-resolution.sh install.sh deploy-manifest.sh gate-3.sh gate-4.sh gate-7.sh gate-8.sh gate-10.sh gate-12-file-hygiene.sh gate-13-compiler-strictness.sh gate-6-layers.sh gate-registry.sh post-merge post-commit pre-commit pre-push sprint-gate.sh lib/layer-baseline.cjs lib/coverage-total.sh lib/gate-5c-alignment.sh lib/toolchain-path.sh lib/native-path.sh lib/python-test-selection.sh lib/java-test-selection.sh lib/python-incremental-typecheck.sh lib/now-ms.sh lib/audit-sanitize.sh lib/jscpd-run.sh lib/sprint-gate-report.sh lib/test-failure.sh lib/assertion-quality.sh lib/typecheck.sh lib/diff-coverage.sh lib/ccn-ratchet.sh lib/docs-only.sh lib/validate-code-walkthrough.cjs lib/prepush-score.py lib/Measure-PowerShellComplexity.ps1"

# Root-level shell copies (githooks/<f> -> src/npm-package/<f>). Same set as
# the hooks/ copies minus hook-only entry points (post-merge/post-commit/
# pre-commit/pre-push live only under hooks/).
ROOT_MIRROR_FILES="adapter-common.sh gate-registry.sh gate-3.sh gate-4.sh gate-7.sh gate-8.sh gate-10.sh gate-12-file-hygiene.sh gate-13-compiler-strictness.sh gate-6-layers.sh sprint-gate.sh"

# Mode lookup was one `git ls-files -s -- <path>` PER FILE, and compare_pair
# calls it twice per pair. With 47 pairs that is ~94 git spawns; one spawn costs
# ~200-260 ms here, so the mode check alone dominated a ~34 s run whose real
# work is `cmp` and `diff` over a few hundred small files.
#
# One multi-path `git ls-files -s` now serves every lookup. A bash-side cache
# was tried first and was WORSE (measured 100 s+): each `$(index_mode ...)` runs
# in a subshell, so the array was rebuilt from scratch on every call. A single
# `git ls-files -s` over ~2400 tracked paths costs ~250 ms, so the modes for
# precisely the compared paths are fetched once and checked in pure bash.
_IN_REPO=""
_TAB=$(printf '\t')
declare -A MODE_BY_PATH=()
MODE_TABLE_READY=""

in_git_repo() {
  if [ -z "$_IN_REPO" ]; then
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      _IN_REPO=yes
    else
      _IN_REPO=no
    fi
  fi
  [ "$_IN_REPO" = "yes" ]
}

# Preload modes for the given paths in ONE git call. `git ls-files -s` prints
# "<mode> <sha> <stage><TAB><path>"; the path is everything after the FIRST tab
# and the mode everything before the FIRST space, so a path with spaces stays
# intact and there is no field-count assumption to get wrong.
preload_modes() {
  [ -n "$MODE_TABLE_READY" ] && return 0
  local line
  # shellcheck disable=SC2086  # word splitting IS the intent: one path per arg
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    MODE_BY_PATH["${line#*"$_TAB"}"]="${line%% *}"
  done < <(git -c core.quotepath=false ls-files -s -- "$@")
  MODE_TABLE_READY=yes
}

index_mode() {
  printf '%s' "${MODE_BY_PATH[$1]:-}"
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
# #587/#588: `-type f` also catches build artefacts that live in the tree without being
# part of it. `__pycache__` appears the moment anything imports prepush-score.py, and the
# hook mirror then reports "file set drifted" for a file nobody added — a push-blocking
# failure with no fix available to the operator except deleting a cache directory by hand.
# VCS-ignored artefacts are filtered by their directory, not by name.
actual_hook_mirrors=$([ -d src/npm-package/hooks ] && find src/npm-package/hooks -type f \
  -not -path '*/__pycache__/*' | sed 's|^src/npm-package/hooks/||' | LC_ALL=C sort || true)
[ "$expected_hook_mirrors" = "$actual_hook_mirrors" ] || fail "hook mirror file set drifted (expected exactly: $(printf '%s' "$HOOK_MIRROR_FILES" | tr '\n' ' '))"

# Every path compare_pair will ask about, in one list, fetched from the index
# once. Doing it here (before the loops) is what removes the ~94 git spawns.
if in_git_repo; then
  _mode_paths=()
  # shellcheck disable=SC2086  # word splitting IS the intent: one name per word
  for rel in $HOOK_MIRROR_FILES; do
    _mode_paths+=("githooks/$rel" "src/npm-package/hooks/$rel")
  done
  # shellcheck disable=SC2086
  for rel in $ROOT_MIRROR_FILES; do
    _mode_paths+=("githooks/$rel" "src/npm-package/$rel")
  done
  preload_modes "${_mode_paths[@]}"
fi

for rel in $HOOK_MIRROR_FILES; do
  compare_pair "githooks/$rel" "src/npm-package/hooks/$rel"
done

[ -d githooks/adapters ] || fail "missing canonical adapters directory: githooks/adapters"

# P1-E step 1: `src/npm-package/adapters/` is GENERATED and gitignored, so this
# check no longer asks "are the two committed trees equal" -- there is only one
# committed tree now. It asks whether the generator REPRODUCES the canonical tree
# byte-for-byte, which is the stronger claim: the old check could only ever confirm
# that two copies happened to agree, and both could be equally wrong.
#
# The mirror is regenerated from scratch here rather than trusted as-is. Comparing
# whatever happens to be on disk would let a stale tree pass, and a stale tree is
# precisely the failure this check exists to catch (#683: 4953 bytes of stale
# gate-3.sh; v0.27.3: a mirror-only fix rolled back at the next publish).
if [ ! -d src/npm-package/adapters ]; then
  if ! node src/npm-package/scripts/generate-mirrors.cjs --quiet >/dev/null 2>&1; then
    fail "src/npm-package/adapters is missing and generate-mirrors.cjs could not create it
  Run: node src/npm-package/scripts/generate-mirrors.cjs"
  fi
fi

tree_diff=$(diff -rq githooks/adapters src/npm-package/adapters 2>&1 || true)
if [ -n "$tree_diff" ]; then
  # Distinguish the two cases, because they need different actions. A stale mirror
  # is repaired by regenerating; a generator that cannot reproduce byte-for-byte is
  # a defect in the generator and regenerating will not help.
  regenerated=$(node src/npm-package/scripts/generate-mirrors.cjs --quiet 2>&1 >/dev/null || true)
  after_regen=$(diff -rq githooks/adapters src/npm-package/adapters 2>&1 || true)
  if [ -z "$after_regen" ]; then
    # Repairable: the tree was stale. Still a failure for CI, because a stale tree
    # is what gets committed if nobody looks.
    fail "adapter mirror tree was stale and has been regenerated:
$tree_diff
  Re-run to confirm, and check the canonical tree was not edited without regenerating."
  fi
  fail "adapter mirror tree drift -- the GENERATOR does not reproduce githooks/adapters byte-for-byte:
$after_regen
  This is a generator defect, not a stale copy: regenerating does not fix it.
  ${regenerated}"
fi

# Executable bits must match BETWEEN THE TWO TREES ON DISK. This compares the
# filesystem on both sides on purpose.
#
# The previous version compared git's recorded mode for the canonical side against
# the filesystem for the generated side, which are not the same source: this repo's
# index records `100644` for `githooks/adapters/*.sh` while the working tree has them
# executable (`-rwxr-xr-x`). The check therefore reported every adapter as drifted
# the moment the mirror became generated -- a comparison between an index record and
# a stat() call can only produce noise.
#
# Comparing the filesystems directly is also what the claim actually needs: the
# published tarball carries whatever the files on disk carry, so that is the pair
# that must agree.
if in_git_repo; then
  canonical_modes=$(cd githooks/adapters && find . -type f -print | sed 's|^\./||' | LC_ALL=C sort | while IFS= read -r rel; do
    if [ -x "./$rel" ]; then printf 'MODE 100755 %s\n' "$rel"; else printf 'MODE 100644 %s\n' "$rel"; fi
  done)
  mirror_modes=$(cd src/npm-package/adapters && find . -type f -print | sed 's|^\./||' | LC_ALL=C sort | while IFS= read -r rel; do
    if [ -x "./$rel" ]; then printf 'MODE 100755 %s\n' "$rel"; else printf 'MODE 100644 %s\n' "$rel"; fi
  done)
  [ "$canonical_modes" = "$mirror_modes" ] || fail "adapter mirror mode drift (executable bits differ between canonical and generated):
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
# __tests__ is excluded for the same reason as the mock-policy tree below:
# sync-package-content.js lists it in SKIP_DIRS, so demanding equality over tests
# would fail on a difference the sync step is designed to keep. (Reproduced: adding
# src/principles/__tests__/dip-line.test.ts made this check fail on a correct repo.)
principles_diff=$(diff -rq -x '__tests__' src/principles src/npm-package/principles 2>&1 || true)
[ -z "$principles_diff" ] || fail "principles mirror tree drift:
$principles_diff"

# Mutation module (#544 follow-up). src/npm-package/mutation/ is published
# ("mutation/" is in the package files list) and is maintained as a byte-identical
# copy of src/mutation/, but nothing checked it: after the #544 fix landed in the
# source tree the package copy still contained the zero-filling code, so the fix
# would have shipped only to this repo and not to consumers -- the same shape as
# the v0.27.3 plugin drift above.
[ -d src/mutation ] || fail "missing canonical mutation directory: src/mutation"
[ -d src/npm-package/mutation ] || fail "missing mirror mutation directory: src/npm-package/mutation"
mutation_diff=$(diff -rq src/mutation src/npm-package/mutation 2>&1 || true)
[ -z "$mutation_diff" ] || fail "mutation mirror tree drift:
$mutation_diff"

# Mock policy module. Same failure shape as #544 above, and it already happened:# the three mock-policy fixes on origin/main (9eb8fb7c, 65295439, b6938a1f) each
# edited only src/mock-policy/, so src/npm-package/mock-policy/gate-m3.ts kept the
# old lenient-layer and unreadable-file behaviour. Nothing compared the two trees,
# so the published tarball would have carried the bug the fixes exist to remove.
#
# __tests__ is excluded because sync-package-content.js lists it in SKIP_DIRS:
# it deliberately does not mirror tests, so demanding equality there would fail on
# a difference the sync step is designed to keep.
[ -d src/mock-policy ] || fail "missing canonical mock-policy directory: src/mock-policy"
[ -d src/npm-package/mock-policy ] || fail "missing mirror mock-policy directory: src/npm-package/mock-policy"
mock_policy_diff=$(diff -rq -x '__tests__' src/mock-policy src/npm-package/mock-policy 2>&1 || true)
[ -z "$mock_policy_diff" ] || fail "mock-policy mirror tree drift:
$mock_policy_diff"

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

# Sibling-mirrored scripts: scripts/<f> <-> src/npm-package/scripts/<f>.
# sync-package-content.js regenerates these at prepack time, but a mirror-only
# edit (or a canonical edit made after the last sync) survives until someone
# runs the sync — and the published tarball then carries a different script than
# the repo. `delphi-external-review.cjs` drifted by 327 lines this way and was
# only caught by Gate MP at push time, after the release commit was authored.
# The loop discovers pairs dynamically, so a newly-mirrored script cannot dodge
# the guard.
if [ -d src/npm-package/scripts ]; then
  for canonical_script in scripts/*.cjs scripts/*.js; do
    [ -f "$canonical_script" ] || continue
    mirror_script="src/npm-package/$canonical_script"
    [ -f "$mirror_script" ] || continue
    script_diff=$(diff -q "$canonical_script" "$mirror_script" 2>&1 || true)
    [ -z "$script_diff" ] || fail "script mirror drift ($canonical_script vs $mirror_script):
$script_diff
Fix: node src/npm-package/scripts/sync-package-content.js --fix"
  done
fi

# Whole-tree mirrors with no guard, discovered rather than listed.
#
# Every block above was added one incident at a time -- principles after a
# hand-copied 280-line java.ts (#507), mutation after a fix shipped only to this
# repo (#544), mock-policy after three fixes landed canonical-only, plugins after
# a mirror-only edit was silently rolled back by prepack (#542), scripts after
# delphi-external-review.cjs drifted 327 lines. Each guard closed the hole that
# had just been found; none asked which trees were still unguarded.
#
# Measured 2026-11-07: 775 files / 110,282 lines under src/npm-package/ are
# byte-identical copies with no parity coverage and no lint coverage
# (pre-commit's MIRROR_PATH_FILTER excludes the whole tree) -- 59.7% of the
# mirror. src/build-integrity and the root skills/ tree were among the gaps.
#
# The list below is explicit rather than globbed on purpose. A blanket walk over
# src/npm-package/*/ demands equality for trees the sync step deliberately does
# not ship (plugins/AGENTS.md, plugins/shared/, most of scripts/), and a guard
# that fails on a correct tree gets disabled instead of fixed. Adding a mirror
# tree therefore means adding its name here -- one line, next to the reason.
for mirror_tree in src/npm-package/build-integrity src/npm-package/skills; do
  tree_name="${mirror_tree#src/npm-package/}"
  tree_name="${tree_name#src/}"

  canonical_tree=""
  if [ -d "src/$tree_name" ]; then
    canonical_tree="src/$tree_name"
  elif [ -d "$tree_name" ]; then
    canonical_tree="$tree_name"
  fi
  [ -n "$canonical_tree" ] || continue
  [ -d "$mirror_tree" ] || continue

  tree_diff=$(diff -rq -x '__tests__' "$canonical_tree" "$mirror_tree" 2>&1 || true)
  [ -z "$tree_diff" ] || fail "mirror tree drift ($canonical_tree vs $mirror_tree):
$tree_diff
Fix: node src/npm-package/scripts/sync-package-content.js --fix"
done

printf '%s\n' "PASS: canonical githooks and npm package mirrors are byte- and mode-identical"
