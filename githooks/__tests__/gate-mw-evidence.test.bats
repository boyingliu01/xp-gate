#!/usr/bin/env bats

# @test REQ-DELPHI-MW-001
# @intent Reject incomplete or untrustworthy walkthrough evidence on feature branches
# @covers AC-DELPHI-MW-001-01 through AC-DELPHI-MW-001-15

VALIDATOR="$BATS_TEST_DIRNAME/../lib/validate-code-walkthrough.cjs"

setup() {
  TEST_DIR="$(mktemp -d)"
  RESULT_FILE="$TEST_DIR/.code-walkthrough-result.json"
  EXPECTED_COMMIT="be70fa734c77ff99647fd00197decf31919f1e11"
  EXPECTED_BRANCH="fix/gate6-high-remediation"
  NOW="2026-08-20T12:00:00Z"
  write_valid_fixture
}

teardown() {
  rm -rf "$TEST_DIR"
}

write_valid_fixture() {
  cat > "$RESULT_FILE" <<JSON
{
  "commit": "$EXPECTED_COMMIT",
  "branch": "$EXPECTED_BRANCH",
  "verdict": "APPROVED",
  "timestamp": "2026-08-20T12:00:00Z",
  "expires": "2026-08-20T13:00:00Z",
  "consensus_ratio": 0.90,
  "experts": [
    {"role":"architecture","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-a","resolved_model":"provider-model-a"},
    {"role":"technical","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-b","resolved_model":null},
    {"role":"feasibility","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-c","resolved_model":"provider-model-c"}
  ]
}
JSON
}

mutate_fixture() {
  node - "$RESULT_FILE" "$1" <<'NODE'
const fs = require('fs');
const [file, mutation] = process.argv.slice(2);
const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
Function('evidence', mutation)(evidence);
fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
NODE
}

run_validator() {
  run node "$VALIDATOR" "$RESULT_FILE" "$EXPECTED_COMMIT" "$EXPECTED_BRANCH" "$NOW"
}

@test "valid all-three walkthrough evidence passes when provider omits one resolved model" {
  run_validator
  [ "$status" -eq 0 ]
}

@test "expiry exactly one hour after timestamp passes" {
  run_validator
  [ "$status" -eq 0 ]
}

@test "expiry shorter or longer than exactly one hour fails" {
  for expires in '2026-08-20T12:59:59Z' '2026-08-20T13:00:01Z'; do
    write_valid_fixture
    mutate_fixture "evidence.expires=\"$expires\""
    run_validator
    [ "$status" -ne 0 ]
  done
}

@test "legacy minimal approval evidence fails closed" {
  printf '{"commit":"%s","branch":"%s","verdict":"APPROVED","expires":"2026-08-20T13:00:00Z"}\n' "$EXPECTED_COMMIT" "$EXPECTED_BRANCH" > "$RESULT_FILE"
  run_validator
  [ "$status" -ne 0 ]
}

@test "missing, two, and four expert records fail" {
  for mutation in 'delete evidence.experts' 'evidence.experts.pop()' 'evidence.experts.push({...evidence.experts[0], role:"security", requested_model:"model-d"})'; do
    write_valid_fixture
    mutate_fixture "$mutation"
    run_validator
    [ "$status" -ne 0 ]
  done
}

@test "duplicate or missing required roles fail" {
  for mutation in 'evidence.experts[1].role="architecture"' 'delete evidence.experts[2].role'; do
    write_valid_fixture
    mutate_fixture "$mutation"
    run_validator
    [ "$status" -ne 0 ]
  done
}

@test "duplicate trimmed and blank requested models fail" {
  for mutation in 'evidence.experts[1].requested_model=" model-a "' 'evidence.experts[1].requested_model="   "'; do
    write_valid_fixture
    mutate_fixture "$mutation"
    run_validator
    [ "$status" -ne 0 ]
  done
}

@test "wrong result type, non-approved verdict, error, and fallback records fail" {
  for mutation in 'evidence.experts[0].result_type="delphi_expert_error"' 'evidence.experts[0].verdict="REQUEST_CHANGES"' 'evidence.experts[0].error=true' 'evidence.experts[0].fallback=true'; do
    write_valid_fixture
    mutate_fixture "$mutation"
    run_validator
    [ "$status" -ne 0 ]
  done
}

@test "missing, string, below-threshold, above-one, and non-finite consensus fail" {
  for mutation in 'delete evidence.consensus_ratio' 'evidence.consensus_ratio="0.95"' 'evidence.consensus_ratio=0.89' 'evidence.consensus_ratio=1.01' 'evidence.consensus_ratio=null'; do
    write_valid_fixture
    mutate_fixture "$mutation"
    run_validator
    [ "$status" -ne 0 ]
  done
}

@test "wrong commit or branch fails" {
  for mutation in 'evidence.commit="deadbeef"' 'evidence.branch="main"'; do
    write_valid_fixture
    mutate_fixture "$mutation"
    run_validator
    [ "$status" -ne 0 ]
  done
}

@test "invalid, future, expired, or invalid expiry timestamps fail" {
  for mutation in 'evidence.timestamp="not-a-date"' 'evidence.timestamp="2026-08-20T14:00:00Z"' 'evidence.timestamp="2026-08-20T11:00:00Z"; evidence.expires="2026-08-20T12:00:00Z"' 'evidence.expires="not-a-date"'; do
    write_valid_fixture
    mutate_fixture "$mutation"
    run_validator
    [ "$status" -ne 0 ]
  done
}

@test "non-canonical UTC timestamp representations fail" {
  for mutation in \
    'evidence.timestamp="2026-08-20"' \
    'evidence.timestamp="2026-08-20T12:00:00"' \
    'evidence.timestamp="2026-08-20T12:00:00+00:00"' \
    'evidence.timestamp="2026-02-30T12:00:00Z"' \
    'evidence.timestamp="2026-08-20T12:00:00.1234Z"'; do
    write_valid_fixture
    mutate_fixture "$mutation"
    run_validator
    [ "$status" -ne 0 ]
  done
}

@test "blank resolved model fails but null resolved model remains trustworthy" {
  mutate_fixture 'evidence.experts[0].resolved_model="  "'
  run_validator
  [ "$status" -ne 0 ]

  write_valid_fixture
  mutate_fixture 'evidence.experts[0].resolved_model=null'
  run_validator
  [ "$status" -eq 0 ]
}
