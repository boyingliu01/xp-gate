#!/usr/bin/env bats
# @test REQ-798-GATE-TIMING
# @intent #798's "先做哪一步" is explicit: step 1 is per-gate duration recording,
#         because "没有逐 gate 的耗时数据，「按耗时排序」只能靠估算" — without it,
#         the reordering the issue asks for can only be driven by guesses.
#
#         The report JSON currently carries ONE run-level duration_ms and no
#         per-gate timing at all, even though every gate already latches a
#         GATE_N_START via gate_start_ms() and record_gate_audit() already
#         subtracts an end time to build its per-gate duration. The data is
#         computed and then thrown away at the point the report is written.
#
#         The property asserted here: the per-run report exposes a duration for
#         EACH gate, produced from that gate's own start timestamp, so a later
#         ordering decision reads measurements instead of estimates. A gate that
#         did not run must not appear with a fabricated 0.
# @covers AC-798-T1, AC-798-T2, AC-798-T3

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"

  # #798 split the chain: pre-commit keeps the preamble/epilogue, each gate body
  # lives in gate-entries/, and the order lives in gate-driver.sh. Assertions
  # about gate code must search the whole set, not just the entry point -- the
  # per-gate timing code in particular is now mostly inside the entry files.
  GATE_CHAIN="$HOOK"
  [ -f "$REPO_ROOT/githooks/gate-driver.sh" ] && GATE_CHAIN="$GATE_CHAIN $REPO_ROOT/githooks/gate-driver.sh"
  if [ -d "$REPO_ROOT/githooks/gate-entries" ]; then
    GATE_CHAIN="$GATE_CHAIN $REPO_ROOT/githooks/gate-entries/*.sh"
  fi
}

# grep across the whole chain (entry point + driver + every gate body).
_chain_grep() {
  # shellcheck disable=SC2086  # word splitting of the glob list is intended
  grep -q "$@" $GATE_CHAIN
}

# ---------------------------------------------------------------------------
# AC-798-T1 — every gate that latches a start also gets an elapsed value.
# ---------------------------------------------------------------------------

@test "AC-798-T1: gates that latch a start timestamp expose elapsed_ms" {
  # GATE_0_START .. GATE13_START are latched today. At least the gates in the
  # measured hot path must publish a duration in the report.
  local missing=""
  local n
  for n in 1 2 3 4 5 6 9 10 11 12 13; do
    # Accept either a per-gate assignment or a single computed table, as long as
    # the gate number appears in an elapsed/duration assignment.
    _chain_grep -E "GATE_?${n}[A-Z_]*_?(ELAPSED|DURATION|MS)" \
      || _chain_grep "gate_elapsed_ms ${n}\b" \
      || missing="$missing ${n}"
  done
  if [ -n "$missing" ]; then
    echo "gates with no recorded elapsed time:$missing"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# AC-798-T2 — the report document carries the per-gate timing.
# ---------------------------------------------------------------------------

@test "AC-798-T2: the report JSON includes per-gate duration" {
  # The report is what xp-gate audit / retro / any optimisation decision reads.
  # The gate name is the key and the measured milliseconds the value, e.g.
  #   "gateTimings": {"tests-coverage": 136000, "complexity": 4100}
  _chain_grep 'gateTimings'
  _chain_grep 'gate_timings_json'
}

@test "AC-798-T2: per-gate durations are emitted through one table, not 13 copies" {
  # One emitter keeps the 13 gates from drifting; the same lesson as the
  # adapter declaration in AC-798-G5-01.
  grep -qE 'gate_timings_json|_XP_GATE_TIMINGS|gate_elapsed_table' "$HOOK"
}

# ---------------------------------------------------------------------------
# AC-798-T3 — absent is absent: a gate that did not run has no duration.
# ---------------------------------------------------------------------------

@test "AC-798-T3: a gate that never ran does not report a zero duration" {
  # `elapsed_ms: 0` would read as "this gate was instant", the same lie class as
  # `duration_ms: 0` in #640. The emitter must omit the key instead.
  local fn
  fn=$(sed -n '/^gate_timings_json()/,/^}/p' "$HOOK")
  [ -n "$fn" ]
  # It must skip any entry that is not a plain non-negative integer, and say so.
  printf '%s' "$fn" | grep -qF '[!0-9]'
  printf '%s' "$fn" | grep -q 'continue'
}
