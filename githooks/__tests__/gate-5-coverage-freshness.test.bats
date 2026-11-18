#!/usr/bin/env bats
#
# @test REQ-GATE5-COVERAGE-FRESHNESS
# @intent Gate 5 decides whether a coverage report is evidence for THIS commit,
#         and it decided with two different questions.
#
#         `#821` changed the EVIDENCE check to ask the git index:
#
#             git cat-file -e ":coverage/coverage-summary.json"
#
#         which is right -- a report is evidence for a commit when the commit
#         carries it. But the three places that actually READ the report still
#         asked the working directory (`[ -f ... ]`). Those are different
#         questions with different answers, and the gap is exactly the stale
#         leftover `#821` set out to remove:
#
#           - coverage/ is gitignored, so a freshly generated local report is
#             NEVER in the index. That is why `-f` cannot simply be replaced by
#             the index test: it would discard real local measurements.
#           - a leftover report from an earlier run is also not in the index,
#             and `-f` accepts it just the same.
#
#         Reproduced 2026-11-18: a commit staging only hook shell sources was
#         blocked with
#             BLOCKED - TypeScript coverage 1% below 78% threshold
#         because coverage/coverage-summary.json held a five-hour-old partial
#         run (574/45329 lines). The same artifact had blocked a commit on
#         2026-11-16 per the comment at the evidence check, so this recurs.
#
#         The fix keeps both properties by asking a question neither of the
#         previous ones asked: was this report produced by THIS gate run? The
#         gate already stamps GATE_5_START, so a report older than that stamp
#         describes some other run and must not be read.
#
#         These tests pin the predicate, not the gate: running gate_5_run end to
#         end would execute the whole test suite. The predicate is the entire
#         decision, so testing it directly is testing the fix.
#
# @covers AC-GATE5-FRESHNESS-01 AC-GATE5-FRESHNESS-02 AC-GATE5-FRESHNESS-03
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK/coverage"
  cd "$WORK" || return 1
  NOW_MS=$(( $(date +%s) * 1000 ))
}

# Source the gate body so the predicate under test is defined. Sourcing defines
# gate_5_run without executing it, which is all this test needs.
load_gate() {
  GATE_DIR="$REPO_ROOT/githooks"
  export GATE_DIR
  # shellcheck source=/dev/null
  . "$REPO_ROOT/githooks/gate-entries/gate-5-entry.sh"
}

# A helper that does not exist returns non-zero from the caller's perspective,
# which is indistinguishable from "correctly rejected a stale report". Without
# this guard every rejection test would pass vacuously before the fix.
require_predicate() {
  declare -F _gate5_coverage_usable >/dev/null 2>&1 || {
    echo "_gate5_coverage_usable is not defined: the freshness predicate is missing"
    return 1
  }
}

write_report() {
  printf '{"total":{"lines":{"pct":91}}}\n' > coverage/coverage-summary.json
}

age_report() {
  # $1 = seconds before now
  touch -d "@$(( $(date +%s) - $1 ))" coverage/coverage-summary.json
}

@test "AC-GATE5-FRESHNESS-01: a report older than this gate run is rejected" {
  load_gate
  require_predicate
  write_report
  age_report 18000            # five hours old, like the artifact that blocked me
  GATE_5_START="$NOW_MS"      # this gate started just now
  GATE_5_COVERAGE_EVIDENCE=false

  run _gate5_coverage_usable
  [ "$status" -ne 0 ] || {
    echo "a 5-hour-old coverage report was accepted as this run's measurement"
    return 1
  }
}

@test "AC-GATE5-FRESHNESS-02: a report written during this gate run is used" {
  # The companion the convention requires: a predicate that rejects everything
  # would pass the test above while silently disabling the coverage check.
  load_gate
  require_predicate
  write_report
  age_report 0
  GATE_5_START=$(( NOW_MS - 600000 ))   # gate started ten minutes ago
  GATE_5_COVERAGE_EVIDENCE=false

  run _gate5_coverage_usable
  [ "$status" -eq 0 ] || {
    echo "a report produced during this run was rejected, so coverage would"
    echo "never be evaluated locally"
    return 1
  }
}

@test "AC-GATE5-FRESHNESS-03: a staged report is honoured regardless of mtime" {
  # #601: a report the commit CARRIES is evidence even if the working copy is
  # old -- the user staged it deliberately. The index check stays authoritative;
  # freshness only decides the un-staged (local run) case.
  load_gate
  require_predicate
  write_report
  age_report 18000
  GATE_5_START="$NOW_MS"
  GATE_5_COVERAGE_EVIDENCE=true

  run _gate5_coverage_usable
  [ "$status" -eq 0 ] || {
    echo "a staged coverage report was ignored because of its mtime; #601 regressed"
    return 1
  }
}