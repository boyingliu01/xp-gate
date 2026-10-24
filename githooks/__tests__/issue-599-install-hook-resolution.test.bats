#!/usr/bin/env bats
# @test REQ-599
# @intent `githooks/install.sh` never installed `hook-module-resolution.sh`.
#
#         pre-commit aborts with
#             FATAL: cannot load hook-module-resolution.sh
#         when that file is missing — deliberately, because running without the
#         module resolution order means the hook cannot locate its own
#         dependencies. The consequence was that a FRESH install could not commit
#         at all, which is what CI's "First Commit Gates" job (a clean checkout
#         that runs install.sh and then commits) reported on every run.
#
#         The file is generated from src/npm-package/lib/hook-module-resolution.js,
#         so it is easy to leave out of the install list — and it was: the gate
#         script loop named gate-3/4/7/8/9/10 only. A generated artefact that the
#         hook hard-requires has to be installed like any other.
#
#         These cases run the REAL install.sh into a throwaway repository and
#         check what lands in .git/hooks, so they measure the installation rather
#         than the script's text.
# @covers AC-599-12
bats_require_minimum_version 1.5.0

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  INSTALL="$REPO_ROOT/githooks/install.sh"
  WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
  git init -q -b test-branch .
  git config user.email test@example.com
  git config user.name Test
  # install.sh copies from githooks/ relative to where it is invoked, and CI
  # invokes it the same way (cp -r githooks .githooks-ref && bash .githooks-ref/install.sh).
  cp -r "$REPO_ROOT/githooks" .githooks-ref
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$WORK"
}

run_install() {
  bash .githooks-ref/install.sh > "$WORK/install.log" 2>&1
  return $?
}

@test "AC-599-12: install.sh succeeds on a fresh repository" {
  run run_install
  [ "$status" -eq 0 ] || { echo "install.sh failed:"; cat "$WORK/install.log"; return 1; }
}

@test "AC-599-12: hook-module-resolution.sh is installed" {
  run_install || { cat "$WORK/install.log"; return 1; }
  [ -f .git/hooks/hook-module-resolution.sh ] || {
    echo "hook-module-resolution.sh was not installed — pre-commit will abort with FATAL"
    ls .git/hooks/
    return 1
  }
}

@test "AC-599-12: the hook entry points are installed" {
  run_install || { cat "$WORK/install.log"; return 1; }
  for h in pre-commit pre-push; do
    [ -f ".git/hooks/$h" ] || { echo "$h was not installed"; return 1; }
    [ -x ".git/hooks/$h" ] || { echo "$h is not executable"; return 1; }
  done
}

@test "AC-599-12: the hook libraries pre-commit needs are installed" {
  run_install || { cat "$WORK/install.log"; return 1; }
  # prepush-score.py lives in lib/ and is required by pre-push; the rest are the
  # libraries pre-commit resolves against its own directory.
  [ -f .git/hooks/lib/prepush-score.py ] || {
    echo "lib/prepush-score.py was not installed — pre-push cannot score its report"
    return 1
  }
  [ -f .git/hooks/lib/coverage-total.sh ] || {
    echo "lib/coverage-total.sh was not installed"
    return 1
  }
}

@test "AC-599-12: a commit in the freshly installed repository gets past the load check" {
  # The end-to-end point of the issue: after installing, a commit must not die on
  # the FATAL. The fixture is minimal, so later gates are expected to block — this
  # case asserts only that the module load check passes.
  #
  # Pin core.hooksPath to the fixture's own hooks. On a developer machine this
  # repository sets a global hooksPath pointing at an installed copy that already
  # has the file, so without this the case passed even when install.sh did not
  # install it — the assertion measured the developer's machine.
  git config core.hooksPath .git/hooks
  run_install || { cat "$WORK/install.log"; return 1; }
  echo seed > README.md
  git add README.md

  run git commit -m "seed" --allow-empty 2>&1
  [[ "$output" != *"cannot load hook-module-resolution.sh"* ]] || {
    echo "the freshly installed hook still cannot load its module resolution order"
    return 1
  }
  # And it must have got as far as running gates at all.
  [[ "$output" == *"Gate"* ]] || {
    echo "the hook never reached the gates: $output"
    return 1
  }
}
