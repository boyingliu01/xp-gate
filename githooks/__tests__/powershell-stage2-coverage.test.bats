#!/usr/bin/env bats

setup() {
  TEST_DIR=$(mktemp -d)
  HOOK_PATH="$BATS_TEST_DIRNAME/../pre-commit"
  cd "$TEST_DIR" || return 1
  mkdir -p coverage
  cat > coverage/coverage-summary.json <<'JSON'
{"total":{"lines":{"pct":1.26}}}
JSON
}

teardown() {
  rm -rf "$TEST_DIR"
}

extract_stage2_harness() {
  local harness="$TEST_DIR/stage2-coverage.sh"

  {
    printf '%s\n' '#!/usr/bin/env bash'
    printf '%s\n' 'set -o pipefail'
    printf '%s\n' 'CURRENT_LANG=powershell'
    printf '%s\n' 'COV_EXIT=0'
    printf '%s\n' 'COVERAGE_ENFORCED=false'
    # shellcheck disable=SC2016
    sed -n '/^  case "$CURRENT_LANG" in$/,/^  esac$/p' "$HOOK_PATH"
  } > "$harness"
  chmod +x "$harness"
  printf '%s\n' "$harness"
}

write_pester_report() {
  local missed="$1"
  local covered="$2"

  cat > coverage.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<report>
  <package>
    <class><counter type="LINE" missed="99" covered="1" /></class>
  </package>
  <counter type="LINE" missed="$missed" covered="$covered" />
</report>
XML
}

@test "PowerShell Stage 2 uses the final Pester LINE counter instead of stale TypeScript coverage" {
  write_pester_report 6 53
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" =~ "PowerShell coverage: 90%" ]]
  [[ ! "$output" =~ "1% below 80%" ]]
}

@test "PowerShell Stage 2 blocks when Pester LINE coverage is below 80 percent" {
  write_pester_report 3 7
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -ne 0 ]
  [[ "$output" =~ "BLOCKED - PowerShell coverage 70% below 80% threshold" ]]
}

@test "PowerShell Stage 2 passes exact 80 percent coverage" {
  write_pester_report 1 4
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" =~ "PowerShell coverage: 80%" ]]
}

@test "PowerShell Stage 2 blocks raw 79.5 percent coverage before display rounding" {
  write_pester_report 41 159
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -ne 0 ]
  [[ "$output" =~ "BLOCKED - PowerShell coverage 80% below 80% threshold" ]]
}

@test "PowerShell Stage 2 warns for a zero-total LINE counter without borrowing TypeScript coverage" {
  write_pester_report 0 0
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Could not parse PowerShell coverage from coverage.xml"* ]]
  [[ ! "$output" =~ "1% below 80%" ]]
}

@test "PowerShell Stage 2 warns for a negative missed counter without borrowing TypeScript coverage" {
  write_pester_report -1 5
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Could not parse PowerShell coverage from coverage.xml"* ]]
  [[ ! "$output" =~ "PowerShell coverage: 125%" ]]
  [[ ! "$output" =~ "1% below 80%" ]]
}

@test "PowerShell Stage 2 warns for a negative covered counter without borrowing TypeScript coverage" {
  write_pester_report 5 -1
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Could not parse PowerShell coverage from coverage.xml"* ]]
  [[ ! "$output" =~ "1% below 80%" ]]
}

@test "PowerShell Stage 2 warns for a non-finite missed counter without borrowing TypeScript coverage" {
  write_pester_report Infinity 5
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Could not parse PowerShell coverage from coverage.xml"* ]]
  [[ ! "$output" =~ "1% below 80%" ]]
}

@test "PowerShell Stage 2 warns for a non-finite covered counter without borrowing TypeScript coverage" {
  write_pester_report 5 Infinity
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Could not parse PowerShell coverage from coverage.xml"* ]]
  [[ ! "$output" =~ "1% below 80%" ]]
}

@test "PowerShell Stage 2 warns for malformed Pester coverage without borrowing TypeScript coverage" {
  printf '%s\n' '<report><counter type="BRANCH" missed="0" covered="10" /></report>' > coverage.xml
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Could not parse PowerShell coverage from coverage.xml"* ]]
  [[ ! "$output" =~ "1% below 80%" ]]
}

@test "PowerShell Stage 2 warns when Pester coverage is missing without borrowing TypeScript coverage" {
  harness=$(extract_stage2_harness)

  run bash "$harness"

  [ "$status" -eq 0 ]
  [[ "$output" == *"coverage.xml not found"* ]]
  [[ ! "$output" =~ "1% below 80%" ]]
}

@test "canonical and npm PowerShell coverage enforcement hooks remain byte-identical" {
  run cmp "$HOOK_PATH" "$BATS_TEST_DIRNAME/../../src/npm-package/hooks/pre-commit"

  [ "$status" -eq 0 ]
}
