#!/usr/bin/env bats
# @test REQ-G13-GATE-COPY-IN-SYNC
#
# @intent Gate 13 loads its implementation from a path resolved at run time:
#
#     _g13_script="$GATE_DIR/gate-13-compiler-strictness.sh"
#
# $GATE_DIR is the directory holding adapter-common.sh -- `githooks/` for a project
# install, `~/.config/xp-gate/adapters` for a global one. The same gate therefore
# exists at TWO paths, and src/npm-package/scripts/sync-package-content.js states the
# contract explicitly:
#
#   "githooks/adapters/ carries a handful of the same gate scripts ... #532 requires
#    the gate-9 verdict block to stay byte-identical across those copies. Four of them
#    had silently lagged the canonical gates."
#
# Canonical is `githooks/<f>`; `githooks/adapters/<f>` is the copy that must match it.
#
# MEASURED 2026-11-20 on this repository, committing a Go fixture:
#
#     gate-13-entry.sh: line 796: gate13_run_declared_checks: command not found
#     Gate 13 (PASS) completed in 0s
#
# Commit 0ace5365 "adapters declare their compile-time checker" added
# gate13_run_declared_checks() to the adapters/ copy and NOT to the canonical one, so
# the two diverged: 1770 lines against 1458. A project install resolves $GATE_DIR to
# githooks/ and loaded the copy WITHOUT the arm; CI and global installs resolve the
# adapters copy and loaded it WITH. Every adapter-declared compile-time check (go vet,
# cargo check, dart analyze, ...) was silently absent locally while the gate reported
# PASS -- and the local run was the looser one.
#
# The fix is to restore the #532 invariant, not to reorder the resolution: the
# canonical copy was brought up to the newer content, and the two are byte-identical
# again. Applied later, the same commit prints:
#
#     -> declared compile-time checker: go vet ./...
#     OK Declared compile-time check passed (go vet ./...)

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ENTRY="$REPO_ROOT/githooks/gate-entries/gate-13-entry.sh"
  CANONICAL="$REPO_ROOT/githooks/gate-13-compiler-strictness.sh"
  ADAPTERS_COPY="$REPO_ROOT/githooks/adapters/gate-13-compiler-strictness.sh"
}

# @covers the arm exists in the file the entry actually loads
@test "the canonical gate copy defines gate13_run_declared_checks" {
  [ -f "$CANONICAL" ]
  run grep -c '^gate13_run_declared_checks()' "$CANONICAL"
  [ "$output" = "1" ]
}

# @covers the #532 invariant that the two copies are the same program
@test "the canonical and adapters copies are byte-identical" {
  [ -f "$CANONICAL" ]
  [ -f "$ADAPTERS_COPY" ]

  local a b
  a=$(cksum "$CANONICAL" | awk '{print $1 ":" $2}')
  b=$(cksum "$ADAPTERS_COPY" | awk '{print $1 ":" $2}')
  if [ "$a" != "$b" ]; then
    echo "gate-13 copies have diverged:"
    echo "  canonical     $(wc -l < "$CANONICAL") lines"
    echo "  adapters copy $(wc -l < "$ADAPTERS_COPY") lines"
    echo "  Only-changed lines (canonical vs adapters):"
    diff "$CANONICAL" "$ADAPTERS_COPY" | head -20
    echo
    echo "Restore the invariant: bring the two to the same content in one commit."
    return 1
  fi
}

# @covers the general rule, not this one file
@test "every gate script present in both locations is byte-identical" {
  local drifted="" f base
  for f in "$REPO_ROOT"/githooks/adapters/gate-*.sh; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    [ -f "$REPO_ROOT/githooks/$base" ] || continue
    if ! cmp -s "$f" "$REPO_ROOT/githooks/$base"; then
      drifted="$drifted $base"
    fi
  done
  if [ -n "$drifted" ]; then
    echo "gate scripts whose two copies have diverged:$drifted"
    return 1
  fi
}

# @covers end to end: a project install resolves a file that can answer
@test "a project install resolves gate-13 to a copy that defines the arm" {
  run bash -c '
    GATE_DIR="'"$REPO_ROOT"'/githooks"
    _g13_script="$GATE_DIR/gate-13-compiler-strictness.sh"
    [ -f "$_g13_script" ] || _g13_script="'"$REPO_ROOT"'/githooks/gate-13-compiler-strictness.sh"
    [ -f "$_g13_script" ] || exit 1
    . "$_g13_script" >/dev/null 2>&1
    type gate13_run_declared_checks >/dev/null 2>&1 || {
      echo "resolved $_g13_script but it lacks the arm"; exit 1; }
    echo "ok: $_g13_script"
  '
  [ "$status" -eq 0 ]
  echo "$output" | grep -q 'githooks/gate-13-compiler-strictness.sh'
}

# @covers the entry keeps the simple resolution the rest of the gates use
@test "the entry resolves the canonical copy the same way the other gates do" {
  # `.` rather than `source` is what this entry uses; the point is that it loads
  # $GATE_DIR/<name>.sh with no reordering or adapters/ preference, matching
  # gate-7/gate-8/gate-10/gate-12.
  run grep -c '^    _g13_script="\$GATE_DIR/gate-13-compiler-strictness.sh"$' "$ENTRY"
  [ "$output" = "1" ]
}
