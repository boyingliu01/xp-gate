#!/usr/bin/env bats
# @test REQ-590
# @intent `gate-1-tsc-test-files.test.bats` used to prepare its fixture with
#
#       npm install --silent typescript vitest @types/node 2>/dev/null
#
#   That made a BATS suite depend on network access. In CI all three cases failed
#   with `npm install --silent typescript vitest @types/node 2>/dev/null' failed`.
#   It also ran three real installs per invocation in a suite that otherwise only
#   reads files.
#
#   Removing the install is not enough on its own. Measured on this machine:
#
#       with repo node_modules linked   -> "Running TypeScript static analysis (Version 5.9.3)"
#       with an EMPTY node_modules      -> "Running TypeScript static analysis (Version 7.0.2)"
#
#   The suite stays GREEN either way — it silently runs against whatever `tsc` the
#   machine happens to have (global install or npx cache). On a clean CI runner
#   nothing was installed, which is what the `npm install` was papering over. A
#   test whose verdict depends on the machine's global toolchain is not a test of
#   this repo.
#
#   The fixture now links the REPO's node_modules, so it resolves the exact
#   versions the project pins, with no network and no global-toolchain coupling.
#
#   Pin: a fixture that shells out to a build tool must get it from the repo's
#   pinned install, never from `npm install` and never from PATH.
# @covers AC-590-01, AC-590-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  F="$REPO_ROOT/githooks/__tests__/gate-1-tsc-test-files.test.bats"
}

@test "AC-590-01: the tsc fixture does not install packages over the network" {
  [ -f "$F" ] || {
    echo "$F is gone -- this test's subject no longer exists"
    return 1
  }
  # Comments stripped: the file explains the removed install in prose, and a plain
  # grep would match that explanation (the same trap that made an earlier version
  # of the #583 check pass with the step deleted).
  run bash -c "sed 's/#.*//' '$F' | grep -nE 'npm (install|ci|add)'"
  [ "$status" -ne 0 ] || {
    echo "the fixture still runs a package install:"
    echo "$output"
    echo "CI has no network access for this suite; link the repo's node_modules instead."
    return 1
  }
}

@test "AC-590-02: the fixture resolves tools from the repo's node_modules" {
  grep -q 'REPO_NODE_MODULES' "$F" || {
    echo "the fixture does not reference the repo's node_modules."
    echo "Without it, 'npx tsc' silently uses whatever the machine has globally:"
    echo "measured 5.9.3 (repo pin) vs 7.0.2 (global cache) with identical green results."
    return 1
  }
  grep -qE 'symlinkSync|ln -s' "$F" || {
    echo "the fixture does not link node_modules into place"
    return 1
  }
  # The link must be removed with unlinkSync, not rm: measured on Git Bash,
  # `rm -f <junction>` fails with "Is a directory" and leaves the link behind,
  # which then breaks the NEXT test in the file.
  grep -q 'unlinkSync' "$F" || {
    echo "teardown does not unlink the node_modules link with unlinkSync."
    echo "rm -f on a directory junction leaves it in place and corrupts later tests."
    return 1
  }
}
