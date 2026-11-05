#!/usr/bin/env bats
# @test REQ-683
# @intent Gate 3 must grade the CCN numbers lizard emits, and must refuse to
#         grade when there are none. The failure this pins is the worst kind for
#         a complexity gate: zero parsable rows used to produce an empty verdict,
#         every counter read 0, and the gate printed PASSED -- a tree nobody
#         measured reported as clean. `grep '^Warning cnt'` had the same shape
#         (#543): a summary row that never matched, so nothing was ever counted.
#         The assertions below are on the CONTRACT (which column, what happens
#         with no rows), not on a particular lizard version's table layout.
# @covers AC-683-01, AC-683-02, AC-683-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  RATCHET_LIB="$REPO_ROOT/githooks/lib/ccn-ratchet.sh"
  TMP_DIR="$(mktemp -d)"
  BASELINE="$TMP_DIR/.ccn-baseline.json"
  printf '%s\n' '{"src/a.ts::fnA": 5}' > "$BASELINE"
  # shellcheck source=/dev/null
  source "$RATCHET_LIB"
  CCN_WARN_THRESHOLD=5
  CCN_BLOCK_THRESHOLD=10
}

teardown() {
  rm -rf "$TMP_DIR"
}

# One lizard --csv data row. Column order is lizard's stable contract:
# NLOC,CCN,token,PARAM,length,location,file,name,signature,start,end
csv_row() {
  printf '%s\n' "$1,${2},30,1,5,fn@1-5@src/a.ts,src/a.ts,${3},${3}(),1,5"
}

@test "AC-683-01: the threshold decision comes from the CCN column, not header text" {
  # A header line must not be graded, and the number that decides the verdict
  # must be column 2. fnA is recorded at 5 in the baseline; 12 exceeds it.
  {
    printf '%s\n' 'NLOC,CCN,token,PARAM,length,location,file,name,signature,start,end'
    csv_row 10 12 fnA
  } | evaluate_ccn_ratchet "$BASELINE" > "$TMP_DIR/out.txt" 2>&1 || true

  run grep -c '^BLOCK ' "$TMP_DIR/out.txt"
  [ "$output" -eq 1 ] || {
    echo "expected exactly one BLOCK row, got: $(cat "$TMP_DIR/out.txt")"
    return 1
  }
  # A BLOCK without the measured number would be untraceable.
  run grep -q 'CCN=12' "$TMP_DIR/out.txt"
  [ "$status" -eq 0 ] || { echo "BLOCK row does not name the CCN it measured"; return 1; }
}

@test "AC-683-02: no parsable row reports 'unverified' instead of passing silently" {
  # Two shapes of "lizard told us nothing": empty input, and a header-only run.
  for fixture in 'empty' 'header-only'; do
    if [ "$fixture" = 'empty' ]; then
      input=''
    else
      input='NLOC,CCN,token,PARAM,length,location,file,name,signature,start,end'
    fi

    printf '%s\n' "$input" | evaluate_ccn_ratchet "$BASELINE" > "$TMP_DIR/v.txt" 2>&1 || true

    # The contract: the verdict says it could not measure. Silence here is what
    # let an unmeasured tree print PASSED.
    run grep -qiE 'unverified|not verified|未验证' "$TMP_DIR/v.txt"
    [ "$status" -eq 0 ] || {
      echo "[$fixture] no unverified signal; verdict was: [$(cat "$TMP_DIR/v.txt")]"
      return 1
    }
    # And it must NOT be a pass.
    run grep -qE '^✅|^PASS' "$TMP_DIR/v.txt"
    [ "$status" -ne 0 ] || { echo "[$fixture] empty input reported a pass"; return 1; }
  done
}

@test "AC-683-03: non-numeric CCN cells are neither counted nor read as zero" {
  # Header row plus a separator-ish row with no digits. If either were treated
  # as CCN 0 it would still not block, so the observable requirement is that
  # they produce NO verdict rows -- and, with only those rows present, that the
  # run is reported as unverified rather than as a clean tree.
  {
    printf '%s\n' 'NLOC,CCN,token,PARAM,length,location,file,name,signature,start,end'
    printf '%s\n' '----------,---,-----,-----,-----,--------,--------,----,-----,-----,---'
  } | evaluate_ccn_ratchet "$BASELINE" > "$TMP_DIR/n.txt" 2>&1 || true

  run grep -cE '^(BLOCK|LOWER|OK) ' "$TMP_DIR/n.txt"
  [ "$output" -eq 0 ] || {
    echo "non-numeric cells produced verdict rows: $(cat "$TMP_DIR/n.txt")"
    return 1
  }
  run grep -qiE 'unverified|not verified|未验证' "$TMP_DIR/n.txt"
  [ "$status" -eq 0 ] || {
    echo "unparseable table was not reported as unverified: [$(cat "$TMP_DIR/n.txt")]"
    return 1
  }
}
