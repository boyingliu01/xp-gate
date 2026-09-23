#!/usr/bin/env bats
#
# Stage 2 coverage enforcement in polyglot repos. .xp-gate-config.json may
# declare several languages, so every language in PROJECT_LANGS runs Stage 2
# in turn and each one must only answer for its own coverage artifact.
#
# Regression: IaC fell through to the generic '*' branch, read the
# TypeScript coverage/coverage-summary.json left behind by a subset test run
# and blocked every commit ("BLOCKED - iac coverage 16% below 80%").

setup() {
  TEST_DIR=$(mktemp -d)
  HOOK_PATH="$BATS_TEST_DIRNAME/../pre-commit"
  cd "$TEST_DIR" || return 1
  mkdir -p coverage
  write_ts_coverage 16
}

teardown() {
  rm -rf "$TEST_DIR"
}

write_ts_coverage() {
  cat > coverage/coverage-summary.json <<JSON
{"total":{"lines":{"pct":$1}}}
JSON
}

# Runs one iteration of the real Stage 2 loop body (case + epilogue) with
# CURRENT_LANG preset. Extra shell assignments may be passed as "$@".
extract_stage2_harness() {
  local lang="$1"
  shift
  local harness="$TEST_DIR/stage2-coverage.sh"

  {
    printf '%s\n' '#!/usr/bin/env bash'
    printf '%s\n' 'set -o pipefail'
    printf '%s\n' "CURRENT_LANG=$lang"
    printf '%s\n' 'COV_EXIT=0'
    printf '%s\n' 'COVERAGE_ENFORCED=false'
    printf '%s\n' "$@"
    # shellcheck disable=SC2016
    sed -n '/^  case "$CURRENT_LANG" in$/,/^  echo "✅ PASSED - Coverage check completed."$/p' "$HOOK_PATH"
  } > "$harness"
  chmod +x "$harness"
  printf '%s\n' "$harness"
}

@test "IaC Stage 2 does not borrow the TypeScript coverage report" {
  harness=$(extract_stage2_harness iac)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ ! "$output" =~ "below 80% threshold" ]]
  [[ ! "$output" =~ "iac coverage: 16%" ]]
  [[ "$output" == *"Coverage enforcement not applicable for iac"* ]]
}

@test "generic language Stage 2 warns instead of blocking on a subset test run" {
  harness=$(extract_stage2_harness java 'CHANGED_TEST_FILE_COUNT=2')

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Partial coverage 16% (subset test run, not full suite)."* ]]
  [[ ! "$output" =~ "BLOCKED" ]]
}

@test "generic language Stage 2 warns when PARTIAL_TEST_RUN is set" {
  harness=$(extract_stage2_harness java 'PARTIAL_TEST_RUN=true')

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Partial coverage 16% (subset test run, not full suite)."* ]]
  [[ ! "$output" =~ "BLOCKED" ]]
}

@test "generic language Stage 2 still blocks low coverage on a full test run" {
  harness=$(extract_stage2_harness java)

  run bash "$harness"

  [ "$status" -ne 0 ]
  [[ "$output" =~ "BLOCKED - java coverage 16% below 80% threshold" ]]
}

@test "generic language Stage 2 passes coverage at or above 80 percent" {
  write_ts_coverage 85
  harness=$(extract_stage2_harness java)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" =~ "java coverage: 85%" ]]
}

@test "canonical and npm Stage 2 polyglot coverage hooks remain byte-identical" {
  run cmp "$HOOK_PATH" "$BATS_TEST_DIRNAME/../../src/npm-package/hooks/pre-commit"

  [ "$status" -eq 0 ]
}
