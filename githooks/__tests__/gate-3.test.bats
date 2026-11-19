#!/usr/bin/env bats

# Tests for gate-3.sh (Cyclomatic Complexity check)
# TDD: Test that gate-3.sh can be sourced standalone and sets GATE_3_STATUS

setup() {
  # These are set by pre-commit before sourcing gate-*.sh
  PROJECT_LANG="typescript"
  CHANGED_FILES="src/test.ts"
  CC_WARNINGS=0
  GATE_3_STATUS=""

  # Mock gate_start_ms (defined in pre-commit preamble, not in adapter-common.sh)
  gate_start_ms() {
    echo "0"
  }

  # Mock record_gate_audit (defined in pre-commit preamble)
  record_gate_audit() {
    :
  }
}

@test "gate-3.sh sources without error and sets GATE_3_STATUS" {
  source "$BATS_TEST_DIRNAME/../gate-3.sh"
  [ -n "$GATE_3_STATUS" ]
}

@test "gate-3.sh handles documentation-only project" {
  PROJECT_LANG="documentation-only"
  source "$BATS_TEST_DIRNAME/../gate-3.sh"
  [ "$GATE_3_STATUS" = "SKIP" ]
}

@test "gate-3.sh handles PowerShell project" {
  PROJECT_LANG="powershell"
  source "$BATS_TEST_DIRNAME/../gate-3.sh"
  [ "$GATE_3_STATUS" = "SKIP" ]
}

# ============================================================================
# #543: the default-threshold path must actually block a complex function.
#
# NOTE ON THE SUBJECT UNDER TEST: these tests load ../gate-3.sh, not
# ../adapters/gate-3.sh. The two files are different copies of "Gate 3" and only
# githooks/gate-3.sh is what pre-commit executes (via $GATE_DIR, which resolves
# to the installed adapters dir holding this same 11KB file). The copy under
# adapters/ is a shorter leftover. An earlier version of these tests pointed at
# the wrong one and so reported green against a file no commit ever runs.
#
# The old parser read a "Warning cnt" SUMMARY table with grep '^Warning cnt'.
# That string is a column header in the MIDDLE of a line ("Total nloc  Avg.NLOC
# ... Warning cnt  Fun Rt ..."), never at line start, and lizard omits the
# summary block entirely when given explicit file arguments -- which is exactly
# how the gate invokes it. So CC_WARNINGS was always 0 and every commit passed.
#
# These tests drive the real lizard binary against real over-threshold files.
# Testing the parser in isolation would have passed while the gate silently let
# everything through, which is precisely how this defect survived.
# ============================================================================

@test "#543: default threshold BLOCKS a function over the CCN threshold" {
  command -v lizard > /dev/null 2>&1 || skip "lizard not installed"

  local work="$BATS_TEST_TMPDIR/ccn543"
  mkdir -p "$work"
  cat > "$work/complex.py" <<'PY'
def very_complex(a, b, c, d):
    if a:
        if b:
            for i in range(10):
                if c:
                    while d:
                        if i > 5 and a and b:
                            return 1
                        elif i > 7 or c:
                            return 2
    elif b and c or d:
        return 3
    return 4
PY

  run bash -c "
    cd '$work' || exit 9
    PROJECT_LANG='python'
    CHANGED_FILES='complex.py'
    CC_WARNINGS=0
    GATE_3_STATUS=''
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    source '$BATS_TEST_DIRNAME/../gate-3.sh'
  "

  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED"* ]]
}

@test "#543: default threshold still PASSES a function within the CCN threshold" {
  command -v lizard > /dev/null 2>&1 || skip "lizard not installed"

  local work="$BATS_TEST_TMPDIR/ccn543-ok"
  mkdir -p "$work"
  cat > "$work/simple.py" <<'PY'
def simple(a):
    return a + 1
PY

  run bash -c "
    cd '$work' || exit 9
    PROJECT_LANG='python'
    CHANGED_FILES='simple.py'
    CC_WARNINGS=0
    GATE_3_STATUS=''
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    source '$BATS_TEST_DIRNAME/../gate-3.sh'
  "

  # The fix must not turn every commit red.
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED"* ]]
}

@test "#543: the reported count matches what lizard actually found" {
  command -v lizard > /dev/null 2>&1 || skip "lizard not installed"

  local work="$BATS_TEST_TMPDIR/ccn543-count"
  mkdir -p "$work"
  # Two over-threshold functions: the count must be 2, not merely non-zero.
  cat > "$work/two.py" <<'PY'
def alpha(a, b, c, d, e):
    if a:
        if b:
            if c:
                if d:
                    if e:
                        return 1
    return 0

def beta(a, b, c, d, e):
    if a:
        if b:
            if c:
                if d:
                    if e:
                        return 1
    return 0
PY

  run bash -c "
    cd '$work' || exit 9
    PROJECT_LANG='python'
    CHANGED_FILES='two.py'
    CC_WARNINGS=0
    GATE_3_STATUS=''
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    source '$BATS_TEST_DIRNAME/../gate-3.sh'
  "

  [ "$status" -ne 0 ]
  [[ "$output" == *"2 functions"* ]]
}

# ============================================================================
# --all feasibility and ratchet fail-closed.
#
# Under `xp-gate check . --all` the population is the whole tree. Two defects
# made that mode unusable on Windows and, worse, silently green:
#   1. every path was handed to lizard in ONE argv. A 1,000-file repo is ~60 KB
#      of paths, past the 32,767-character Windows command line, so the process
#      never started and the gate graded an empty CSV.
#   2. the ratchet library is resolved from $GATE_DIR/lib/ccn-ratchet.sh, which
#      no installer created. `.` on a missing file prints one line, leaves
#      evaluate_ccn_ratchet undefined, and every counter read 0 -> PASSED.
# ============================================================================

@test "large file lists are graded in batches, not one oversized argv" {
  command -v lizard > /dev/null 2>&1 || skip "lizard not installed"

  local work="$BATS_TEST_TMPDIR/ccn-batches"
  mkdir -p "$work"
  cat > "$work/alpha.py" <<'PY'
def simple(a):
    return a + 1
PY
  cat > "$work/beta.py" <<'PY'
def complex_one(a, b, c, d, e):
    if a:
        if b:
            if c:
                if d:
                    if e:
                        return 1
    return 0
PY

  # Budget of 10 forces one lizard process per file: the verdict must survive
  # CSV concatenation, and the per-run header rows must not be counted as data.
  run bash -c "
    cd '$work' || exit 9
    PROJECT_LANG='python'
    CHANGED_FILES='alpha.py
beta.py'
    CC_WARNINGS=0
    GATE_3_STATUS=''
    XP_GATE_LIZARD_ARGV_BUDGET=10
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    source '$BATS_TEST_DIRNAME/../gate-3.sh'
  "

  [ "$status" -ne 0 ]
  [[ "$output" == *"1 functions"* ]]
}

@test "missing ratchet library fails closed instead of reporting PASSED" {
  command -v lizard > /dev/null 2>&1 || skip "lizard not installed"
  command -v node > /dev/null 2>&1 || skip "node not installed"

  local work="$BATS_TEST_TMPDIR/ccn-missing-lib"
  mkdir -p "$work/scripts" "$work/empty-gate-dir"
  # gate-3 locates the verifier through `git rev-parse --show-toplevel`, so the
  # fixture has to be a repository root (a subdirectory of another repo would
  # resolve the verifier to that repo instead).
  git init -q "$work"
  cat > "$work/simple.py" <<'PY'
def simple(a):
    return a + 1
PY
  printf '{"simple.py::simple": 1}\n' > "$work/.ccn-baseline.json"
  # The span verifier is NOT the subject here: pass its input through so the run
  # reaches the ratchet-lib lookup with a valid CSV.
  printf 'process.stdin.pipe(process.stdout);\n' > "$work/scripts/ccn-report.cjs"

  run bash -c "
    cd '$work' || exit 9
    PROJECT_LANG='python'
    CHANGED_FILES='simple.py'
    CC_WARNINGS=0
    GATE_3_STATUS=''
    GATE_DIR='$work/empty-gate-dir'
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    source '$BATS_TEST_DIRNAME/../gate-3.sh'
  "

  [ "$status" -eq 1 ]
  [[ "$output" == *"ratchet library unavailable"* ]]
  [[ "$output" != *"PASSED"* ]]
}

# ============================================================================
# #847: Dart was missing from Gate 3's lizard population.
#
# The writer (scripts/ccn-report.cjs SOURCE_EXT) has always listed `dart`, and
# so did Gate 2 / Gate 4 / the dart.sh + flutter.sh adapters. Only the READER of
# the baseline disagreed, so Dart cyclomatic complexity was never graded while
# every other surface claimed it was.
#
# This test pins the behaviour that actually matters -- a complex .dart file is
# BLOCKED -- and not merely "the regex contains dart". A regex-level assertion
# would have passed on the broken code path, because `CC_FILES` is not the last
# filter: the population declaration in .ccn-baseline.json drops every path
# whose extension it does not declare, and `.dart` was absent from that list.
# Both halves are exercised here through a real gate run.
# ============================================================================

@test "#847: a .dart file over the CCN threshold is BLOCKED (population includes dart)" {
  command -v lizard > /dev/null 2>&1 || skip "lizard not installed"
  command -v node > /dev/null 2>&1 || skip "node not installed"

  local work="$BATS_TEST_TMPDIR/ccn847"
  mkdir -p "$work/lib" "$work/scripts"
  git init -q "$work"
  # Nested conditionals push CCN well past the default threshold of 10.
  cat > "$work/lib/complex.dart" <<'DART'
int grade(int a, int b, int c, int d) {
  if (a > 0) {
    if (b > 0) {
      for (var i = 0; i < 10; i++) {
        if (c > 0) {
          while (d > 0) {
            if (i > 5 && a > 0 && b > 0) { return 1; }
            else if (i > 7 || c > 0) { return 2; }
          }
        }
      }
    } else if (b > 0 && c > 0 || d > 0) {
      return 3;
    }
  }
  return 4;
}
DART
  # The population MUST declare .dart, or the file is filtered out before the
  # ratchet ever sees it. This is the half a regex-only fix would have missed.
  cat > "$work/.ccn-baseline.json" <<'JSON'
{
  "population": { "roots": ["lib"], "extensions": [".dart"] },
  "entries": {}
}
JSON
  # The REAL verifier and ratchet lib, not stubs. A pass-through stub for
  # ccn-report.cjs hands the population filter raw lizard CSV, whose column 1 is
  # NLOC -- which is exactly the shape that hid the column-index defect below.
  # Copies, not symlinks: gate-3 resolves the verifier from
  # `git rev-parse --show-toplevel`, and the fixture must be self-contained.
  cp "$BATS_TEST_DIRNAME/../../scripts/ccn-report.cjs" "$work/scripts/ccn-report.cjs"
  mkdir -p "$work/githooks/lib"
  cp "$BATS_TEST_DIRNAME/../lib/ccn-ratchet.sh" "$work/githooks/lib/ccn-ratchet.sh"

  run bash -c "
    cd '$work' || exit 9
    PROJECT_LANG='dart'
    CHANGED_FILES='lib/complex.dart'
    CC_WARNINGS=0
    GATE_3_STATUS=''
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    source '$BATS_TEST_DIRNAME/../gate-3.sh'
  "

  # The decisive signal is that the file is NOT dropped. Before the fix the
  # population filter read column 1 (|NLOC|, then CCN) as a path, so every row
  # was "outside the population" and the gate fell through to
  # "no parsable CCN row" -- PASSED having graded nothing.
  #
  # Deliberately NOT asserting BLOCKED: #848 (separate, open) records that
  # --csv-verified re-derives a wrong CCN for Dart, so the number that reaches
  # the ratchet is not trustworthy yet. "Graded at all" is what #847 owns.
  [[ "$output" != *"outside the baseline population"* ]]
  [[ "$output" != *"no parsable CCN row"* ]]
}

@test "#847: the population filter reads the PATH column, not the CCN column" {
  command -v lizard > /dev/null 2>&1 || skip "lizard not installed"
  command -v node > /dev/null 2>&1 || skip "node not installed"

  # One level below #847, and wider than it: the filter used
  # `awk -F, '{print $1}'`, but column 1 of a lizard --csv row is NLOC and
  # column 2 is CCN -- the path is column 7. So every "path" handed to
  # ccn_file_in_population was a bare number, no number matched a declared root
  # or extension, every row was classified "outside the population", and the
  # ratchet was disabled for EVERY language. Python has always been "supported"
  # and is used here on purpose, to prove the defect was never Dart-specific.
  # mktemp OUTSIDE the repo: $BATS_TEST_TMPDIR resolves under the xp-gate
  # worktree on this platform, so `git init` there produces a repo whose
  # `git rev-parse --show-toplevel` is EMPTY -- gate-3 then fails to find
  # scripts/ccn-report.cjs and githooks/lib/ccn-ratchet.sh and takes the
  # "verifier unavailable" branch instead of the one under test.
  local work
  work=$(mktemp -d "${XP_GATE_TEST_TMPROOT:-/c/Users/think/AppData/Local/Temp}/xpg-847col-XXXXXX")
  mkdir -p "$work/lib" "$work/scripts" "$work/githooks/lib"
  git init -q "$work"
  cat > "$work/lib/simple.py" <<'PY'
def simple(a):
    return a + 1
PY
  cat > "$work/.ccn-baseline.json" <<'JSON'
{
  "population": { "roots": ["lib"], "extensions": [".py"] },
  "entries": {}
}
JSON
  cp "$BATS_TEST_DIRNAME/../../scripts/ccn-report.cjs" "$work/scripts/ccn-report.cjs"
  cp "$BATS_TEST_DIRNAME/../lib/ccn-ratchet.sh" "$work/githooks/lib/ccn-ratchet.sh"

  run bash -c "
    cd '$work' || exit 9
    PROJECT_LANG='python'
    CHANGED_FILES='lib/simple.py'
    CC_WARNINGS=0
    GATE_3_STATUS=''
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    source '$BATS_TEST_DIRNAME/../gate-3.sh'
  "

  [[ "$output" != *"outside the baseline population"* ]]
}

@test "#847: a path genuinely outside the population is still announced" {
  command -v lizard > /dev/null 2>&1 || skip "lizard not installed"
  command -v node > /dev/null 2>&1 || skip "node not installed"

  # The column fix must not turn the filter into a no-op. An extension the
  # baseline does not declare is still excluded -- and still SAID OUT LOUD,
  # because "not checked" may never be indistinguishable from "checked clean".
  local work
  work=$(mktemp -d "${XP_GATE_TEST_TMPROOT:-/c/Users/think/AppData/Local/Temp}/xpg-847scope-XXXXXX")
  mkdir -p "$work/lib" "$work/scripts" "$work/githooks/lib"
  git init -q "$work"
  cat > "$work/lib/simple.py" <<'PY'
def simple(a):
    return a + 1
PY
  # population declares only .ts, so the .py path is out of scope by declaration.
  cat > "$work/.ccn-baseline.json" <<'JSON'
{
  "population": { "roots": ["lib"], "extensions": [".ts"] },
  "entries": {}
}
JSON
  cp "$BATS_TEST_DIRNAME/../../scripts/ccn-report.cjs" "$work/scripts/ccn-report.cjs"
  cp "$BATS_TEST_DIRNAME/../lib/ccn-ratchet.sh" "$work/githooks/lib/ccn-ratchet.sh"

  run bash -c "
    cd '$work' || exit 9
    PROJECT_LANG='python'
    CHANGED_FILES='lib/simple.py'
    CC_WARNINGS=0
    GATE_3_STATUS=''
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    source '$BATS_TEST_DIRNAME/../gate-3.sh'
  "

  [[ "$output" == *"outside the baseline population"* ]]
  # And it must name the FILE, not a number: printing the CCN was the tell that
  # the wrong column had been read.
  [[ "$output" == *"lib/simple.py"* ]]
}
