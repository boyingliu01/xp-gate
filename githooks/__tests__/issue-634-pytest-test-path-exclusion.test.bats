#!/usr/bin/env bats
# @test REQ-634
# @intent Gate 3 (cyclomatic complexity) excluded test files by SUFFIX naming
#         only — `_test.{py,go}`, `*.test.*`, `*Test(s).java`. It did not know
#         pytest's DEFAULT convention `tests/test_<name>.py` (a leading `test_`
#         prefix under a tests/ root), so a pytest-laid-out project had every
#         test module graded as production source. Test-helper complexity then
#         counted as source debt, and the ratchet could BLOCK on files the
#         baseline deliberately never records (bucket === 'test').
#
#         The exclusion lives in TWO places that must agree or the gate and the
#         baseline writer drift — the exact failure class #495 Round 3 named:
#           * githooks/gate-3.sh          (what blocks a commit)
#           * scripts/ccn-report.cjs      (what --write-baseline records)
#         These tests pin both, with anti-vacuity: real source must SURVIVE the
#         filter, and look-alikes (latest/, contest/, attest/, my_test_dir/) must
#         not be swept up by an over-eager pattern.

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
GATE3="$REPO_ROOT/githooks/gate-3.sh"
CCN_REPORT="$REPO_ROOT/scripts/ccn-report.cjs"

# Extract the live exclusion regex from gate-3.sh so the test follows the code
# wherever it moves; an extraction that comes back empty fails loudly.
gate3_regex() {
  # The exclusion is a single-quoted regex on the line AFTER the `grep -vE`
  # line. Locate that line number, then read the next line and pull out the
  # quoted token (a plain grep -A1 could also match the same phrase elsewhere).
  local ln
  ln=$(grep -n 'CC_FILES=$(echo "$CC_FILES" | grep -vE' "$GATE3" | head -1 | cut -d: -f1)
  [ -n "$ln" ] || return 0
  sed -n "$((ln+1))p" "$GATE3" | grep -oE "'[^']+'" | head -1 | sed "s/^.//; s/.$//"
}

# Classify one path through gate-3's filter. Echoes "excluded" or "kept".
gate3_classify() {
  local path="$1" re
  re=$(gate3_regex)
  [ -n "$re" ] || { echo "EXTRACTION-EMPTY"; return; }
  if printf '%s\n' "$path" | grep -vE "$re" | grep -q .; then
    echo "kept"
  else
    echo "excluded"
  fi
}

# Classify one path through ccn-report's TEST_PATH. Prints production/test/mirror.
ccn_classify() {
  node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    const m = src.match(/const TEST_PATH\s*=\s*(\/[\s\S]*?\/i);/);
    if (!m) { console.log("EXTRACTION-EMPTY"); process.exit(0); }
    const TEST_PATH = eval(m[1]);
    const MIRROR = /^src\/npm-package\//;
    const p = process.argv[2];
    console.log(MIRROR.test(p) ? "mirror" : (TEST_PATH.test(p) ? "test" : "production"));
  ' "$CCN_REPORT" "$1"
}

@test "gate-3 excludes pytest tests/test_*.py (the default layout)" {
  [ "$(gate3_classify tests/test_analyzer.py)" = "excluded" ]
  [ "$(gate3_classify tests/test_pipeline_refactored.py)" = "excluded" ]
  [ "$(gate3_classify tests/scripts/test_sub.py)" = "excluded" ]
  [ "$(gate3_classify test/test_top.py)" = "excluded" ]
}

@test "gate-3 still excludes the older suffix conventions" {
  [ "$(gate3_classify src/foo_test.py)" = "excluded" ]
  [ "$(gate3_classify __tests__/x.py)" = "excluded" ]
  [ "$(gate3_classify src/x.test.ts)" = "excluded" ]
  [ "$(gate3_classify src/FooTest.java)" = "excluded" ]
}

@test "anti-vacuity: real source SURVIVES the filter" {
  [ "$(gate3_classify src/analyzer/thing.py)" = "kept" ]
  [ "$(gate3_classify src/foo.py)" = "kept" ]
  # Look-alikes must not be mistaken for tests by a greedy pattern.
  [ "$(gate3_classify src/latest/foo.py)" = "kept" ]
  [ "$(gate3_classify contest/x.py)" = "kept" ]
  [ "$(gate3_classify attest/y.py)" = "kept" ]
  [ "$(gate3_classify src/my_test_dir/bar.py)" = "kept" ]
}

@test "ccn-report buckets pytest tests/test_*.py as test, not production" {
  [ "$(ccn_classify tests/test_analyzer.py)" = "test" ]
  [ "$(ccn_classify tests/test_pipeline_refactored.py)" = "test" ]
  [ "$(ccn_classify tests/scripts/test_sub.py)" = "test" ]
}

@test "ccn-report anti-vacuity: real source stays production" {
  [ "$(ccn_classify src/analyzer/thing.py)" = "production" ]
  [ "$(ccn_classify src/latest/foo.py)" = "production" ]
  [ "$(ccn_classify contest/x.py)" = "production" ]
  [ "$(ccn_classify src/my_test_dir/bar.py)" = "production" ]
}

@test "drift guard: gate-3 and ccn-report agree on the same path set" {
  # If the two copies ever disagree about a path, the baseline writer records a
  # population the gate does not grade (or vice-versa) and the ratchet reports
  # pre-existing code as new. This is the drift the code comments warn about.
  local path g c
  for path in \
    tests/test_a.py tests/scripts/test_b.py test/test_c.py \
    src/foo_test.py src/foo.py src/latest/f.py contest/x.py src/my_test_dir/bar.py; do
    g=$(gate3_classify "$path")
    c=$(ccn_classify "$path")
    if [ "$c" = "test" ]; then
      [ "$g" = "excluded" ] || { echo "DRIFT: $path gate=$g ccn=$c"; return 1; }
    else
      [ "$g" = "kept" ] || { echo "DRIFT: $path gate=$g ccn=$c"; return 1; }
    fi
  done
}
