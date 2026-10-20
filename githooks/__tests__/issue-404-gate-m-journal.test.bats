#!/usr/bin/env bats
# #404 P0: every Gate M outcome must leave a reason and a duration in the
# pre-push journal.
#
# The journals held 68 runs with `details: {}` on Gate M, so the RFC question
# "how often is mutation testing skipped, and why?" could not be answered:
# 91.8% of rows were SKIP with no distinguishing information. A missing tool and
# "this push changed no mutable file" are opposite findings.

setup() {
  cd "$BATS_TEST_DIRNAME/../.." || exit 1
  PRE_PUSH="githooks/pre-push"
}

# Render the Gate M journal row the way the hook does, with the given state.
# `env` carries the values in: assigning them inline to `eval` would place them
# in the invoked shell's environment, not in the expansion below.
render_row() {
  local tpl
  tpl=$(grep "'id': 'M', 'name': 'Mutation Testing'" "$PRE_PUSH")
  env GATE_M_STATUS="$1" GATE_M_SKIP_REASON="$2" M_DURATION_MS="$3" M_SCORE="$4" \
    bash -c "eval \"printf '%s' \\\"\$1\\\"\"" _ "$tpl"
}

@test "AC-404-01: the Gate M journal row carries skip_reason, duration_ms and mutation_score" {
  row=$(render_row "SKIP" "x" 0 "")

  [ "${row#*skip_reason}" != "$row" ]
  [ "${row#*duration_ms}" != "$row" ]
  [ "${row#*mutation_score}" != "$row" ]
}

@test "AC-404-02: a skip reason reaches the journal verbatim" {
  row=$(render_row "SKIP" "no changed TypeScript source files in this push" 0 "")

  [ "${row#*no changed TypeScript source files}" != "$row" ]
}

@test "AC-404-03: a completed run records its duration and score" {
  row=$(render_row "PASS" "" 2450 "73.4")

  [ "${row#*2450}" != "$row" ]
  [ "${row#*73.4}" != "$row" ]
}

@test "AC-404-04: every Gate M skip site assigns a reason" {
  skips=$(grep -c 'SKIP — Gate M' "$PRE_PUSH" || true)
  reasons=$(grep -c 'GATE_M_SKIP_REASON=' "$PRE_PUSH" || true)

  [ "$skips" -ge 5 ]
  # One reason per skip site, plus the TIMEOUT and unexpected-exit branches.
  [ "$reasons" -ge 5 ]
}

@test "AC-404-05: skipping is distinguishable from running in the journal" {
  skipped=$(render_row "SKIP" "stryker not installed" 0 "")
  ran=$(render_row "PASS" "" 1200 "81")

  [ "${skipped#*\'status\': \'SKIP\'}" != "$skipped" ]
  [ "${ran#*\'status\': \'PASS\'}" != "$ran" ]
  [ "$skipped" != "$ran" ]
}
