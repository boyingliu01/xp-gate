#!/usr/bin/env bats
# @test REQ-524
# @intent Gate 11 subtracted a seconds timestamp (date +%s) from a milliseconds
#         timestamp (gate_start_ms), printing a duration of about -1.79e12 s
#         ("completed in -1789830788575s") on every pre-commit run. The negative
#         value flows into .xp-gate/reports/pre-commit/*.json and any consumer
#         reading it back. Gate 9 already pairs units correctly; this was a
#         one-line divergence, not a design choice. Both shipped copies of
#         pre-commit must carry the fix (byte mirrors).
# @covers AC-524-01..04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  MIRROR_HOOK="$REPO_ROOT/src/npm-package/hooks/pre-commit"
  LIB="$REPO_ROOT/githooks/lib/now-ms.sh"
  TEST_DIR="$(mktemp -d)"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Runs the real Gate 11 timing tail, lifted out of pre-commit, with the audit
# helper stubbed. now_ms is the real one (node-preferred, cross-platform).
run_gate_11_tail() {
  (
    set -u
    source "$LIB"
    gate_start_ms() { now_ms; }
    record_gate_audit() { :; }
    GATE_11_STATUS="PASS"
    GATE_11_START=$(gate_start_ms)
    region=$(awk '/^GATE_11_END=/,/^record_gate_audit "gate-11" "sprint-flow" "\$GATE_11_STATUS" "0"/' "$HOOK")
    eval "$region"
  )
}

@test "AC-524-01: the printed duration is a non-negative plausible seconds value" {
  run run_gate_11_tail
  [[ "$output" =~ completed\ in\ ([0-9]+)s ]]
  local duration="${BASH_REMATCH[1]}"
  # A gate cannot run negative time; the bug printed about -1.79e12.
  [ "$duration" -ge 0 ]
  # And it cannot plausibly run for a full day in a pre-commit gate.
  [ "$duration" -lt 86400 ]
}

@test "AC-524-02: the end timestamp uses the ms helper, never date +%s" {
  region=$(awk '/^GATE_11_END=/,/^record_gate_audit "gate-11" "sprint-flow" "\$GATE_11_STATUS" "0"/' "$HOOK")
  # Anti-drift: the region must pair ms with ms via the #370 helper.
  [[ "$region" == *now_ms* ]] || [[ "$region" == *gate_end_ms* ]]
  [[ "$region" != *'date +%s'* ]]
}

@test "AC-524-03: the npm-package mirror carries the same fixed tail" {
  mirror_region=$(awk '/^GATE_11_END=/,/^record_gate_audit "gate-11" "sprint-flow" "\$GATE_11_STATUS" "0"/' "$MIRROR_HOOK")
  repo_region=$(awk '/^GATE_11_END=/,/^record_gate_audit "gate-11" "sprint-flow" "\$GATE_11_STATUS" "0"/' "$HOOK")
  [ "$mirror_region" = "$repo_region" ]
}

@test "AC-524-04 anti-vacuity: a wrong-unit region is caught by this harness" {
  # Prove the harness would have failed on the old code: feed it a seconds end.
  run bash -c "
    set -u
    source '$LIB'
    gate_start_ms() { now_ms; }
    record_gate_audit() { :; }
    GATE_11_STATUS='PASS'
    GATE_11_START=\$(gate_start_ms)
    GATE_11_END=\$(date +%s)
    GATE_11_DURATION=\$((GATE_11_END - GATE_11_START))
    echo \"   Gate 11 (\$GATE_11_STATUS) completed in \${GATE_11_DURATION}s\"
  "
  # The old arithmetic produces a negative duration -- the exact symptom.
  [[ "$output" =~ completed\ in\ -[0-9]+s ]]
}
