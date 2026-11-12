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
  # #798: the Stage-2 coverage arms live in gate-entries/gate-5-entry.sh now, so
  # the sed/awk extraction below reads THAT file. Pointing HOOK_PATH at
  # pre-commit extracts nothing (the block is no longer there) and every case
  # then fails against an empty harness rather than a coverage verdict.
  HOOK_PATH="$BATS_TEST_DIRNAME/../gate-entries/gate-5-entry.sh"
  cd "$TEST_DIR" || return 1
  mkdir -p coverage
  write_ts_coverage 16
}

teardown() {
  # Leave the temp dir before deleting it: Windows cannot remove a cwd.
  cd "$BATS_TEST_DIRNAME" || return 1
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
    # #798: the gate bodies return rather than exit, so the extracted arm is
    # wrapped in a function and CALLED. Running it as a bare script makes
    # `return 1` a bash error that exits 0, which would silently turn every
    # BLOCK assertion below into a pass.
    printf '%s
' 'stage2_arm() {'
    sed -n '/^  case "$CURRENT_LANG" in$/,/^  echo "✅ PASSED - Coverage check completed."$/p' "$HOOK_PATH"
    printf '%s
' '}'
    printf '%s
' 'stage2_arm'
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

@test "generic language Stage 2 blocks low coverage after a full suite run" {
  # >20 changed test files makes Stage 1 run the full suite, so the coverage
  # report is complete and a sub-80% result must block (regression: a nonzero
  # changed-test-file count used to be mistaken for a subset run).
  #
  # kotlin stands in for "a language with no dedicated Stage 2 branch". It used
  # to be java here, but java now has its own JaCoCo branch, so it no longer
  # exercises the generic '*' path.
  harness=$(extract_stage2_harness kotlin 'CHANGED_TEST_FILE_COUNT=25')

  run bash "$harness"

  [ "$status" -ne 0 ]
  [[ "$output" =~ "BLOCKED - kotlin coverage 16% below 80% threshold" ]]
}

@test "TypeScript Stage 2 blocks low coverage after a full suite run" {
  harness=$(extract_stage2_harness typescript 'CHANGED_TEST_FILE_COUNT=25')

  run bash "$harness"

  [ "$status" -ne 0 ]
  [[ "$output" =~ "BLOCKED - TypeScript coverage 16% below 80% threshold" ]]
}

@test "generic language Stage 2 warns when PARTIAL_TEST_RUN is set" {
  harness=$(extract_stage2_harness kotlin 'PARTIAL_TEST_RUN=true')

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Partial coverage 16% (subset test run, not full suite)."* ]]
  [[ ! "$output" =~ "BLOCKED" ]]
}

@test "generic language Stage 2 still blocks low coverage on a full test run" {
  harness=$(extract_stage2_harness kotlin)

  run bash "$harness"

  [ "$status" -ne 0 ]
  [[ "$output" =~ "BLOCKED - kotlin coverage 16% below 80% threshold" ]]
}

@test "generic language Stage 2 passes coverage at or above 80 percent" {
  write_ts_coverage 85
  harness=$(extract_stage2_harness kotlin)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" =~ "kotlin coverage: 85%" ]]
}

@test "canonical and npm Stage 2 polyglot coverage hooks remain byte-identical" {
  # #798: HOOK_PATH now points at gate-entries/gate-5-entry.sh, so compare THAT
  # pair. Comparing it against the npm pre-commit compares two different files
  # and reports drift that does not exist.
  run cmp "$HOOK_PATH" "$BATS_TEST_DIRNAME/../../src/npm-package/hooks/gate-entries/gate-5-entry.sh"

  [ "$status" -eq 0 ]
}
