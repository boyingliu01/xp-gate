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

@test "a name declared twice in one file is keyed by line, not shared" {
  # Two distinct declarations can share a name (a `walk` helper in two nested
  # scopes), and lizard also files a construct under a name merely CALLED there,
  # producing a second row for the same name. With a bare path::name key both
  # rows compared against one entry, so each was reported as a regression
  # against the other's number — and the baseline only recorded whichever the
  # parser reached last.
  #
  # Both rows must arrive in ONE invocation: the duplicate-name tally is computed
  # per file from the rows being graded, exactly as ccn-report keys a whole
  # report at once.
  printf '{"src/a.ts::walk@79": 8}\n' > "$FIXTURE_REPO/base.json"
  {
    row 8 src/a.ts walk 79 92
    row 7 src/a.ts walk 184 196
  } | run_eval "$FIXTURE_REPO/base.json" > "$FIXTURE_REPO/out"
  # The line-79 row matches its own entry.
  grep -q '^OK walk CCN=8 at baseline' "$FIXTURE_REPO/out"
  # The line-184 row has no entry of its own. It must NOT be compared against the
  # line-79 entry (no bogus BLOCK/LOWER on it); at CCN 7 it is above the warn
  # threshold (5) but under block, so it WARNs as new code.
  grep -q '^WARN walk CCN=7' "$FIXTURE_REPO/out"
  ! grep -q 'walk CCN=8 baseline=' "$FIXTURE_REPO/out"
}

@test "shell key derivation matches ccn-report's baselineKey for the same rows" {
  # baselineKey() exists twice: once in scripts/ccn-report.cjs (the writer) and
  # once in awk here (the reader). If they disagree, every recorded function is
  # graded as new code and the ratchet silently degrades to flat thresholds —
  # which is exactly the bug this sprint started from. This test derives the
  # shell key for a row by reading the "at baseline" verdict it produces against
  # a baseline containing only the key the CJS writer would emit, so a drift in
  # either implementation fails here rather than in production.
  local cjs
  cjs="$REPO_ROOT/scripts/ccn-report.cjs"
  [ -f "$cjs" ] || skip "ccn-report.cjs not present"

  # Ask the real writer what keys it derives, for the exact shapes we grade.
  local keys
  keys=$(node -e '
    const mod = require(process.argv[1]);
    // baselineKey is exported for exactly this cross-check.
    if (typeof mod.baselineKey !== "function") { process.exit(2); }
    const nameCounts = new Map([["src/a.ts::walk", 2]]);
    const cases = [
      { file: "src/a.ts", name: "walk", line: 79 },
      { file: "src/a.ts", name: "walk", line: 184 },
      { file: "src/b.ts", name: "solo", line: 12 },
      { file: "src/c.ts", name: "(anonymous)", line: 30 },
    ];
    for (const f of cases) console.log(JSON.stringify([f, mod.baselineKey(f, nameCounts)]));
  ' "$cjs") || skip "baselineKey is not exported; cross-check not available"

  # Build a baseline from the CJS-derived keys, then confirm the shell reader
  # matches each one (an "at baseline" verdict means the key resolved).
  local base="$FIXTURE_REPO/xbase.json"
  printf '%s\n' "$keys" | node -e '
    let s = "";
    process.stdin.on("data", c => s += c).on("end", () => {
      const out = {};
      for (const line of s.split("\n").filter(Boolean)) {
        const [, key] = JSON.parse(line);
        out[key] = 8;
      }
      require("fs").writeFileSync(process.argv[1], JSON.stringify(out));
    });
  ' "$base"

  # walk@79 (duplicated name -> line-suffixed key), solo (unique -> bare key),
  # and the anonymous row must all resolve against the CJS-written baseline.
  {
    row 8 src/a.ts walk 79 92
    row 8 src/a.ts walk 184 196
    row 8 src/b.ts solo 12 20
    row 8 src/c.ts '(anonymous)' 30 40
  } | run_eval "$base" > "$FIXTURE_REPO/out"
  grep -q '^OK walk CCN=8 at baseline' "$FIXTURE_REPO/out"
  grep -q '^OK solo CCN=8 at baseline' "$FIXTURE_REPO/out"
  grep -q '^OK (anonymous) CCN=8 at baseline' "$FIXTURE_REPO/out"
}

@test "local gate 3 fails closed when the verifier is unavailable, like CI" {
  # The hook used to fall through to grading raw lizard CSV when
  # scripts/ccn-report.cjs was missing, while CI hard-fails on the same
  # condition. Two gates disagreeing about identical code is worse than either
  # behaviour alone: a developer sees PASS locally and a red CI. The hook must
  # block, and it must say why.
  local gate="$REPO_ROOT/githooks/gate-3.sh"
  # The exact shape: a guard that exits 1 BEFORE the `if [ -f "$CC_REPORT" ]`
  # branch that would otherwise grade unverified numbers.
  grep -q 'verifier unavailable' "$gate"
  grep -q 'mode=ratchet verifier=MISSING' "$gate"
  # And the CI workflow must still fail on the same condition, so the two agree.
  grep -q 'ccn-report.cjs' "$REPO_ROOT/.github/workflows/quality-gates.yml"
}
