#!/usr/bin/env bats
# @test REQ-582
# @intent Gate 3 is a RATCHET: `.ccn-baseline.json` records each function's
#         cyclomatic complexity and CI blocks when a function gets worse than its
#         record. A ratchet only works if the recorded numbers are true.
#
#         `src/mutation/update-baseline.ts::saveBaseline` was recorded at CCN=1
#         while the function contains three decision paths:
#
#             try { await fs.writeFile(...) }
#             catch (err) {                                   <- path 1
#               const reason = err instanceof Error ? ... : ...   <- paths 2, 3
#
#         Measured: `lizard src/mutation/update-baseline.ts` reports CCN=3, and
#         `node scripts/ccn-report.cjs --check --baseline .ccn-baseline.json`
#         blocks on it:
#
#             BLOCK src/mutation/update-baseline.ts:136 saveBaseline CCN=3
#                   baseline=1 (ratchet: worse than recorded)
#
#         The function did not get worse — the baseline was recorded from an
#         earlier body and never refreshed when the error handling was added. The
#         effect is a permanently red Gate 3 that looks like a code problem, so
#         the whole ratchet reports FAIL and every other regression hides behind
#         this one.
#
#         Pin: the recorded value for this function must match what the analyzer
#         reports, so a stale record cannot masquerade as a regression.
# @covers AC-582-01, AC-582-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  BASELINE="$REPO_ROOT/.ccn-baseline.json"
  SOURCE="$REPO_ROOT/src/mutation/update-baseline.ts"
}

# Ask lizard for a single function's CCN.
actual_ccn() {
  local func="$1"
  lizard "$SOURCE" 2>/dev/null | awk -v f="$func" '$0 ~ f "@" {print $2}'
}

recorded_ccn() {
  # #617 changed the file shape to `{ population, entries }`. Reading the top
  # level directly (as this did) yields undefined for every function and reports
  # it as "the record is empty" -- the same misread that made the real ratchet
  # call recorded functions "new code" (see scripts/ccn-report.cjs). Accept both
  # shapes so the assertion tests the record, not the reader's assumption.
  node -e "const raw=require(process.argv[1]);const b=(raw&&raw.entries)||raw;process.stdout.write(String(b['src/mutation/update-baseline.ts::' + process.argv[2]] ?? ''))" "$BASELINE" "$1"
}

@test "AC-582-01: the recorded CCN for saveBaseline matches the analyzer" {
  command -v lizard >/dev/null 2>&1 || skip "lizard not installed; this test needs the analyzer Gate 3 uses"

  local actual recorded
  actual=$(actual_ccn saveBaseline)
  recorded=$(recorded_ccn saveBaseline)
  [ -n "$actual" ] || {
    echo "lizard did not report saveBaseline -- the anchor drifted"
    return 1
  }
  [ "$actual" = "$recorded" ] || {
    echo "baseline records saveBaseline CCN=$recorded but the analyzer reports CCN=$actual"
    echo "a stale record makes the ratchet block on code that never got worse"
    return 1
  }
}

@test "AC-582-02: the whole Gate 3 ratchet passes on the COMMITTED tree" {
  command -v lizard >/dev/null 2>&1 || skip "lizard not installed"
  cd "$REPO_ROOT" || return 1

  # Run against HEAD, not the working tree. This test asserts what CI will see,
  # and CI sees the commit — not somebody's uncommitted work in progress. Measured
  # cost of not doing this: a colleague's in-progress edit to
  # githooks/lib/validate-code-walkthrough.cjs added three BLOCK lines and turned
  # this red, which reads as "the ratchet is broken" when the ratchet was doing
  # exactly its job on code that had not been committed yet.
  local work="$BATS_TEST_TMPDIR/head-tree"
  mkdir -p "$work" || return 1
  git archive HEAD | tar -x -C "$work" || {
    echo "could not materialize HEAD"
    return 1
  }

  cd "$work" || return 1
  run node "$REPO_ROOT/scripts/ccn-report.cjs" --check --baseline "$work/.ccn-baseline.json"
  [[ "$output" != *"BLOCK"* ]] || {
    echo "the complexity ratchet reports violations against HEAD:"
    echo "$output" | grep BLOCK
    return 1
  }
  [ "$status" -eq 0 ] || {
    echo "ccn-report --check exited $status on HEAD"
    return 1
  }
}
