# test-audit-poisoned-start.bats — REQ-B: audit bookkeeping must never emit epoch-sized durations
# @test REQ-AUDIT-001
# @intent A poisoned/empty start_ms must produce duration_ms=null with a reason, not an epoch-sized integer
# @covers AC-AUDIT-001, AC-AUDIT-002

@test "record_gate_audit sanitizes empty start_ms to null duration" {
  run bash -c 'source ./githooks/lib/audit-sanitize.sh; sanitize_start ""'
  [ "$status" -eq 0 ]
  [ "$output" = "null" ]
}

@test "record_gate_audit flags seconds-unit start_ms as poisoned" {
  # A ~10-digit value cannot be an epoch in ms (ms epochs are 13 digits since 2001).
  run bash -c 'source ./githooks/lib/audit-sanitize.sh; sanitize_start 1753001234'
  [ "$status" -eq 0 ]
  [ "$output" = "null" ]
}

@test "valid millisecond start_ms passes through untouched" {
  run bash -c 'source ./githooks/lib/audit-sanitize.sh; sanitize_start 1792331538955'
  [ "$status" -eq 0 ]
  [ "$output" = "1792331538955" ]
}

@test "compute_duration_ms returns null for poisoned start" {
  run bash -c 'source ./githooks/lib/audit-sanitize.sh; compute_duration_ms "" 1792331540000'
  [ "$output" = "null" ]
}

@test "compute_duration_ms returns null on clock skew (negative delta)" {
  run bash -c 'source ./githooks/lib/audit-sanitize.sh; compute_duration_ms 1792331540000 1792331538955'
  [ "$output" = "null" ]
}

@test "compute_duration_ms normal path yields the delta" {
  run bash -c 'source ./githooks/lib/audit-sanitize.sh; compute_duration_ms 1792331538955 1792331540000'
  [ "$output" = "1045" ]
}
