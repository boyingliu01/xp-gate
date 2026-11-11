#!/usr/bin/env bats
# @test REQ-798-DURATION-CLOCK
# @intent #798 comment 2 reported the per-run report's `duration_ms` as 21,754 ms
#         for a run that external timing measured at 199,000 ms — a 9x error.
#         A second run: 16,367 ms reported vs 246,000 ms measured. Every
#         "are the gates getting slower?" analysis (xp-gate retro,
#         .quality-history.jsonl) reads that field, and the issue's own root
#         cause analysis was then built on it.
#
#         The real defect is NOT "two clocks" (the fix for #640 claimed that,
#         and this test records what is actually true instead): BOTH ends read
#         /proc/uptime, but the parser is lossy. It takes the integer part and
#         appends `cut -c1-3` of the fraction:
#
#             /proc/uptime -> "331154.04"
#             parsed       -> 33115404     (expected 331154040)
#
#         When the fraction has two digits or fewer, `cut -c1-3` yields "04"
#         rather than "040", so the value is 10x too small. Because BOTH ends
#         lose the same digit, a long duration can come out roughly right —
#         which is why the error looked like "the gates are fast" instead of
#         "the arithmetic is broken" — while short durations lose all
#         sub-10s resolution and the subtraction can even go negative.
#
#         The property asserted here: the hook's duration must be computed from
#         a millisecond clock that does not lose its latched digits, and a
#         duration that is not corroborated by the gates recorded inside it must
#         be recorded as absent (null) rather than as a confident wrong number.
#         "No number" is honest; a number 10x off is what caused the misdiagnosis.
# @covers AC-798-D1, AC-798-D2, AC-798-D3, AC-798-D4

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  NOW_MS_LIB="$REPO_ROOT/githooks/lib/now-ms.sh"

  # #798 split the chain: the report writer -- and with it the duration
  # arithmetic -- now lives in gate-entries/gate-13-entry.sh, while the hook
  # epilogue calls it. Assertions about that code must search the whole chain;
  # searching only pre-commit reports the code as missing while it is in fact
  # running on every commit.
  CHAIN="$HOOK"
  [ -f "$REPO_ROOT/githooks/gate-driver.sh" ] && CHAIN="$CHAIN $REPO_ROOT/githooks/gate-driver.sh"
  if [ -d "$REPO_ROOT/githooks/gate-entries" ]; then
    CHAIN="$CHAIN $REPO_ROOT/githooks/gate-entries/*.sh"
  fi
}

# grep across the whole gate chain.
_chain_grep() {
  # shellcheck disable=SC2086  # word splitting of the glob list is intended
  grep -q "$@" $CHAIN
}

# ---------------------------------------------------------------------------
# AC-798-D1 — the parser that produced the 10x error must be gone, and the
# single validated millisecond clock must be what both ends use.
# ---------------------------------------------------------------------------

@test "AC-798-D1: the lossy /proc/uptime fraction parser is no longer used for duration" {
  # `cut -c1-3` on the fractional part is the exact expression that turned
  # "331154.04" into 33115404. It must not appear anywhere near duration math.
  if grep -q "cut -c1-3" "$HOOK"; then
    # If it survives at all, it must not be reachable from the duration path:
    # assert the duration computation itself does not use it.
    ! grep -A6 '_XP_DURATION_MS=' "$HOOK" | grep -q 'cut -c1-3'
  fi
}

@test "AC-798-D1: hook start and report end come from the same now_ms clock" {
  # The validated epoch-millisecond helper is the only clock with consistent
  # units on every platform this hook ships to.
  _chain_grep 'now_ms'
  # Hook entry must latch the start from it...
  grep -q '_XP_HOOK_START_MS=\$(now_ms)' "$HOOK"
  # ...and the report must measure "now" from it, not from a second parser.
  _chain_grep '_XP_NOW_MS=\$(now_ms)'
}

@test "AC-798-D1: now_ms is sourced before the hook-entry timestamp is latched" {
  local src_line latch_line
  src_line=$(grep -n 'now-ms.sh' "$HOOK" | head -1 | cut -d: -f1)
  latch_line=$(grep -n '_XP_HOOK_START_MS=\$(now_ms)' "$HOOK" | head -1 | cut -d: -f1)
  [ -n "$src_line" ]
  [ -n "$latch_line" ]
  [ "$src_line" -lt "$latch_line" ]
}

@test "AC-798-D1: now_ms itself is epoch milliseconds and self-validates" {
  # Guards the helper the fix now depends on: a helper that silently emitted
  # seconds would reintroduce the same class of error at a different scale.
  run bash -c "source '$NOW_MS_LIB' && now_ms"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^[0-9]+$ ]]
  # Epoch milliseconds are 13 digits today (10 in 2001, 14 in the year 2286);
  # anything shorter means seconds leaked through.
  [ "${#output}" -ge 13 ]
}

# ---------------------------------------------------------------------------
# AC-798-D2 — a lower-bound sanity check: hook duration must not contradict the
# gates recorded inside it. This is the guard the issue asked for by name:
# "宁可没有数，也不要有一个会让所有优化决策跑偏的数."
# ---------------------------------------------------------------------------

@test "AC-798-D2: duration_ms is validated against the sum of gate durations" {
  # The hook must compare its own duration to the gate timings it recorded and
  # refuse to publish a value that is smaller than what its own parts consumed.
  grep -q 'duration_ms' "$HOOK"
  _chain_grep -E '_XP_DURATION_FLOOR|_XP_DURATION_MS.*-lt|duration.*lower.?bound'
}

@test "AC-798-D2: an implausible duration is written as null, never as a number" {
  # A rejected duration must not fall through to 0 or to the raw subtraction.
  _chain_grep -E '_XP_DURATION_MS=""'
}

# ---------------------------------------------------------------------------
# AC-798-D3 — the milliseconds helper is shared, not re-implemented per hook.
# ---------------------------------------------------------------------------

@test "AC-798-D3: pre-push report carries a top-level duration_ms like pre-commit" {
  local PREPUSH="$REPO_ROOT/githooks/pre-push"
  # #798 comment 5 recorded that pre-push reports had NO wall-clock timing field,
  # so the whole pre-push chain could never be measured. Individual gates
  # (M / MP) carry their own duration_ms today, which is why a naive grep for
  # "duration_ms" passes while the run-level report still has no number.
  # The report is emitted by the Python heredoc in write_pre_push_report, so the
  # assertion targets that function's output document specifically.
  local report_fn
  report_fn=$(sed -n '/^write_pre_push_report()/,/^}/p' "$PREPUSH")
  [ -n "$report_fn" ]
  # A run-level key must exist in the report body. The document is emitted by a
  # Python heredoc, so the key spelling is Python's `'duration_ms':` (single
  # quotes) rather than JSON's double quotes; both forms are accepted here
  # because the assertion is about the KEY being present at run level, not
  # about which language serialised it.
  printf '%s' "$report_fn" | grep -qE "['\"]duration_ms['\"] *:"
}

@test "AC-798-D3: pre-push uses the shared clock rather than a private copy" {
  local PREPUSH="$REPO_ROOT/githooks/pre-push"
  # A second hand-written millisecond implementation is how the two hooks drift
  # apart again; the helper in lib/ is the single source.
  grep -q 'now-ms.sh' "$PREPUSH"
}

@test "AC-798-D4: the duration contract is behaviourally correct, not just greppable" {
  # Independent of how the hook is written, the arithmetic contract is:
  # a real elapsed time between two now_ms calls is within a sane band.
  run bash -c "
    source '$NOW_MS_LIB'
    __a=\$(now_ms)
    sleep 1
    __b=\$(now_ms)
    __d=\$(( __b - __a ))
    # 1s sleep must measure as 1s, not 100ms (the 10x bug) and not 0.
    if [ \"\$__d\" -ge 900 ] && [ \"\$__d\" -le 4000 ]; then echo OK; else echo \"BAD:\$__d\"; fi
  "
  [ "$status" -eq 0 ]
  [ "$output" = "OK" ]
}

@test "AC-798-D4: the old behaviour is measurably wrong (regression sentinel)" {
  # Reproduce the defect the fix targets, so the assertion above cannot silently
  # stop testing anything. If this ever starts failing, the premise changed and
  # the AC-798-D4 band above needs re-deriving.
  run bash -c '
    up="331154.04"
    parsed=$(printf "%s%s" "${up%%.*}" "$(printf "%s" "${up#*.}" | cut -c1-3)")
    echo "$parsed"
  '
  [ "$status" -eq 0 ]
  # The lossy parse yields 33115404 where the correct value is 331154040.
  [ "$output" = "33115404" ]
  [ "$output" != "331154040" ]
}
