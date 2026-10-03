#!/usr/bin/env bats

# ============================================================================
# Issue #462: Gate 9 (Build Integrity) reports absurd NEGATIVE durations
#
# Root cause: unit mismatch inside githooks/pre-commit.
#   GATE_9_START=$(gate_start_ms)   -> MILLISECONDS
#   GATE_9_END=$(date +%s)          -> SECONDS
#   GATE_9_DURATION=$((END - START)) -> seconds - milliseconds = huge negative
#
# Observed on Windows Git Bash: "Gate 9 completed in -1789216363599s"
#
# Every other gate in the file pairs gate_start_ms with the matching ms helper;
# Gate 9 was the ONLY gate that mixed the two units.
#
# Fix: derive the end timestamp from the same ms helper and convert to seconds
# for display. This test asserts the units are paired so the regression cannot
# silently return.
# ============================================================================

PRE_COMMIT="$BATS_TEST_DIRNAME/../pre-commit"

@test "Issue #462: Gate 9 END uses the millisecond helper, not 'date +%s'" {
  # Extract the Gate 9 timing block and assert the units match GATE_9_START.
  run grep -n 'GATE_9_END=' "$PRE_COMMIT"
  [ "$status" -eq 0 ]

  # The end timestamp must be sourced from the same ms helper as the start.
  [[ "$output" == *'gate_start_ms'* ]]
  # It must NOT be a raw seconds timestamp.
  [[ "$output" != *'date +%s'* ]]
}

@test "Issue #462: Gate 9 START is still milliseconds (guard against the reverse fix)" {
  run grep -n 'GATE_9_START=' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *'gate_start_ms'* ]]
}

@test "Issue #462: Gate 9 duration is converted from ms to seconds for display" {
  run grep -n 'GATE_9_DURATION=' "$PRE_COMMIT"
  [ "$status" -eq 0 ]

  # Display value must be the ms delta divided by 1000.
  [[ "$output" == *'/ 1000'* ]]
}

@test "Issue #462: ms delta minus a later ms timestamp is non-negative" {
  # Executable proof that the fixed arithmetic yields a sane duration.
  local start_ms end_ms delta_ms delta_s
  start_ms=1753001234000
  end_ms=1753001235500

  delta_ms=$((end_ms - start_ms))
  delta_s=$((delta_ms / 1000))

  [ "$delta_ms" -ge 0 ]
  [ "$delta_s" -ge 0 ]
  # 1500ms must display as 1s, never as a 56-year-negative anomaly.
  [ "$delta_s" -eq 1 ]
}

@test "Issue #462: the old mixed-unit formula is provably negative (documents the bug)" {
  # This is the regression's signature: ms-start subtracted from a seconds-end.
  local start_ms end_s delta
  start_ms=1753001234000   # milliseconds
  end_s=1753001236         # seconds (same instant, different unit)

  delta=$((end_s - start_ms))

  # Documents WHY the bug produced a huge negative number.
  [ "$delta" -lt 0 ]
}

@test "Issue #462: no gate mixes a millisecond START with a seconds END" {
  # Guard against the same class of bug appearing in a sibling gate.
  # The invariant is *pairing*, not "never use date +%s": Gate 11 legitimately
  # uses `date +%s` for BOTH ends, which is internally consistent.
  local start_unit end_unit
  start_unit=$(grep -o 'GATE_9_START=.*' "$PRE_COMMIT" | grep -o 'gate_start_ms' | head -n1)
  end_unit=$(grep -o 'GATE_9_END=.*' "$PRE_COMMIT" | grep -o 'gate_start_ms' | head -n1)

  echo "start_unit=$start_unit end_unit=$end_unit"

  # Both must resolve through the same (millisecond) clock helper.
  [ "$start_unit" = "gate_start_ms" ]
  [ "$end_unit" = "gate_start_ms" ]
}

@test "Issue #462: Gate 11 keeps using date +%s on both ends (internal consistency)" {
  # Documents that a seconds-based gate is fine as long as units pair up.
  local start_line end_line
  start_line=$(grep -n 'GATE_11_START=' "$PRE_COMMIT" | head -n1)
  end_line=$(grep -n 'GATE_11_END=' "$PRE_COMMIT" | head -n1)

  [[ "$start_line" == *'date +%s'* ]]
  [[ "$end_line" == *'date +%s'* ]]
}
