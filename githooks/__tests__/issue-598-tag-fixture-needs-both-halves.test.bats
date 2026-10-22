#!/usr/bin/env bats
# @test REQ-598
# @intent tag-push-gate-mw.test.bats needed BOTH a non-protected branch name AND a
#         remote `main` baseline to model its own subject. It had neither, so half its
#         cases passed for the wrong reason and half failed for the wrong reason:
#
#             ok count: 3 / 7
#             not ok 3 tag on a local-only commit without evidence is still blocked
#             not ok 4 mixed push (branch ref plus published tag) without evidence is blocked
#             not ok 6 tag listed BEFORE the branch ref still gates the branch side
#             not ok 7 tag on a commit only on a NON-BASE remote branch is blocked
#
#         The fixture did `git init -b main`, and Gate MW is skipped wholesale on
#         main/master by design:
#             ℹ️  Gate MW skipped (pushing to main — pre-reviewed via branch walkthrough)
#         so those four BLOCK cases asserted on a code path the hook never entered.
#
#         Renaming the branch to a feature name fixed them but broke the other three,
#         because "already published" is decided by
#             git merge-base --is-ancestor <tag-commit> origin/main
#         and a feature-only remote has no origin/main:
#             ok count: 4 / 7
#
#         Both halves are load-bearing. The fixture now keeps a feature branch name and
#         publishes the baseline to refs/heads/main explicitly.
#
#         Pin: neither half may be removed — the pair is what makes the suite exercise
#         the real tag-push decision rather than one branch of it.
# @covers AC-598-01, AC-598-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  F="$REPO_ROOT/githooks/__tests__/tag-push-gate-mw.test.bats"
}

@test "AC-598-01: the tag-push fixture does not run on a protected branch" {
  [ -f "$F" ] || {
    echo "$F is gone -- this test's subject no longer exists"
    return 1
  }

  # Gate MW is skipped wholesale on main/master, so a fixture on those branches
  # never reaches the decision the suite is about.
  #
  # Only the `-b <name>` argument is inspected (comments stripped): the fixture
  # legitimately has a bare `git init -q --bare remote.git` too.
  local init_line
  init_line="$(sed 's/#.*//' "$F" | grep -E '^[[:space:]]*git init .*-b ' | head -n1)"
  echo "fixture branch line: $init_line"
  [ -n "$init_line" ] || {
    echo "could not find the fixture's 'git init -b <branch>' line"
    return 1
  }
  # Word-level comparison, not a substring test: `-b mainline` must not match
  # `-b main`. (Session lesson: `[[ x == *A*B* ]]` stitched strings across
  # unrelated text and silently passed.)
  local branch_name
  branch_name="$(printf '%s\n' "$init_line" | sed -E 's/.*[[:space:]]-b[[:space:]]+([^[:space:]]+).*/\1/')"
  echo "fixture branch: [$branch_name]"
  case "$branch_name" in
    main|master)
      echo "the fixture initialises a protected branch: $branch_name"
      echo "Gate MW is skipped there by design, so the BLOCK cases assert on a path"
      echo "the hook never enters."
      return 1
      ;;
  esac
  [ -n "$branch_name" ] || {
    echo "could not read a branch name out of: $init_line"
    return 1
  }

  # And the premise holds in the hook itself.
  grep -q 'Gate MW skipped (pushing to' "$REPO_ROOT/githooks/pre-push" || {
    echo "pre-push no longer skips Gate MW on main/master; re-read this test"
    return 1
  }
}

@test "AC-598-02: the tag-push fixture publishes a remote main baseline" {
  # "Already published" is decided against the PROTECTED base ref, so the
  # fixture must create origin/main even though its local branch is a feature.
  run bash -c "sed 's/#.*//' '$F' | grep -qE 'refs/heads/main'"
  [ "$status" -eq 0 ] || {
    echo "the fixture never creates a remote main ref"
    echo "Without origin/main, 'already published' can never be true and the PASS"
    echo "cases fail for a fixture reason rather than a hook reason."
    return 1
  }

  grep -q 'BASE_BRANCH="origin/main"' "$REPO_ROOT/githooks/pre-push" || {
    echo "pre-push no longer keys 'published' on origin/main; re-read this test"
    return 1
  }
}
