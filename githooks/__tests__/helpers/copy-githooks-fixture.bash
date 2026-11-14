#!/usr/bin/env bash
# Fixture helper: copy `githooks/` into a sandbox WITHOUT the test suite itself.
#
# Why this exists
# ---------------
# Cases used to do `cp -r "$BATS_TEST_DIRNAME/.." "$sandbox/githooks"`. That walks
# the whole githooks tree, including `__tests__/`, which other cases in the same
# run are actively writing fixture files into and removing again. Copying a
# directory while another process deletes from it is a race: `cp` stats a file
# that is gone by the time it opens it and exits non-zero.
#
# Measured on run 43404316674 (BATS shard 4/4):
#   cp: cannot stat '.../githooks/__tests__/_gate8-inner-test_...BLOCKS_when_
#   gitleaks_is_missing...sh': No such file or directory
# The vanished name is a temp file from a DIFFERENT case (`gate-8.test.bats`
# creates `_gate8-inner-test_*.sh`). It is invisible when the file runs alone
# locally, and appears only under concurrent shard execution -- which is exactly
# how CI runs the suite.
#
# Copies only the adapter infrastructure the cases actually source. Anything a
# case needs beyond this should be copied explicitly at the call site, so the
# fixture stays independent of unrelated test churn.
#
# Usage:
#   source "$BATS_TEST_DIRNAME/helpers/copy-githooks-fixture.bash"
#   copy_githooks_fixture "$sandbox/githooks"

copy_githooks_fixture() {
  local dest="$1"
  local src="${BATS_TEST_DIRNAME}/.."

  [ -n "$dest" ] || {
    echo "copy_githooks_fixture: destination required" >&2
    return 2
  }

  mkdir -p "$dest" || return 1

  # The 13 language adapters + adapter plugins: the subject of every such case.
  cp -R "$src/adapters" "$dest/adapters" || return 1

  # Gate entry scripts, registry and driver: needed by cases that run the chain.
  local _d
  for _d in gate-entries; do
    [ -d "$src/$_d" ] && { cp -R "$src/$_d" "$dest/$_d" || return 1; }
  done

  # Top-level hook infrastructure, file by file. A missing optional file is not
  # an error (the tree legitimately varies), but a failed copy of one that IS
  # present must not be silently swallowed.
  local _f
  for _f in adapter-common.sh gate-driver.sh gate-registry.sh \
            deploy-manifest.sh install.sh verify.sh; do
    [ -f "$src/$_f" ] && { cp "$src/$_f" "$dest/$_f" || return 1; }
  done

  # Everything under githooks/lib (shared shell helpers).
  [ -d "$src/lib" ] && { cp -R "$src/lib" "$dest/lib" || return 1; }

  return 0
}