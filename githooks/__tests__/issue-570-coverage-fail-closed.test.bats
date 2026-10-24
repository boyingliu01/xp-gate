#!/usr/bin/env bats
# @test REQ-599
# @intent A coverage gate answers one question — "is coverage at or above the
#         floor?" — and every language branch answered "I don't know" by printing a
#         ⚠️ and exiting 0. Deleting the report file therefore disabled the gate
#         silently, while the summary line still looked green. Measured in the
#         field: a repo whose `pytest` failed (so no .coverage was written) passed
#         pre-commit with a clean sweep.
#
#         "Could not measure" is a FAILED answer to the gate's question, not a
#         lenient one (#570). These cases pin that every enforcing branch blocks
#         when it cannot determine coverage, that the ONE legitimate exception (a
#         subset run, where the global percentage is meaningless by construction)
#         still only warns, and that a MEASURED 0% blocks like any other number
#         below the floor rather than being folded into "unknown".
#
#         They also pin that the pass line prints the configured threshold instead
#         of a hard-coded 80 — a gate that reports a number it did not use is a
#         second, quieter way of lying.
# @covers AC-599-04, AC-599-05
bats_require_minimum_version 1.5.0

setup() {
  PRE_COMMIT="$BATS_TEST_DIRNAME/../pre-commit"
  TEST_DIR="$BATS_TEST_TMPDIR/work"
  mkdir -p "$TEST_DIR"
  cd "$TEST_DIR" || return 1
  git init -q .
  git config user.email test@example.com
  git config user.name Test
  git config core.hooksPath .git/hooks
  echo seed > README.md
  git add README.md
  git commit --no-verify -q -m seed

  # A controllable coverage.py. `enforce_python_coverage()` probes for it first
  # and returns early when absent, so without a stub these cases assert the
  # machine's tool inventory rather than the gate's verdict. It reports the
  # percentage this test asks for and produces no output when none is set --
  # which is exactly the "measured nothing" case under test.
  mkdir -p "$TEST_DIR/bin"
  cat > "$TEST_DIR/bin/coverage" <<'STUB'
#!/usr/bin/env bash
# Only `coverage report` is used by the gate; echo the requested total.
if [ "${COVERAGE_STUB_EMPTY:-false}" = "true" ]; then exit 0; fi
printf '%s\n' "${COVERAGE_STUB_TOTAL:-97}"
STUB
  chmod +x "$TEST_DIR/bin/coverage"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# The whole Stage 2 coverage case statement, extracted from the real hook.
#
# Anchored on the `case "$CURRENT_LANG" in` opener and the closing `esac`, which is
# how the hook itself delimits it. The extraction is syntax-checked by the case
# below before anything relies on it: an unbalanced cut would otherwise eval to
# nothing and every assertion here would measure a no-op.
stage2_block() {
  sed -n '/^  case "\$CURRENT_LANG" in$/,/^  esac$/p' "$PRE_COMMIT"
}

# Run the extracted block for one language with a prepared working tree.
#   $1  language
#   $2  PARTIAL_TEST_RUN value ("true" or "")
# Prints the block's output; exit status is the block's.
run_stage2() {
  local lang="$1" partial="${2:-}"
  block=$(stage2_block)
  [ -n "$block" ] || { echo "EXTRACTION-EMPTY"; return 91; }
  printf '%s\n' "$block" > "$TEST_DIR/stage2.sh"
  bash -n "$TEST_DIR/stage2.sh" 2> "$TEST_DIR/blk.err" \
    || { echo "EXTRACTION-UNPARSEABLE: $(cat "$TEST_DIR/blk.err")"; return 92; }
  grep -q 'COVERAGE_ENFORCED' "$TEST_DIR/stage2.sh" \
    || { echo "EXTRACTION-MISSING-BODY"; return 93; }

  (
    set -u
    cd "$TEST_DIR" || exit 90
    CURRENT_LANG="$lang"
    PARTIAL_TEST_RUN="$partial"
    COV_EXIT=0
    COVERAGE_ENFORCED=false
    COVERAGE_THRESHOLD=80
    COVERAGE_PERCENT=""
    # A stub coverage.py on PATH whose answer is controlled by this test.
    #
    # enforce_python_coverage() probes for coverage.py BEFORE it measures
    # anything, so on a machine without it the function returns at that probe and
    # never reaches the verdict these cases are about. CI images do not install
    # coverage.py, so three cases here failed there for "tool absent" while
    # passing on a machine that happens to have it — the assertions were measuring
    # the environment, not the gate. The stub makes the probe succeed without
    # touching what is under test.
    PATH="$TEST_DIR/bin:$PATH"
    # shellcheck disable=SC1091
    source "$BATS_TEST_DIRNAME/../lib/coverage-total.sh"
    # The other helper the branches call is defined elsewhere in the hook.
    parse_lcov_coverage() {
      local f="$1"
      [ -f "$f" ] || { echo 0; return 0; }
      local hit found
      hit=$(grep -o '^LH:[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2)
      found=$(grep -o '^LF:[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2)
      [ -n "$hit" ] && [ -n "$found" ] && [ "$found" -gt 0 ] \
        && echo $((hit * 100 / found)) || echo 0
    }
    source "$TEST_DIR/stage2.sh"
    echo "VERDICT=COMPLETED"
  )
}

@test "AC-599-04: the Stage 2 extraction parses and contains the branches (anti-vacuity)" {
  block=$(stage2_block)
  [ -n "$block" ]
  printf '%s\n' "$block" > "$TEST_DIR/stage2.sh"
  bash -n "$TEST_DIR/stage2.sh"
  # Every enforcing language branch must be present, otherwise a case below could
  # "pass" because the branch it targets was never extracted.
  grep -q '"dart"|"flutter")' "$TEST_DIR/stage2.sh"
  grep -q '"powershell")' "$TEST_DIR/stage2.sh"
  grep -q '\*)' "$TEST_DIR/stage2.sh"
}

@test "AC-599-04: generic branch with NO coverage report BLOCKS instead of warning" {
  # `cpp` has no dedicated arm, so it lands in `*)` — the generic branch. It used
  # to be driven with "python", which never reaches `*)`, so the case named one
  # branch while exercising another.
  run run_stage2 "cpp" ""

  [ "$status" -ne 0 ]
  [[ "$output" != *"VERDICT=COMPLETED"* ]]
  [[ "$output" == *"BLOCKED"* ]]
}

@test "AC-599-04: Dart/Flutter with no lcov.info BLOCKS instead of warning" {
  run run_stage2 "dart" ""

  [ "$status" -ne 0 ]
  [[ "$output" != *"VERDICT=COMPLETED"* ]]
  [[ "$output" == *"BLOCKED"* ]]
}

@test "AC-599-04: PowerShell with no coverage.xml BLOCKS instead of warning" {
  run run_stage2 "powershell" ""

  [ "$status" -ne 0 ]
  [[ "$output" != *"VERDICT=COMPLETED"* ]]
  [[ "$output" == *"BLOCKED"* ]]
}

@test "AC-599-04: an unparseable coverage report BLOCKS (parse_error is not a pass)" {
  mkdir -p coverage
  # Valid JSON, no usable total -> the node parser prints parse_error.
  printf '%s\n' '{"not":"the shape we expect"}' > coverage/coverage-summary.json

  # The TS branch reads coverage/coverage-summary.json, so this must run as
  # TypeScript — driving it with "python" read a file the python branch never
  # opens and asserted a verdict the branch never reached.
  run run_stage2 "typescript" ""

  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED"* || "$output" == *"Could not parse"* ]]
}

@test "AC-599-05: a MEASURED 0% BLOCKS (0 is data, not a missing value)" {
  mkdir -p coverage
  printf '%s\n' '{"total":{"lines":{"pct":0}}}' > coverage/coverage-summary.json

  run run_stage2 "typescript" ""

  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED"* ]]
  [[ "$output" == *"0%"* ]]
}

@test "AC-599-04: a subset run is the one exception - it warns and does not block" {
  # PARTIAL_TEST_RUN means Stage 1 deliberately ran a subset, so the global
  # percentage is meaningless by construction. Blocking here would punish the
  # very optimisation the hook itself chose to make.
  mkdir -p coverage
  printf '%s\n' '{"total":{"lines":{"pct":16}}}' > coverage/coverage-summary.json

  run run_stage2 "python" "true"

  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT=COMPLETED"* ]]
  [[ "$output" != *"BLOCKED"* ]]
}

@test "AC-599-04: a subset run with NO report also warns rather than blocking" {
  # Same reasoning as above: nothing was measured because nothing was run.
  run run_stage2 "python" "true"

  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT=COMPLETED"* ]]
  [[ "$output" != *"BLOCKED"* ]]
}

@test "AC-599-05: the pass line prints the CONFIGURED threshold, not a literal 80" {
  mkdir -p coverage
  printf '%s\n' '{"total":{"lines":{"pct":92}}}' > coverage/coverage-summary.json

  # The GENERIC branch reads coverage-summary.json; the python branch reads
  # .coverage via enforce_python_coverage and would block here for a different
  # reason. Use a language that lands in the `*)` arm so this case measures the
  # pass line's wording and not the python parser.
  block=$(stage2_block)
  [ -n "$block" ] || { echo "stage2 extraction empty"; return 1; }
  printf '%s\n' "$block" > "$TEST_DIR/stage2.sh" \
    || { echo "cannot write $TEST_DIR/stage2.sh"; return 1; }
  bash -n "$TEST_DIR/stage2.sh" || { echo "extracted block does not parse"; return 1; }
  (
    set -u
    cd "$TEST_DIR" || exit 90
    CURRENT_LANG="generic"
    PARTIAL_TEST_RUN=""
    COV_EXIT=0
    COVERAGE_ENFORCED=false
    COVERAGE_THRESHOLD=73          # deliberately not 80
    COVERAGE_PERCENT=""
    # shellcheck disable=SC1091
    source "$BATS_TEST_DIRNAME/../lib/coverage-total.sh"
    parse_lcov_coverage() { echo 0; }
    source "$TEST_DIR/stage2.sh"
  ) > "$TEST_DIR/pass.txt" 2>&1

  # The pass line must name the threshold actually used (73), not a literal 80.
  grep -q '73%' "$TEST_DIR/pass.txt" || {
    echo "pass line did not mention the configured threshold 73:"
    cat "$TEST_DIR/pass.txt"
    return 1
  }
  if grep -q '≥ 80%' "$TEST_DIR/pass.txt"; then
    echo "pass line still prints a hard-coded 80:"
    cat "$TEST_DIR/pass.txt"
    return 1
  fi
}
