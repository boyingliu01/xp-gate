#!/usr/bin/env bats

# ============================================================================
# Issue #370: audit.jsonl duration_ms ~56-year anomaly on Windows Git Bash
#
# Root cause: `date +%s%3N` outputs literal "N" (e.g. "1753001234N") and
# exits 0 on Windows Git Bash, so the || fallback to node never triggers.
#
# Fix: now_ms() prefers node, validates output with ^[0-9]+$, falls back
# to date +%s (seconds * 1000).
#
# This test injects a FAKE date that outputs poisoned "1753001234N" (exit 0)
# and a FAKE node that writes a marker file, then asserts:
#   (a) now_ms output is purely numeric
#   (b) node path was actually taken (marker file exists)
#   (c) duration from two consecutive calls is < 7200000
# ============================================================================

NOW_MS_LIB="$BATS_TEST_DIRNAME/../lib/now-ms.sh"

setup() {
  TEST_DIR=$(mktemp -d)
  FAKE_BIN="$TEST_DIR/fake-bin"
  mkdir -p "$FAKE_BIN"

  # Fake date: outputs poisoned value "1753001234N" and exits 0
  printf '#!/bin/bash\necho "1753001234N"\nexit 0\n' > "$FAKE_BIN/date"
  chmod +x "$FAKE_BIN/date"

  # Fake node: writes marker file, then outputs a real-ish epoch ms
  # Use NODE_MARKER_PATH env var so the script knows where to write
  export NODE_MARKER_PATH="$TEST_DIR/node-was-called.marker"
  printf '#!/bin/bash\ntouch "$NODE_MARKER_PATH"\necho "1753001234567"\nexit 0\n' > "$FAKE_BIN/node"
  chmod +x "$FAKE_BIN/node"

  # Prepend fake bin to PATH
  export PATH="$FAKE_BIN:$PATH"
}

teardown() {
  rm -rf "$TEST_DIR"
}

@test "Issue #370: now_ms returns pure digits when date outputs poisoned '1753001234N'" {
  source "$NOW_MS_LIB"

  run now_ms
  echo "now_ms output: $output"

  # Must be purely numeric (no 'N' suffix, no garbage)
  [[ "$output" =~ ^[0-9]+$ ]]
}

@test "Issue #370: now_ms prefers node over poisoned date (marker file created)" {
  source "$NOW_MS_LIB"

  run now_ms

  # The fake node writes a marker file — proves node path was taken
  [ -f "$TEST_DIR/node-was-called.marker" ]
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

@test "Issue #370: now_ms falls back to date +%s when node is unavailable" {
  # Remove fake node — now_ms should fall back to date +%s (seconds * 1000)
  rm -f "$FAKE_BIN/node"

  # Replace fake date with one that outputs seconds (simulating date +%s)
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
