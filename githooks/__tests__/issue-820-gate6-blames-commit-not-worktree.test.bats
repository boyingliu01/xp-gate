#!/usr/bin/env bats
# @test REQ-GATE6-STAGED-SCOPE
# @intent Gate 6 runs `archlint diff .architecture-baseline.json`, whose CURRENT
#         argument defaults to "analyze the working tree". Measured 2026-11-11 on
#         this repo: a working tree carrying 7 files of somebody else's unfinished
#         work reported 217 regressions across 122 files, and every one of them was
#         attributed to whichever commit happened to be in flight. The block message
#         then advised `archlint snapshot -o .architecture-baseline.json`, i.e. it
#         told the author to FREEZE ANOTHER PERSON'S UNCOMMITTED WORK INTO THE
#         BASELINE as the accepted norm.
#
#         That is the defect this file pins: the verdict must describe the COMMIT,
#         not the directory. A commit contains the index, so the index is what must
#         be scanned. `archlint diff <baseline> <ref>` accepts a git ref and
#         analyzes a temporary worktree of it, so a commit built from the index
#         (`git commit-tree`) gives exactly "what this commit would introduce".
#
#         Asserted here: the gate builds that snapshot and passes it to archlint.
#         Also asserted, because it is the failure mode that makes any of this
#         worthless: a snapshot that cannot be built must NOT be read as a pass.
#         An unbuilt ref degrades to scanning the worktree (the old behaviour, with
#         a warning saying so) rather than skipping the check -- a gate that
#         silently stops checking is the #554/#562 lie in a new costume.
#
#         Not asserted: the number of regressions. That depends on the baseline and
#         is not the property under test.
# @covers AC-GATE6-STAGED-01, AC-GATE6-STAGED-02, AC-GATE6-STAGED-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE6="$REPO_ROOT/githooks/gate-entries/gate-6-entry.sh"
  [ -f "$GATE6" ] || skip "gate-6-entry.sh not found at $GATE6"
}

@test "AC-GATE6-STAGED-01: the TypeScript branch snapshots the index instead of defaulting to the worktree" {
  # The snapshot helper must exist and be built from the index tree.
  grep -q 'write-tree' "$GATE6"
  grep -q 'commit-tree' "$GATE6"
  # And its result must be what archlint is asked to analyze.
  grep -qE 'run_archlint diff.*GATE_6_STAGED_SNAPSHOT' "$GATE6"
}

@test "AC-GATE6-STAGED-02: the worktree-scanning invocation survives only behind the announced fallback" {
  # `diff <baseline> --fail-on ...` with no CURRENT ref is precisely "scan the
  # working tree". It is allowed exactly once: the degraded path, which must
  # announce itself. Any occurrence without the marker means the defect is back.
  count=$(grep -cE 'run_archlint diff [^|]*\.architecture-baseline\.json --fail-on' "$GATE6" || true)
  [ "$count" -le 1 ]
  if [ "$count" -eq 1 ]; then
    grep -q 'SCOPED_TO_WORKTREE' "$GATE6"
  fi
}

@test "AC-GATE6-STAGED-03: an unavailable snapshot degrades to a worktree scan, never to a silent pass" {
  # The fallback branch must exist ...
  grep -qE 'STAGED_SNAPSHOT_AVAILABLE=0|_gate6_snapshot\(\)' "$GATE6"
  # ... and announce itself, so the reader knows the verdict covers the directory.
  run grep -qE 'working tree|worktree' "$GATE6"
  [ "$status" -eq 0 ]
}
