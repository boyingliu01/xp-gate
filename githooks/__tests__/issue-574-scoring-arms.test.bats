#!/usr/bin/env bats
# @test REQ-599
# @intent The scoring loop declared a state it did not recognise. `DEGRADED` is a
#         real status a gate can produce — Gate 5 emits it when coverage could not
#         be measured honestly instead of claiming PASS — but the loop had no
#         `DEGRADED)` arm, so such a gate fell into `*)` and counted as a hard
#         failure. A gate that reports the truth about itself was thereby
#         punished as if it had failed (#574).
#
#         The same loop also never published WARN or FAIL counts, so
#         `gatesDegraded` was just a copy of WARN and a report with two warnings
#         looked identical to a report with two skips — the two states a reader
#         most needs to tell apart.
#
#         These cases pin: DEGRADED scores as a degradation (WARN, never FAIL);
#         WARN and FAIL are counted separately from each other and from SKIP; and
#         the report publishes those counts so the states are distinguishable
#         from the data alone.
# @covers AC-599-10
bats_require_minimum_version 1.5.0

setup() {
  PRE_COMMIT="$BATS_TEST_DIRNAME/../pre-commit"
  TEST_DIR="$BATS_TEST_TMPDIR/work"
  mkdir -p "$TEST_DIR"
  cd "$TEST_DIR" || return 1
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# The status tally from the hook's scoring loop.
tally_block() {
  sed -n '/^  for gate in 1 2 3 4 5 6 7 8 9 10 11 12; do$/,/^  done$/p' "$PRE_COMMIT"
}

# Run the hook's real tally over a list of statuses and print `key=value` lines
# for the counters plus the verdict.
#
# The block is copied verbatim and executed, so a change to the hook is what the
# assertions see. It is syntax-checked and proved to contain the decision before
# any case relies on it.
tally_for() {
  local block out
  block=$(tally_block)
  [ -n "$block" ] || { echo "EXTRACTION-EMPTY"; return 91; }
  printf '%s\n' "$block" > "$TEST_DIR/tally.sh"
  bash -n "$TEST_DIR/tally.sh" 2> "$TEST_DIR/tally.err" \
    || { echo "EXTRACTION-UNPARSEABLE: $(cat "$TEST_DIR/tally.err")"; return 92; }
  grep -q 'DEGRADED' "$TEST_DIR/tally.sh" \
    || { echo "EXTRACTION-MISSING-DEGRADED-ARM"; return 93; }
  grep -q 'NONPASS_COUNT' "$TEST_DIR/tally.sh" \
    || { echo "EXTRACTION-MISSING-NONPASS"; return 94; }

  # The loop reads GATE_<n>_STATUS via indirect expansion; export them.
  set -- "$@"
  local i=1
  for st in "$@"; do
    export "GATE_${i}_STATUS=$st"
    i=$((i + 1))
  done
  while [ "$i" -le 12 ]; do
    export "GATE_${i}_STATUS=SKIP"
    i=$((i + 1))
  done

  out=$(
    PASSED_COUNT=0
    SKIP_COUNT=0
    WARN_COUNT=0
    NONPASS_COUNT=0
    DEGRADED_COUNT=0
    DEGRADED_JSON=""
    TOTAL_GATES=12
    # shellcheck disable=SC1090
    . "$TEST_DIR/tally.sh"
    printf 'PASSED=%s\n' "$PASSED_COUNT"
    printf 'SKIP=%s\n' "$SKIP_COUNT"
    printf 'WARN=%s\n' "$WARN_COUNT"
    printf 'NONPASS=%s\n' "$NONPASS_COUNT"
    printf 'DEGRADED=%s\n' "$DEGRADED_COUNT"
  )
  printf '%s\n' "$out"
}

value_of() {
  printf '%s\n' "$1" | sed -n "s/^$2=//p"
}

@test "AC-599-10: the tally extraction runs and recognises DEGRADED (anti-vacuity)" {
  out=$(tally_for DEGRADED)

  [ $? -eq 0 ] || { echo "$out"; return 1; }
  [ "$(value_of "$out" DEGRADED)" = "1" ] || {
    echo "a DEGRADED gate was not counted as degraded: $out"
    return 1
  }
}

@test "AC-599-10: a DEGRADED gate counts as degraded, not as a hard failure" {
  # The bug's consequence: DEGRADED fell into the catch-all arm and made the run
  # FAIL. A gate that honestly says "I could not measure this" must not be
  # treated as having failed.
  out=$(tally_for DEGRADED)
  nonpass=$(value_of "$out" NONPASS)
  warn=$(value_of "$out" WARN)

  [ "$nonpass" = "1" ] || { echo "got: $out"; return 1; }
  # The FAIL predicate in the hook is (NONPASS - WARN) > 0. DEGRADED must feed
  # WARN so the predicate stays 0 and the verdict becomes WARN, not FAIL.
  [ "$warn" = "1" ] || {
    echo "DEGRADED did not feed WARN_COUNT, so it would be judged FAIL: $out"
    return 1
  }
  [ "$(((nonpass - warn)))" -eq 0 ] || { echo "got: $out"; return 1; }
}

@test "AC-599-10: WARN alone is not degraded" {
  # gatesDegraded used to be a copy of WARN. A plain WARN must not claim to be a
  # degradation, or the two fields stay indistinguishable.
  out=$(tally_for WARN)

  [ "$(value_of "$out" WARN)" = "1" ] || { echo "got: $out"; return 1; }
  [ "$(value_of "$out" DEGRADED)" = "0" ] || {
    echo "a plain WARN was counted as degraded: $out"
    return 1
  }
}

@test "AC-599-10: FAIL is counted separately from WARN" {
  out=$(tally_for FAIL)

  [ "$(value_of "$out" NONPASS)" = "1" ] || { echo "got: $out"; return 1; }
  [ "$(value_of "$out" WARN)" = "0" ] || {
    echo "a FAIL was counted as a WARN: $out"
    return 1
  }
  # (NONPASS - WARN) > 0 is how the hook decides FAIL; it must hold here.
  [ "$((( $(value_of "$out" NONPASS) - $(value_of "$out" WARN) )))" -gt 0 ] || {
    echo "a real FAIL would not be judged FAIL: $out"
    return 1
  }
}

@test "AC-599-10: a real FAIL still makes the run FAIL even beside a DEGRADED" {
  out=$(tally_for FAIL DEGRADED)
  nonpass=$(value_of "$out" NONPASS)
  warn=$(value_of "$out" WARN)

  [ "$nonpass" = "2" ] || { echo "got: $out"; return 1; }
  [ "$warn" = "1" ] || { echo "got: $out"; return 1; }
  [ "$(((nonpass - warn)))" -gt 0 ] || {
    echo "a real FAIL was masked by the DEGRADED beside it: $out"
    return 1
  }
}

@test "AC-599-10: SKIP is neither warned nor degraded nor failed" {
  # The helper fills the gates it was not given with SKIP, so this run is all
  # twelve skipped -- what matters is that SKIP lands in no other counter.
  out=$(tally_for SKIP)

  [ "$(value_of "$out" SKIP)" = "12" ] || { echo "got: $out"; return 1; }
  [ "$(value_of "$out" WARN)" = "0" ] || { echo "got: $out"; return 1; }
  [ "$(value_of "$out" DEGRADED)" = "0" ] || { echo "got: $out"; return 1; }
  [ "$(value_of "$out" NONPASS)" = "0" ] || { echo "got: $out"; return 1; }
}

@test "AC-599-10: the report publishes warned and failed counts and the failing gate list" {
  # Without these, a report with two warnings is indistinguishable from one with
  # two skips: the JSON carried gatesPassed/gatesSkipped/gatesDegraded only.
  run grep -c '"gatesWarned"' "$PRE_COMMIT"
  [ "$output" -ge 1 ] || { echo "gatesWarned is not published"; return 1; }

  run grep -c '"gatesFailed"' "$PRE_COMMIT"
  [ "$output" -ge 1 ] || { echo "gatesFailed is not published"; return 1; }

  run grep -c '"failedGates"' "$PRE_COMMIT"
  [ "$output" -ge 1 ] || { echo "failedGates is not published"; return 1; }
}

@test "AC-599-10: the published counts come from the counters, not from literals" {
  # A hardcoded 0 would satisfy a shape assertion while telling the reader
  # nothing — the failure mode #569 and #577 were both about.
  run grep -E '"gatesWarned": \$\{?WARN_COUNT' "$PRE_COMMIT"
  [ "$status" -eq 0 ] || { echo "gatesWarned is not wired to WARN_COUNT"; return 1; }

  run grep -E '"gatesFailed": \$\{?FAIL_COUNT' "$PRE_COMMIT"
  [ "$status" -eq 0 ] || { echo "gatesFailed is not wired to FAIL_COUNT"; return 1; }
}
