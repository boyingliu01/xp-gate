#!/usr/bin/env bats

# ============================================================================
# Issue #370: audit.jsonl duration_ms ~56-year anomaly on Windows Git Bash
#
# Root cause: `date +%s%3N` outputs literal "N" (e.g. "1753001234N") and
# exits 0 on Windows Git Bash, so the || fallback to node never triggers.
#
# Fix: now_ms() validates every candidate with ^[0-9]+$ and falls back to
# date +%s (seconds * 1000) when the millisecond source is unusable.
#
# NOTE (#798): node is NO LONGER a clock source. It was correct but cost ~580 ms
# per call on Windows, and at 2-4 calls per gate across 14 gates it added roughly
# 60 s to every commit -- a clock that dominates what it measures. The order is
# now $EPOCHREALTIME (bash builtin, zero forks) -> date +%s%3N (validated) ->
# date +%s. The guarantee #370 asked for is unchanged and is what the assertions
# below test: the poisoned "1753001234N" is never used and the result is always
# purely numeric. Do not reintroduce node here without also re-reading the
# "one clock, never a second source" rule in AGENTS.md.
#
# This test injects a FAKE date that outputs poisoned "1753001234N" (exit 0),
# then asserts:
#   (a) now_ms output is purely numeric
#   (b) the poisoned value was NOT used as the answer
#   (c) duration from two consecutive calls is < 7200000
# ============================================================================

NOW_MS_LIB="$BATS_TEST_DIRNAME/../lib/now-ms.sh"

setup() {
  TEST_DIR=$(mktemp -d)
  FAKE_BIN="$TEST_DIR/fake-bin"
  mkdir -p "$FAKE_BIN"

  # Fake date that reproduces Git Bash exactly: `+%s%3N` prints a literal "N" and
  # exits 0 (the #370 bug), while `+%s` still returns usable whole seconds. A date
  # that fails BOTH formats is covered separately by the last test.
  cat > "$FAKE_BIN/date" <<'FAKE_DATE'
#!/bin/bash
case "$*" in
  *%3N*) echo "1753001234N"; exit 0 ;;
  *)     echo "1753001234";  exit 0 ;;
esac
FAKE_DATE
  chmod +x "$FAKE_BIN/date"

  # Pin the clock to the fork-based branches. Under bats, EPOCHREALTIME is set, so
  # without this every assertion would exercise the builtin branch and never reach
  # the poisoned-date path this file exists to cover.
  unset EPOCHREALTIME

  # Prepend fake bin to PATH
  export PATH="$FAKE_BIN:$PATH"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

@test "Issue #370: now_ms returns pure digits when date outputs poisoned '1753001234N'" {
  source "$NOW_MS_LIB"

  run now_ms
  echo "now_ms output: $output"

  # Must be purely numeric (no 'N' suffix, no garbage)
  [[ "$output" =~ ^[0-9]+$ ]]
}

@test "Issue #370: now_ms never adopts the poisoned date value" {
  # #370's actual requirement. The old form asserted a node marker file, i.e. it
  # encoded HOW the bug was dodged rather than WHAT must hold. node is gone as a
  # clock source (#798), so the assertion moves to the property itself: whatever
  # branch is taken, the literal "1753001234N" must never reach the answer.
  source "$NOW_MS_LIB"

  run now_ms

  [ "$status" -eq 0 ]
  # (a) purely numeric -- no 'N' suffix, no garbage
  [[ "$output" =~ ^[0-9]+$ ]]
  # (b) the poison itself never reaches the answer. 1753001234000 IS a legitimate
  # value here -- it is 1753001234 seconds x 1000, the documented coarse fallback.
  # What must never appear is the raw "1753001234N" or a digit string derived from
  # it without validation.
  [ "$output" != "1753001234N" ]
  [[ "$output" != *N* ]]
}

@test "Issue #370: duration from two consecutive now_ms calls is < 7200000ms" {
  source "$NOW_MS_LIB"

  local start_ms end_ms duration_ms
  start_ms=$(now_ms)
  end_ms=$(now_ms)
  duration_ms=$((end_ms - start_ms))

  echo "start=$start_ms end=$end_ms duration=$duration_ms"

  # Duration must be non-negative and < 2 hours
  [ "$duration_ms" -ge 0 ]
  [ "$duration_ms" -lt 7200000 ]
}

@test "Issue #370: now_ms falls back to date +%s when no millisecond source works" {
  # Replace fake date with one that outputs seconds (simulating date +%s), i.e. a
  # platform whose date has no %N support at all.
  printf '#!/bin/bash\necho "1753001234"\nexit 0\n' > "$FAKE_BIN/date"
  chmod +x "$FAKE_BIN/date"

  source "$NOW_MS_LIB"

  run now_ms
  echo "now_ms fallback output: $output"

  # Must be purely numeric
  [[ "$output" =~ ^[0-9]+$ ]]
  # Must be in milliseconds range (seconds * 1000)
  [ "$output" -ge 1000000000000 ]
}
