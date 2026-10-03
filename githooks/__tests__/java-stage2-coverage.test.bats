#!/usr/bin/env bats
#
# Stage 2 coverage enforcement for Java / JaCoCo.
#
# Regression: the Stage 2 `case "$CURRENT_LANG"` block had branches for
# typescript/python/go/shell/dart/powershell/iac but none for `java`, so Java
# fell through to the `*)` default branch. That branch only probes
# `coverage/coverage-summary.json` and `coverage/lcov.info`; JaCoCo writes
# neither (it writes `target/site/jacoco/jacoco.{csv,xml}`), so COVERAGE_PERCENT
# stayed empty and the hook printed
# "Could not determine java coverage percentage" while still exiting 0.
# Gate 5 therefore reported PASS at any coverage level, including 0%.
#
# Note this is the mirror image of issue #364 ("Java projects without JaCoCo
# blocked the commit"): that fix made a *missing* JaCoCo degrade gracefully,
# which left a *configured* JaCoCo unable to ever fail the gate.

setup() {
  TEST_DIR=$(mktemp -d)
  HOOK_PATH="$BATS_TEST_DIRNAME/../pre-commit"
  cd "$TEST_DIR" || return 1
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

extract_stage2_harness() {
  local harness="$TEST_DIR/stage2-coverage.sh"

  {
    printf '%s\n' '#!/usr/bin/env bash'
    printf '%s\n' 'set -o pipefail'
    printf '%s\n' 'CURRENT_LANG=java'
    printf '%s\n' 'COV_EXIT=0'
    printf '%s\n' 'COVERAGE_ENFORCED=false'
    # shellcheck disable=SC2016
    sed -n '/^  case "$CURRENT_LANG" in$/,/^  esac$/p' "$HOOK_PATH"
  } > "$harness"
  chmod +x "$harness"
  printf '%s\n' "$harness"
}

# jacoco.csv column layout (jacoco-maven-plugin):
# GROUP,PACKAGE,CLASS,INSTRUCTION_MISSED,INSTRUCTION_COVERED,BRANCH_...,LINE_...
write_jacoco_csv() {
  local missed="$1"
  local covered="$2"

  mkdir -p target/site/jacoco
  cat > target/site/jacoco/jacoco.csv <<CSV
GROUP,PACKAGE,CLASS,INSTRUCTION_MISSED,INSTRUCTION_COVERED,BRANCH_MISSED,BRANCH_COVERED,LINE_MISSED,LINE_COVERED
app,com.example,Foo,$missed,$covered,0,0,0,0
CSV
}

@test "Java Stage 2 has its own branch instead of falling through to the default" {
  run grep -E '^    "java"\)' "$HOOK_PATH"

  [ "$status" -eq 0 ]
}

@test "Java Stage 2 blocks when JaCoCo instruction coverage is below 80 percent" {
  write_jacoco_csv 30 70
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -ne 0 ]
  [[ "$output" =~ "BLOCKED - Java coverage 70% below 80% threshold" ]]
}

@test "Java Stage 2 passes at exactly 80 percent coverage" {
  write_jacoco_csv 20 80
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" =~ "Java coverage: 80%" ]]
}

@test "Java Stage 2 aggregates every class row instead of only the first" {
  mkdir -p target/site/jacoco
  cat > target/site/jacoco/jacoco.csv <<'CSV'
GROUP,PACKAGE,CLASS,INSTRUCTION_MISSED,INSTRUCTION_COVERED,BRANCH_MISSED,BRANCH_COVERED,LINE_MISSED,LINE_COVERED
app,com.example,Foo,90,10,0,0,0,0
app,com.example,Bar,90,10,0,0,0,0
CSV
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -ne 0 ]
  [[ "$output" =~ "Java coverage 10% below 80% threshold" ]]
}

@test "Java Stage 2 reports real low coverage instead of an unmeasurable N/A" {
  # The original symptom: 3.3% coverage was reported as
  # "Could not determine java coverage percentage" and the gate passed.
  write_jacoco_csv 967 33
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -ne 0 ]
  [[ ! "$output" =~ "Could not determine java coverage" ]]
}

@test "Java Stage 2 resolves columns by header name, not by position" {
  # Same totals as the 70% case with INSTRUCTION_* moved to other positions.
  mkdir -p target/site/jacoco
  cat > target/site/jacoco/jacoco.csv <<'CSV'
GROUP,CLASS,PACKAGE,BRANCH_MISSED,INSTRUCTION_COVERED,INSTRUCTION_MISSED,LINE_MISSED
app,Foo,com.example,0,70,30,0
CSV
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -ne 0 ]
  [[ "$output" =~ "BLOCKED - Java coverage 70% below 80% threshold" ]]
}

@test "Java Stage 2 blocks sub-1 percent coverage without an empty percentage" {
  # The displayed value is floored; a fraction-of-a-percent result must still
  # render as 0% and block, not as an empty string.
  write_jacoco_csv 9999 87
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -ne 0 ]
  [[ "$output" =~ "BLOCKED - Java coverage 0% below 80% threshold" ]]
}

@test "Java Stage 2 warns instead of blocking when no JaCoCo report exists" {
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" == *"No JaCoCo report found"* ]]
}

@test "Java Stage 2 does not borrow TypeScript coverage data" {
  # A stale Node report must never satisfy the Java check.
  mkdir -p coverage
  printf '%s\n' '{"total":{"lines":{"pct":95}}}' > coverage/coverage-summary.json
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" == *"No JaCoCo report found"* ]]
  [[ ! "$output" =~ "Java coverage: 95%" ]]
}

@test "Java Stage 2 warns on a zero-total report instead of passing it" {
  write_jacoco_csv 0 0
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" == *"no instruction data"* ]]
}

@test "Java Stage 2 reads the Gradle JaCoCo report location too" {
  mkdir -p build/reports/jacoco/test
  cat > build/reports/jacoco/test/jacocoTestReport.csv <<'CSV'
GROUP,PACKAGE,CLASS,INSTRUCTION_MISSED,INSTRUCTION_COVERED,BRANCH_MISSED,BRANCH_COVERED,LINE_MISSED,LINE_COVERED
app,com.example,Foo,50,50,0,0,0,0
CSV
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -ne 0 ]
  [[ "$output" =~ "BLOCKED - Java coverage 50% below 80% threshold" ]]
}

@test "canonical and npm Java coverage enforcement hooks remain byte-identical" {
  run cmp "$HOOK_PATH" "$BATS_TEST_DIRNAME/../../src/npm-package/hooks/pre-commit"

  [ "$status" -eq 0 ]
}
