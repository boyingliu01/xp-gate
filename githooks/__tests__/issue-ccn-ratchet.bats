#!/usr/bin/env bats
# @test REQ-CCNRATCHET-001
# @intent Gate 3 baseline ratchet: a function listed in .ccn-baseline.json may not
#         EXCEED its recorded CCN (strictly greater blocks); functions without an
#         entry keep the live warn/block thresholds; lowered CCN passes and hints
#         that the baseline can be refreshed. (sprint-20261018-quality REQ-D)
# @covers AC-CCNRATCHET-001..004

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  FIXTURE_REPO="$(mktemp -d)"
  export RATCHET_LIB="$REPO_ROOT/githooks/lib/ccn-ratchet.sh"
}

teardown() {
  rm -rf "$FIXTURE_REPO" 2>/dev/null || true
}

# CSV row shape from `lizard --csv`: NLOC,CCN,length,param_count,"fn@start-end@path","path",name
# (verified against lizard 1.21.3: CCN is field 2 — an earlier draft of this
# fixture put it in field 5 and the ratchet silently compared token counts.)
row() { # ccn file fn startline endline
  printf '10,%s,5,10,"%s@%s-%s@%s","%s",%s\n' "$1" "$3" "$4" "$5" "$2" "$2" "$3"
}

run_eval() { # baseline-json-file ; csv rows on stdin
  local base="$1"
  local rows
  rows=$(cat)
  printf '%s\n' "$rows" | bash -c "
    set -u
    source '$RATCHET_LIB'
    evaluate_ccn_ratchet '$base'
  "
}

@test "anti-vacuity: the ratchet lib exists with the evaluator" {
  grep -q '^evaluate_ccn_ratchet() {' "$RATCHET_LIB"
}

@test "function equal to its baseline passes" {
  printf '{"src/a.ts::big": 12}\n' > "$FIXTURE_REPO/base.json"
  out=$(row 12 src/a.ts big 10 40 | run_eval "$FIXTURE_REPO/base.json")
  printf '%s\n' "$out" | grep -q '^OK big'
}

@test "function one above its baseline is blocked" {
  printf '{"src/a.ts::big": 12}\n' > "$FIXTURE_REPO/base.json"
  out=$(row 13 src/a.ts big 10 40 | run_eval "$FIXTURE_REPO/base.json")
  printf '%s\n' "$out" | grep -q '^BLOCK big'
}

@test "function below its baseline passes and suggests refresh" {
  printf '{"src/a.ts::big": 12}\n' > "$FIXTURE_REPO/base.json"
  out=$(row 9 src/a.ts big 10 40 | run_eval "$FIXTURE_REPO/base.json")
  printf '%s\n' "$out" | grep -q '^LOWER big'
}

@test "function without a baseline entry falls back to the live threshold" {
  printf '{}\n' > "$FIXTURE_REPO/base.json"
  # ccn 13 > block threshold 10 must BLOCK even with no entry.
  out=$(row 13 src/new.ts fresh 10 40 | run_eval "$FIXTURE_REPO/base.json")
  printf '%s\n' "$out" | grep -q '^BLOCK fresh'
}

@test "missing baseline file means pure legacy behavior" {
  out=$(row 13 src/new.ts fresh 10 40 | run_eval "$FIXTURE_REPO/nonexistent.json")
  printf '%s\n' "$out" | grep -q '^BLOCK fresh'
  out=$(row 7 src/new.ts mid 10 40 | run_eval "$FIXTURE_REPO/nonexistent.json")
  printf '%s\n' "$out" | grep -q '^WARN mid'
}

@test "gate-3 wires the ratchet when .ccn-baseline.json exists" {
  grep -q 'ccn-ratchet.sh' "$REPO_ROOT/githooks/gate-3.sh"
  grep -q '.ccn-baseline.json' "$REPO_ROOT/githooks/gate-3.sh"
}
