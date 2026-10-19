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

# Real `lizard --csv` row shape (lizard 1.21.3, 11 columns, NO header row):
#   NLOC, CCN, token_len, param_count, location_size,
#   "name@start-end@path", "path", "name", "signature", start, end
# The signature column is quoted and CONTAINS COMMAS, so the parser must be
# quote-aware. Fixtures reproduce that exact shape rather than a shortened one:
# an earlier fixture used 7 columns, so the real 11-column input was never
# exercised and the field indices were wrong in production while the tests
# passed. The wrong answer that actually shipped was reading field 4
# (location_size — the span LENGTH) as CCN.
row() { # ccn file fn startline endline
  printf '10,%s,5,4,%s,"%s@%s-%s@%s","%s","%s","%s ( a : A , b : B )",%s,%s\n' \
    "$1" "$5" "$3" "$4" "$5" "$2" "$2" "$3" "$3" "$4" "$5"
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

@test "CCN is read from column 2, not column 5 (location_size)" {
  # Column 5 is the span LENGTH. If the ratchet reads it as CCN, a function with
  # CCN 3 and a 40-line span looks like CCN 40 and blocks against a baseline of 3.
  printf '{"src/a.ts::wide": 3}\n' > "$FIXTURE_REPO/base.json"
  out=$(row 3 src/a.ts wide 10 49 | run_eval "$FIXTURE_REPO/base.json")
  printf '%s\n' "$out" | grep -q '^OK wide'
  # ...and the converse: a genuinely over-baseline CCN must still block even
  # though its span (5) is under the block threshold.
  out=$(row 14 src/a.ts wide 10 14 | run_eval "$FIXTURE_REPO/base.json")
  printf '%s\n' "$out" | grep -q '^BLOCK wide'
}

@test "a quoted signature containing commas does not shift the columns" {
  # The real signature cell contains commas; a naive comma split breaks the row
  # and every field after it lands in the wrong variable — the name would come
  # out as a fragment of the signature and no baseline entry would ever match.
  printf '{"src/a.ts::big": 12}\n' > "$FIXTURE_REPO/base.json"
  out=$(row 13 src/a.ts big 10 40 | run_eval "$FIXTURE_REPO/base.json")
  printf '%s\n' "$out" | grep -q '^BLOCK big CCN=13 baseline=12'
}

@test "anonymous callbacks are keyed by line so siblings do not collide" {
  # A file holds many callbacks. Keying them all as file::(anonymous) kept only
  # one baseline entry, so every other callback was graded against the number of
  # a different function — unchanged code reported as a regression.
  printf '{"src/a.ts::(anonymous)@70": 3}\n' > "$FIXTURE_REPO/base.json"
  printf '10,2,5,1,10,"(anonymous)@10-20@src/a.ts","src/a.ts","(anonymous)","x",10,20\n' \
    | run_eval "$FIXTURE_REPO/base.json" > "$FIXTURE_REPO/out1"
  printf '10,3,5,1,10,"(anonymous)@70-80@src/a.ts","src/a.ts","(anonymous)","x",70,80\n' \
    | run_eval "$FIXTURE_REPO/base.json" > "$FIXTURE_REPO/out2"
  # The callback at line 10 has no entry of its own: it must NOT be compared
  # against the line-70 entry (that would print a bogus LOWER), it falls through
  # to the flat thresholds and passes at CCN 2.
  grep -q '^OK (anonymous) CCN=2 *$' "$FIXTURE_REPO/out1"
  ! grep -q 'baseline=' "$FIXTURE_REPO/out1"
  # The listed one matches its own entry exactly.
  grep -q '^OK (anonymous) CCN=3 at baseline' "$FIXTURE_REPO/out2"
}
