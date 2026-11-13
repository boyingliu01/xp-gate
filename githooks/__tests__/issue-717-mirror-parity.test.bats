#!/usr/bin/env bats

# #717 AC-717-17: mirror parity for EVERY file this sprint touches, not just
# the three the first version checked.
#
# R1 round 8 (FC-C1) caught that AC-717-05/06/08 covered gate-3.sh, gate-4.sh
# and csharp.sh, while §9.1 lists pre-commit, lib/test-failure.sh and
# adapter-common.sh as equally core changes. Those three are the ones whose
# drift would be WORST: pre-commit carries the .cs routing and the Gate 1 rc=2
# branch, test-failure.sh carries the dotnet classifier, adapter-common.sh
# carries the detection arms. If the npm copy lagged, a user installing from
# npm would get C# detection without the gate wiring -- half support, silently.
#
# The pairs below are read from the repo layout, then asserted byte-identical.

setup() {
  REPO_ROOT="$BATS_TEST_DIRNAME/../.."
}

# Assert a canonical file and its npm mirror are byte-identical, and say which
# file diverged rather than just "not equal".
#
# Not every mirror EXISTS in a checkout. `src/npm-package/adapters/` is a
# gitignored GENERATED tree (.gitignore 36): the packaging sync creates it, so it
# is present on a developer machine and absent from CI. Asserting byte-identity
# against a path that is not in the repository can only be a local-only check
# that fails the moment anyone else runs it -- and it did, on CI, for
# `src/npm-package/adapters/csharp.sh`.
#
# The classifier is `git check-ignore`, deliberately NOT `git ls-files`:
#   - check-ignore reads the .gitignore RULES, so its answer is the same in every
#     checkout of this commit. ls-files reads the INDEX, so a missing file is
#     also "untracked", which makes the skip swallow a genuinely deleted mirror.
#     Measured: with ls-files, deleting a tracked mirror still passed (ok 5),
#     because the absent file and a build artefact were indistinguishable.
#   - It is not a hand-maintained path list either. The first attempt at this fix
#     hardcoded directory prefixes and misclassified githooks/adapters, which is
#     NOT ignored.
#
# An ignored path is a build artefact: reported, compared when present, and
# skipped when absent. A NON-ignored path is part of the repository: it must
# exist and match, or this fails.
_assert_mirror() {
  local canonical="$REPO_ROOT/$1" mirror="$REPO_ROOT/$2"
  [ -f "$canonical" ] || { echo "MISSING canonical: $1"; return 1; }
  if git -C "$REPO_ROOT" check-ignore -q -- "$2"; then
    if [ -f "$mirror" ]; then
      # Present but generated: still assert it matches, so a stale local
      # artefact cannot masquerade as a good sync.
      cmp -s "$canonical" "$mirror" || {
        echo "GENERATED mirror differs: $2 (rerun the package sync --fix)"
        return 1
      }
      echo "SKIP (generated build artefact, present and identical): $2"
    else
      echo "SKIP (generated build artefact, not in checkout): $2"
    fi
    return 0
  fi
  [ -f "$mirror" ] || { echo "MISSING mirror: $2"; return 1; }
  if ! diff -q "$canonical" "$mirror" >/dev/null; then
    echo "DRIFT: $1 != $2"
    diff "$canonical" "$mirror" | sed -n '1,10p'
    return 1
  fi
}

@test "#717 AC-717-17: pre-commit mirror is byte-identical" {
  run _assert_mirror "githooks/pre-commit" "src/npm-package/hooks/pre-commit"
  [ "$status" -eq 0 ]
}

@test "#717 AC-717-17: lib/test-failure.sh mirror is byte-identical" {
  run _assert_mirror "githooks/lib/test-failure.sh" "src/npm-package/hooks/lib/test-failure.sh"
  [ "$status" -eq 0 ]
}

@test "#717 AC-717-17: adapter-common.sh has BOTH npm mirrors in sync" {
  run _assert_mirror "githooks/adapter-common.sh" "src/npm-package/adapter-common.sh"
  [ "$status" -eq 0 ]
  run _assert_mirror "githooks/adapter-common.sh" "src/npm-package/hooks/adapter-common.sh"
  [ "$status" -eq 0 ]
}

@test "#717 AC-717-17: csharp.sh mirror is byte-identical" {
  run _assert_mirror "githooks/adapters/csharp.sh" "src/npm-package/adapters/csharp.sh"
  [ "$status" -eq 0 ]
}

# Compare every copy of a gate script, naming WHICH copy diverged.
#
# `run _assert_mirror ...` + `[ "$status" -eq 0 ]` in a loop tells the reader
# nothing but "one of these four". The helper already explains the real cause on
# stdout; surface it instead of discarding it.
_assert_all_copies() {
  local base="$1"; shift
  local m out
  for m in "$@"; do
    if ! out=$(_assert_mirror "$base" "$m" 2>&1); then
      echo "copy out of sync: $m"
      echo "$out"
      return 1
    fi
    [ -n "$out" ] && echo "$out"
  done
  return 0
}

@test "#717 AC-717-17: gate-3.sh has all FIVE copies in sync" {
  run _assert_all_copies "githooks/adapters/gate-3.sh" \
    "githooks/gate-3.sh" \
    "src/npm-package/adapters/gate-3.sh" \
    "src/npm-package/gate-3.sh" \
    "src/npm-package/hooks/gate-3.sh"
  [ "$status" -eq 0 ] || { echo "$output"; return 1; }
}

@test "#717 AC-717-17: gate-4.sh has all FIVE copies in sync" {
  run _assert_all_copies "githooks/adapters/gate-4.sh" \
    "githooks/gate-4.sh" \
    "src/npm-package/adapters/gate-4.sh" \
    "src/npm-package/gate-4.sh" \
    "src/npm-package/hooks/gate-4.sh"
  [ "$status" -eq 0 ] || { echo "$output"; return 1; }
}

@test "#717 AC-717-17: the dotnet classifier reaches the npm copy too" {
  # Drift here would ship a package where Gate 5 blocks every commit on the
  # testhost fault -- the exact regression AC-717-09 prevents in the repo.
  run grep -F "Win32Exception" "$REPO_ROOT/src/npm-package/hooks/lib/test-failure.sh"
  [ "$status" -eq 0 ]
}

@test "#717 AC-717-17: the .cs routing reaches the npm copy too" {
  # #798: these two markers moved with their gate bodies, so read the mirror's
  # entry files -- the thing that actually ships and executes.
  run grep -F '_detect_ext_lang "cs"' "$REPO_ROOT/src/npm-package/hooks/gate-entries/gate-0-entry.sh"
  [ "$status" -eq 0 ]
  run grep -F "could not execute — NOT a pass" "$REPO_ROOT/src/npm-package/hooks/gate-entries/gate-1-entry.sh"
  [ "$status" -eq 0 ]
}
