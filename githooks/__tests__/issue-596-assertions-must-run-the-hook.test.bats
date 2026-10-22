#!/usr/bin/env bats
# @test REQ-596
# @intent Two gate-behaviour suites set up a real hook installation, mock every
#         external tool, and record what the hook invokes into $NPX_LOG — then commit
#         with `git commit --no-verify`:
#
#             run git commit --no-verify -m "add files for tsc discovery"
#
#         `--no-verify` skips the hook. The hook never ran, $NPX_LOG stayed empty, and
#         every assertion about hook behaviour was unsatisfiable. Measured:
#             multilang-subdir-gate1-discovery: 1/3
#             multilang-subdir-gate5a:          0/5
#         matching CI cases 765/766/768/769/771/772.
#
#         Worse, `--no-verify` was hiding a second fixture defect: as soon as the hook
#         actually ran it died on its first lines with
#             FATAL: cannot load hook-module-resolution.sh (module resolution order is unavailable)
#         because setup never copied that file. Same family as #592/#593 — a fixture
#         that cannot get the hook past its own preamble.
#
#         `--no-verify` is a process violation for humans
#         (githooks/QUALITY-GATES-CODES-OF-CONDUCT.md) and it is no better in a test:
#         it turns "the gate ran and passed" into "the gate did not run". After the
#         fix: gate5a 0/5 -> 5/5, gate1 1/3 -> 3/3.
#
#         Pin: a case that asserts on hook output must let the hook run.
# @covers AC-596-01, AC-596-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  G1="$REPO_ROOT/githooks/__tests__/multilang-subdir-gate1-discovery.test.bats"
  G5A="$REPO_ROOT/githooks/__tests__/multilang-subdir-gate5a.test.bats"
}

@test "AC-596-01: adopted assertion commits do not use --no-verify" {
  local f
  for f in "$G1" "$G5A"; do
    [ -f "$f" ] || {
      echo "$f is gone -- this test's subject no longer exists"
      return 1
    }
  done

  # Match only `run git commit ... --no-verify` (the ASSERTED commits). The
  # fixtures' initial scaffold commit is allowed to use it: it publishes the
  # fixture's own baseline before the behaviour under test is staged, and no
  # assertion depends on it.
  run bash -c "
    for f in '$G1' '$G5A'; do
      sed 's/#.*//' \"\$f\" | grep -nE 'run git commit .*--no-verify' | sed \"s|^|\$f:|\"
    done
  "
  [ -z "$output" ] || {
    echo "assertion commits still bypass the hook with --no-verify:"
    echo "$output"
    echo "The hook never runs, so the case asserts nothing about it."
    return 1
  }
}

@test "AC-596-02: the hook fixtures ship the module-resolution helper" {
  local f
  for f in "$G1" "$G5A"; do
    # The hook cannot start without this file; its absence is fatal, not a skip.
    bash -c "sed 's/#.*//' '$f' | grep -qE 'cp .*hook-module-resolution\.sh'" || {
      echo "$f does not copy hook-module-resolution.sh"
      echo "The hook dies with 'FATAL: cannot load hook-module-resolution.sh'"
      echo "before any gate runs."
      return 1
    }
  done

  # And the premise is real: the hook still refuses to run without it.
  grep -q 'hook-module-resolution.sh' "$REPO_ROOT/githooks/pre-commit" || {
    echo "pre-commit no longer loads hook-module-resolution.sh; re-read this test"
    return 1
  }
}
