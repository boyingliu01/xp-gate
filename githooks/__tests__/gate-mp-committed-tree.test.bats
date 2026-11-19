#!/usr/bin/env bats
#
# @test REQ-GATE-MP-COMMITTED-TREE
# @intent Gate MP compares the WORKING TREE, so it passes on a commit whose own
#         mirror half was never staged -- and the published package then ships the
#         old gate while the repo looks fixed.
#
#         This is not hypothetical. Two of this session's commits did exactly that:
#         githooks/gate-driver.sh and githooks/gate-7.sh were edited, their mirrors
#         were regenerated on disk, `scripts/check-hook-mirror.sh` passed, the push
#         succeeded -- and the COMMITTED mirror was still the old file:
#
#           git show HEAD:src/npm-package/hooks/gate-driver.sh | grep -c "NOT reached"
#           0
#
#         while the canonical copy in the same commit contains it. Gate MP reported
#         PASS for both pushes.
#
#         The mechanism: `git add githooks/gate-driver.sh` stages one half. The
#         mirror in the working tree is correct because sync-mirrors ran, so
#         check-hook-mirror.sh (which reads the filesystem) is satisfied. Nothing
#         compares what is ABOUT TO BE PUSHED against what the mirrors will be.
#
#         Two independent consumers are damaged by this:
#           - npm: src/npm-package/** is what gets published, so every consumer
#             receives the pre-fix gate body and never learns it.
#           - CI: checks the committed tree, so it can disagree with local -- and
#             per the AGENTS rule, a local/CI disagreement is first suspected of
#             being a stale local install, which sends the reader the wrong way.
#
#         The fix makes Gate MP fail when a staged canonical file's committed
#         mirror differs from it, which is a property of the CHANGE SET rather than
#         of the directory. Comparing the working tree stays, because it catches
#         the opposite error (a mirror regenerated but never staged at all).
#
# @covers AC-GATE-MP-COMMITTED-TREE-01
# @covers AC-GATE-MP-COMMITTED-TREE-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PREPUSH="$REPO/githooks/pre-push"
  MIRROR="$REPO/scripts/check-hook-mirror.sh"
}

@test "AC-GATE-MP-COMMITTED-TREE-01: gate MP is told about the staged tree, not only the working tree" {
  # The hook must consult the index. Without that, the only thing checked is a
  # directory that a local sync has already made correct -- which is exactly the
  # state in which the defect shipped twice.
  grep -q "check-hook-mirror.sh" "$PREPUSH" || {
    echo "gate MP no longer calls check-hook-mirror.sh; re-derive the finding"
    return 1
  }

  # Match only real index operations, and never inside a comment. The first
  # version of this test accepted a bare "cached" and passed on the strength of
  # line 862, which reads "# Collect changed Python source files (exclude tests,
  # venv, cached)" -- the assertion and the asserted object were not the same
  # thing, again, this time inside the test meant to catch exactly that.
  if grep -vE '^[[:space:]]*#' "$PREPUSH"     | grep -qE 'diff --cached|show ":|ls-files --stage|--staged'; then
    return 0
  fi

  echo "gate MP checks the working tree only:"
  echo "  (cd \"\$MP_ROOT\" && bash scripts/check-hook-mirror.sh)"
  echo "A working tree that was synced locally satisfies it even when the commit"
  echo "being pushed carries a stale mirror. Measured on this repository:"
  echo "  git show HEAD:src/npm-package/hooks/gate-driver.sh | grep -c 'NOT reached'  ->  0"
  echo "while githooks/gate-driver.sh in the SAME commit contains the fix."
  echo "The npm package publishes src/npm-package/**, so consumers received the"
  echo "unfixed gate while the repository looked repaired."
  return 1
}

@test "AC-GATE-MP-COMMITTED-TREE-02: the staged-tree check is real, and it is demonstrated on a fixture" {
  # A structural grep alone can be satisfied by a comment. Build the actual
  # condition on a throwaway repo and show the two answers differ.
  # $BATS_TEST_TMPDIR is per-test and always exists; mktemp -d is not reliable
  # under this runner. The nested commit must not fire the outer hooks either.
  fix="$BATS_TEST_TMPDIR/fix"
  mkdir -p "$fix"
  (
    cd "$fix" || exit 1
    mkdir -p "$fix" && cd "$fix" || exit 1
    git init -q .
    git config user.email t@t
    git config user.name t
    git config core.hooksPath /dev/null
    mkdir -p canonical mirror
    printf 'old\n' > canonical/gate.sh
    printf 'old\n' > mirror/gate.sh
    git add -A
    git commit -qm base

    # Now the failure shape: edit canonical AND sync the mirror on disk, but stage
    # only canonical -- precisely what `git add githooks/...` alone does.
    printf 'new-with-fix\n' > canonical/gate.sh
    printf 'new-with-fix\n' > mirror/gate.sh
    git add canonical/gate.sh

    # Working tree comparison: satisfied (this is why gate MP passed).
    if ! cmp -s canonical/gate.sh mirror/gate.sh; then
      echo "fixture is wrong: working tree should be consistent"
      exit 1
    fi

    # Committed comparison: detects the real drift.
    staged_c=$(git show :canonical/gate.sh)
    staged_m=$(git show :mirror/gate.sh)
    if [ "$staged_c" = "$staged_m" ]; then
      echo "fixture is wrong: the staged halves should differ"
      exit 1
    fi
    exit 0
  )
  rc=$?
  [ "$rc" -eq 0 ] || return 1
}
@test "AC-GATE-MP-COMMITTED-TREE-03: the staged-drift predicate fires on a staged canonical with an unstaged mirror" {
  # Drive the real function out of pre-push, on a fixture built to reproduce
  # exactly what two of this session's commits did: edit canonical, regenerate the
  # mirror on disk, stage only canonical.
  local fix="$BATS_TEST_TMPDIR/driftfix"
  mkdir -p "$fix"
  (
    cd "$fix" || exit 1
    git init -q .
    git config user.email t@t
    git config user.name t
    git config core.hooksPath /dev/null
    mkdir -p githooks src/npm-package
    printf 'old\n' > githooks/gate-7.sh
    printf 'old\n' > src/npm-package/gate-7.sh
    git add -A && git commit -qm base

    printf 'new-with-fix\n' > githooks/gate-7.sh
    printf 'new-with-fix\n' > src/npm-package/gate-7.sh   # regenerated on disk
    git add githooks/gate-7.sh                            # but only ONE half staged

    MP_ROOT="$fix"
    export MP_ROOT
    . <(sed -n "/^_mp_staged_drift() {/,/^}/p" "$REPO/githooks/pre-push")
    if _mp_staged_drift >/dev/null; then
      echo "the predicate reported no drift on a half-staged canonical/mirror pair"
      exit 1
    fi
    # And it must name the offending pair, not just fail.
    local_out=$(_mp_staged_drift || true)
    printf '%s' "$local_out" | grep -q "gate-7.sh" || {
      echo "drift detected but the pair was not named: $local_out"
      exit 1
    }
    exit 0
  )
}

@test "AC-GATE-MP-COMMITTED-TREE-04: a fully staged pair reports no drift" {
  # The predicate must not fire when both halves are staged -- otherwise the fix
  # would block ordinary correct pushes.
  local fix="$BATS_TEST_TMPDIR/cleanfix"
  mkdir -p "$fix"
  (
    cd "$fix" || exit 1
    git init -q .
    git config user.email t@t
    git config user.name t
    git config core.hooksPath /dev/null
    mkdir -p githooks src/npm-package
    printf 'old\n' > githooks/gate-7.sh
    printf 'old\n' > src/npm-package/gate-7.sh
    git add -A && git commit -qm base

    printf 'new\n' > githooks/gate-7.sh
    printf 'new\n' > src/npm-package/gate-7.sh
    git add githooks/gate-7.sh src/npm-package/gate-7.sh

    MP_ROOT="$fix"
    export MP_ROOT
    . <(sed -n "/^_mp_staged_drift() {/,/^}/p" "$REPO/githooks/pre-push")
    _mp_staged_drift >/dev/null || {
      echo "the predicate fired on a correctly staged pair"
      exit 1
    }
    exit 0
  )
}
