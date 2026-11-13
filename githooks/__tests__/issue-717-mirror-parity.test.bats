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
_assert_mirror() {
  local canonical="$REPO_ROOT/$1" mirror="$REPO_ROOT/$2"
  [ -f "$canonical" ] || { echo "MISSING canonical: $1"; return 1; }
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

@test "#717 AC-717-17: gate-3.sh has all FIVE copies in sync" {
  local base="githooks/adapters/gate-3.sh"
  for m in "githooks/gate-3.sh" \
           "src/npm-package/adapters/gate-3.sh" \
           "src/npm-package/gate-3.sh" \
           "src/npm-package/hooks/gate-3.sh"; do
    run _assert_mirror "$base" "$m"
    [ "$status" -eq 0 ]
  done
}

@test "#717 AC-717-17: gate-4.sh has all FIVE copies in sync" {
  local base="githooks/adapters/gate-4.sh"
  for m in "githooks/gate-4.sh" \
           "src/npm-package/adapters/gate-4.sh" \
           "src/npm-package/gate-4.sh" \
           "src/npm-package/hooks/gate-4.sh"; do
    run _assert_mirror "$base" "$m"
    [ "$status" -eq 0 ]
  done
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
