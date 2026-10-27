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
