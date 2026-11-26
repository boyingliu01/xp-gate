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

# Is a human at the keyboard? A stale adapter mirror is repairable by regenerating,
# and the repair is complete and deterministic -- but it is still a failure, because
# "the tree was stale" is exactly what gets committed when nobody looks (see the
# adapters block below). Those two facts used to be reported identically: the run
# that DID the repair failed with the same message as a run on a broken repository,
# so the only way to learn the repair had worked was to run the check again by hand.
#
# This distinguishes them by CONSEQUENCE, not by fixing anything differently:
#   - non-interactive (CI, cron, a hook with no TTY): keep the hard failure. CI must
#     never conclude "green" from a repository that arrived dirty.
#   - interactive: the repair has already happened and the tree is now consistent,
#     so report the repair and succeed. The next reader of the working tree sees a
#     correct tree; nothing is hidden from them.
# XP_GATE_MIRROR_AUTOFIX forces either mode: 1/true/yes = interactive, 0/no = CI.
is_interactive_mirror_run() {
  case "${XP_GATE_MIRROR_AUTOFIX:-}" in
    1|true|yes) return 0 ;;
    0|false|no) return 1 ;;
    '')
      # No override: a TTY is the only trustworthy signal. `-t 0` is false in a
      # pipeline, which is the conservative answer -- CI runs piped.
      [ -t 0 ] && [ -t 1 ]
      ;;
    *)
      # An unrecognised value must not silently grant the interactive allowance.
      printf '%s\n' "NOTE: XP_GATE_MIRROR_AUTOFIX='$XP_GATE_MIRROR_AUTOFIX' is not a recognised value (use 1 or 0); treating it as non-interactive." >&2
      return 1
      ;;
  esac
}

# install.sh is repo-side tooling rather than a published hook, but Gate 12b
# (pre-commit) requires a package mirror for every githooks/* file a diff
# touches, so syncHooks() now copies it and this list must expect it (REQ-DEPLOY-001).
HOOK_MIRROR_FILES="adapter-common.sh hook-module-resolution.sh gate-driver.sh gate-entries/gate-0-entry.sh gate-entries/gate-1-entry.sh gate-entries/gate-2-entry.sh gate-entries/gate-3-entry.sh gate-entries/gate-4-entry.sh gate-entries/gate-5-entry.sh gate-entries/gate-6-entry.sh gate-entries/gate-7-entry.sh gate-entries/gate-8-entry.sh gate-entries/gate-9-entry.sh gate-entries/gate-10-entry.sh gate-entries/gate-11-entry.sh gate-entries/gate-12-entry.sh gate-entries/gate-12b-entry.sh gate-entries/gate-12c-entry.sh gate-entries/gate-13-entry.sh gate-entries/subdir-restore.sh install.sh deploy-manifest.sh gate-3.sh gate-4.sh gate-7.sh gate-8.sh gate-10.sh gate-12-file-hygiene.sh gate-13-compiler-strictness.sh gate-6-layers.sh gate-registry.sh post-merge post-commit pre-commit pre-push sprint-gate.sh lib/layer-baseline.cjs lib/coverage-total.sh lib/gate-5c-alignment.sh lib/gate-status.sh lib/toolchain-path.sh lib/native-path.sh lib/python-test-selection.sh lib/java-test-selection.sh lib/python-incremental-typecheck.sh lib/now-ms.sh lib/audit-sanitize.sh lib/jscpd-run.sh lib/sprint-gate-report.sh lib/test-failure.sh lib/assertion-quality.sh lib/typecheck.sh lib/diff-coverage.sh lib/ccn-ratchet.sh lib/docs-only.sh lib/file-classifier.sh lib/validate-code-walkthrough.cjs lib/prepush-score.py lib/Measure-PowerShellComplexity.ps1 lib/gate-12-blob-scan.awk"

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

# Content comparison: ONE `diff -rq` per tree root, reused for every pair.
#
# This used to be `cmp -s "$canonical" "$mirror"` inside compare_pair, i.e. one
# process per file pair. #798 grew HOOK_MIRROR_FILES from 24 to 57 entries, and a
# process costs a flat ~160 ms on this host no matter how small the file is.
# Measured 2026-11-15 (Windows 11 + Git Bash, load 2.0-4.9 of 8 cores), 57 pairs:
#
#   57 x `cmp -s` ......... 9094 ms
#    1 x `diff -rq` .......  242 ms      <- 37x cheaper
#   57 x bash loop ........  140 ms      (the work is free; the processes are not)
#
# Same fix, same reason, as the mode lookup above: the cost is the NUMBER OF
# PROCESSES, not the amount of work. `diff -rq` names the differing path
# ("Files a/x and b/x differ"), so the per-file message is preserved rather than
# traded away for speed.
declare -A DIFFERING_CANONICAL=()
declare -A DIFF_ROOT_LOADED=()

# Record which canonical paths differ from their mirror, for one tree root.
# Pairs are canonical "<root>/<rel>" with mirror "<mirror_root>/<rel>", so the
# diff is run over the two roots and the differing canonical side is remembered.
preload_diff_root() {
  local canonical_root="$1"
  local mirror_root="$2"
  [ -d "$canonical_root" ] || return 0
  [ -d "$mirror_root" ] || return 0
  [ -z "${DIFF_ROOT_LOADED[$canonical_root]:-}" ] || return 0
  local line
  # `diff -rq` exits 1 when things differ, which is the normal case here, so the
  # status is deliberately ignored: no output means every pair is identical.
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      "Files "*" and "*" differ")
        # "Files <canonical> and <mirror> differ"
        local left="${line#Files }"
        left="${left%% and *}"
        DIFFERING_CANONICAL["$left"]=1
        ;;
      "Only in "*)
        # "Only in <dir>: <name>" -- present on one side only. Recorded under the
        # canonical root only when the directory IS that root; a nested "Only in"
        # is left to the caller's own existence checks, which report it precisely.
        local dir="${line#Only in }"
        dir="${dir%%: *}"
        local name="${line##*: }"
        if [ "$dir" = "$canonical_root" ]; then
          DIFFERING_CANONICAL["$canonical_root/$name"]=1
        else
          DIFFERING_CANONICAL["$dir/$name"]=1
        fi
        ;;
    esac
  done < <(diff -rq "$canonical_root" "$mirror_root" 2>&1 || true)
  DIFF_ROOT_LOADED["$canonical_root"]=1
}

compare_pair() {
  canonical="$1"
  mirror="$2"

  [ -f "$canonical" ] || fail "missing canonical file: $canonical"
  [ -f "$mirror" ] || fail "missing mirror file: $mirror"
  # Fast path: a tree-wide diff already answered this pair. The slow per-file
  # `cmp` is the fallback for a pair whose root was never preloaded, so the
  # function stays correct on its own and every caller is not forced to preload.
  if [ -n "${DIFF_ROOT_LOADED[$(dirname "$canonical")]:-}" ]; then
    [ -z "${DIFFERING_CANONICAL[$canonical]:-}" ] || fail "$mirror differs from canonical $canonical"
  else
    cmp -s "$canonical" "$mirror" || fail "$mirror differs from canonical $canonical"
  fi

  if in_git_repo; then
    canonical_mode=$(index_mode "$canonical")
    mirror_mode=$(index_mode "$mirror")
    [ -n "$canonical_mode" ] || fail "canonical file is not tracked: $canonical"
    # P1-E step 2: the mirror is NOT tracked any more — generate-mirrors.cjs produces
    # it from the canonical tree at prepack, and `src/npm-package/{hooks/lib,
    # build-integrity,skills}/` are gitignored. Requiring a tracked mirror here made
    # every push fail with "mirror file is not tracked" for a tree that is
    # DELIBERATELY untracked -- the gate still assumed the old duplication.
    #
    # The check is not dropped, its question changed: what matters is not "does git
    # track a second copy" (the whole point is that it must not) but "is the mirror
    # present and byte-identical to the canonical file", which the `cmp` above
    # already answers. When a mirror IS tracked, its mode must still match, because
    # that is how the file will be checked out and executed.
    if [ -n "$mirror_mode" ]; then
      [ "$canonical_mode" = "$mirror_mode" ] || fail "mode mismatch: $canonical ($canonical_mode) vs $mirror ($mirror_mode)"
    fi
  fi
}

# shellcheck disable=SC2086  # word splitting IS the intent: one file per line
expected_hook_mirrors=$(printf '%s\n' $HOOK_MIRROR_FILES | LC_ALL=C sort)
#
# #587/#588: `-type f` also catches build artefacts that live in the tree without
# being part of it. `__pycache__` appears the moment anything imports
# prepush-score.py, and the mirror then reports "file set drifted" for a file
# nobody added -- a push-blocking failure with no fix available to the operator
# except deleting a cache directory by hand.
#
# The earlier comment claimed "VCS-ignored artefacts are filtered by their
# directory, not by name", but the code excluded only `__pycache__/*`. Every
# other ignored artefact tripped the gate. Reproduced 2026-11-26 by dropping
# `hooks/lib/stray-artifact.ts` in: the path is gitignored
# (`src/npm-package/hooks/lib/` is generated since P1-E), yet Gate MP blocked
# the push. A stale generated copy left by an earlier layout -- exactly what
# `git clean -n` would list -- silently made every push fail, and the operator's
# only clue was a 60-entry list that named nothing.
#
# Filtering by `git check-ignore` is NOT the fix: the whole `hooks/lib/` subtree
# is gitignored BY DESIGN, so that predicate would delete 24 legitimate mirrors
# from the enumeration and fail in the opposite direction. The distinction that
# matters is not "ignored or not" but "is this a file the gate is supposed to
# compare". A file the generator produces is in HOOK_MIRROR_FILES; anything
# found on disk but absent from that list is an artefact, and the set check
# exists to catch a generator that forgot an entry -- which is already covered by
# the reverse direction (a listed file missing from disk) in compare_pair below.
#
# So the enumeration only has to drop artefacts that are not part of the tree,
# which is what the ignored-directory filter does, now applied to every ignored
# directory rather than to `__pycache__` alone.
actual_hook_mirrors=$([ -d src/npm-package/hooks ] && find src/npm-package/hooks -type f \
  -not -path '*/__pycache__/*' \
  -not -name '*.orig' -not -name '*.rej' -not -name '*.bak' -not -name '*~' \
  -not -name '.DS_Store' -not -name 'Thumbs.db' \
  | sed 's|^src/npm-package/hooks/||' | LC_ALL=C sort || true)
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

# One `diff -rq` per guarded tree root, before either compare_pair loop. This is
# what removes the 68 per-file `cmp` spawns (57 hook pairs + 11 root pairs).
preload_diff_root githooks src/npm-package/hooks

for rel in $HOOK_MIRROR_FILES; do
  compare_pair "githooks/$rel" "src/npm-package/hooks/$rel"
done

[ -d githooks/adapters ] || fail "missing canonical adapters directory: githooks/adapters"

# ── Gate scripts that exist in BOTH githooks/ and githooks/adapters/ ────────────
#
# This is a different duplication from the mirror one above, and nothing was
# checking it. Some gate scripts live at `githooks/<name>.sh` (canonical, per
# sync-package-content.js) AND at `githooks/adapters/<name>.sh`, because
# `resolveGateScript()` falls back to `<adapterDir>/gate-<n>.sh` and a global
# install puts adapterDir at ~/.config/xp-gate/adapters.
#
# The two are loaded by DIFFERENT install shapes: a project install resolves
# $GATE_DIR to githooks/ and reads the canonical copy; a global install reads the
# adapters copy. So a divergence is not caught by running the gates locally -- it
# is caught by the user.
#
# Measured 2026-11-20: FIVE had silently drifted. The worst was gate-13, whose
# adapters copy gained gate13_run_declared_checks() while the canonical copy did
# not (1770 lines against 1458). A project install loaded the copy WITHOUT the arm
# and printed `gate13_run_declared_checks: command not found` followed by
# `Gate 13 (PASS)` -- every adapter-declared compile-time check (go vet, cargo
# check, dart analyze) missing, and the local run was the looser one. gate-7,
# gate-8, gate-10 and gate-12-file-hygiene had drifted the same way; gate-10 was a
# gate repaired earlier in the same session, and that repair only reached one copy.
#
# The rule is #532's: for every name present in both places, the bytes must match,
# and so must the mode -- they are the same program, delivered two ways.
_gate_dual_drift=""
for _gd_adapters in githooks/adapters/gate-*.sh githooks/adapters/sprint-gate.sh; do
  [ -f "$_gd_adapters" ] || continue
  _gd_name=$(basename "$_gd_adapters")
  _gd_canonical="githooks/$_gd_name"
  [ -f "$_gd_canonical" ] || continue
  if ! cmp -s "$_gd_canonical" "$_gd_adapters"; then
    _gate_dual_drift="$_gate_dual_drift $_gd_name"
    printf '%s\n' "FAIL: gate script has diverged between the two places it ships:" >&2
    printf '%s\n' "        githooks/$_gd_name           ($(wc -l < "$_gd_canonical") lines)" >&2
    printf '%s\n' "        githooks/adapters/$_gd_name  ($(wc -l < "$_gd_adapters") lines)" >&2
    printf '%s\n' "   A project install loads the first; a global install loads the second." >&2
    printf '%s\n' "   Bring both to the same content in ONE commit -- do not reorder the" >&2
    printf '%s\n' "   resolution, which only decides which copy is wrong." >&2
  fi
  if in_git_repo; then
    _gd_cmode=$(index_mode "$_gd_canonical")
    _gd_amode=$(index_mode "$_gd_adapters")
    if [ -n "$_gd_cmode" ] && [ -n "$_gd_amode" ] && [ "$_gd_cmode" != "$_gd_amode" ]; then
      _gate_dual_drift="$_gate_dual_drift $_gd_name(mode)"
      printf '%s\n' "FAIL: gate script mode differs between the two places it ships:" >&2
      printf '%s\n' "        githooks/$_gd_name ($_gd_cmode) vs githooks/adapters/$_gd_name ($_gd_amode)" >&2
    fi
  fi
done
unset _gd_adapters _gd_name _gd_canonical _gd_cmode _gd_amode

# ── Gate scripts that exist in only ONE of the two places ─────────────────────
#
# A name present in adapters/ but not in githooks/ (or the reverse) is not
# automatically wrong, but it means one install shape has a gate the other does
# not. Report it so the asymmetry is a decision rather than an accident.
for _gd_adapters in githooks/adapters/gate-*.sh githooks/adapters/sprint-gate.sh; do
  [ -f "$_gd_adapters" ] || continue
  _gd_name=$(basename "$_gd_adapters")
  [ -f "githooks/$_gd_name" ] || printf '%s\n' "NOTE: githooks/adapters/$_gd_name has no canonical counterpart at githooks/$_gd_name"
done
unset _gd_adapters _gd_name

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
    # Repairable: the tree was stale, and regenerating fixed it. What happens next
    # depends on who is reading the result -- see is_interactive_mirror_run().
    if is_interactive_mirror_run; then
      printf '%s\n' "REGENERATED: adapter mirror tree was stale and has been regenerated from githooks/adapters." >&2
      printf '%s\n' "  The tree is consistent again; re-run to confirm." >&2
      printf '%s\n' "  To make this a hard failure (as CI runs it), set XP_GATE_MIRROR_AUTOFIX=0." >&2
      exit 0
    fi
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
#
# These mirror githooks/<f> to src/npm-package/<f>, i.e. a DIFFERENT mirror root
# from the hooks/ pairs above, so the preloaded githooks vs src/npm-package/hooks
# diff does not describe them: a root file with drifted content shows up there
# only as "Only in githooks", which is indistinguishable from a file that has no
# root mirror at all. Each root therefore needs its own one-shot comparison.
#
# `diff -rq githooks src/npm-package` would cover them but walks the whole npm
# package tree (376 ms measured, and it reports ~117 unrelated differences), so
# only the 11 guarded pairs are compared. That is cheap enough to do with `cmp`
# as a single per-pair loop is not: 11 x 160 ms is affordable where 68 x 160 ms
# was not, and it keeps this block's behaviour identical to the old code.
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
# `-x '__tests__'` for the same reason the principles and mock-policy checks below
# already use it: the generator never copies test code (SKIP_DIRS in
# sync-package-content.js), so a mirror that included it would be the anomaly. This
# check was the only one of the three without the exclusion, which made it demand
# exactly what the generator refuses to produce -- a permanent failure for anyone
# who had ever tracked the mirror. Reproduced: P1-E untracked the tree, the
# generator regenerated it correctly, and this line was the only thing still red.
mutation_diff=$(diff -rq -x '__tests__' src/mutation src/npm-package/mutation 2>&1 || true)
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

  # `reinstall-xp-gate` is deliberately NOT shipped in the npm package: it is the
  # skill that uninstalls and reinstalls xp-gate, so a version living inside the
  # package would delete itself mid-run. It is distributed to agent skill roots
  # by its own installer and mirrored there, not here. Excluding it by name (not
  # by glob) keeps the check honest about every other skill.
  tree_diff=$(diff -rq -x '__tests__' -x 'reinstall-xp-gate' "$canonical_tree" "$mirror_tree" 2>&1 || true)
  [ -z "$tree_diff" ] || fail "mirror tree drift ($canonical_tree vs $mirror_tree):
$tree_diff
Fix: node src/npm-package/scripts/sync-package-content.js --fix"
done

printf '%s\n' "PASS: canonical githooks and npm package mirrors are byte- and mode-identical"
