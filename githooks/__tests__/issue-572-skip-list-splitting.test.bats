#!/usr/bin/env bats
# @test REQ-599
# @intent The closing banner exists to tell a reviewer which gates did NOT run
#         (#557). It built its list by replacing the real separator `|` with
#         " , " and then splitting on `,` — but `,` is ordinary prose. A skip
#         reason containing a comma was therefore torn into two lines, and the
#         second half was printed as if it were its own gate:
#
#             Gate MP: script not found, parity NOT verified|...
#               - Gate MP: script not found
#               - parity NOT verified        <-- a gate that does not exist
#
#         An invented gate sends a reader hunting for a check that was never
#         written, while the real entry loses the half of its meaning that said
#         what was verified. These cases pin that the banner splits on the
#         SEPARATOR and only the separator, so the number of printed entries
#         always equals the number of recorded skips (#572).
# @covers AC-599-06
bats_require_minimum_version 1.5.0

setup() {
  PRE_PUSH="$BATS_TEST_DIRNAME/../pre-push"
  TEST_DIR="$BATS_TEST_TMPDIR/work"
  mkdir -p "$TEST_DIR"
  cd "$TEST_DIR" || return 1
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Render the banner body with a given GATES_SKIPPED payload.
#
# The block is taken from the real hook between its banner heading and the Gate
# MW verdict, then syntax-checked and proved to contain the renderer before any
# assertion depends on it — an unbalanced cut would otherwise render nothing and
# every case below would pass on empty output.
render_skipped() {
  local payload="$1" block
  block=$(sed -n '/^# Closing banner\. States what actually happened/,/^# Say what actually happened\./p' "$PRE_PUSH" | sed '$d')
  [ -n "$block" ] || { echo "EXTRACTION-EMPTY"; return 91; }
  printf '%s\n' "$block" > "$TEST_DIR/banner.sh"
  bash -n "$TEST_DIR/banner.sh" 2> "$TEST_DIR/blk.err" \
    || { echo "EXTRACTION-UNPARSEABLE: $(cat "$TEST_DIR/blk.err")"; return 92; }
  grep -q 'GATES_SKIPPED' "$TEST_DIR/banner.sh" \
    || { echo "EXTRACTION-MISSING-RENDERER"; return 93; }

  ( GATES_SKIPPED="$payload" bash "$TEST_DIR/banner.sh" )
}

@test "AC-599-06: the banner extraction parses and contains the renderer (anti-vacuity)" {
  block=$(sed -n '/^# Closing banner\. States what actually happened/,/^# Say what actually happened\./p' "$PRE_PUSH" | sed '$d')

  # The block must be found in the hook as it is — a cut that silently returns
  # nothing would make every other case pass on empty output.
  [ -n "$block" ]
  printf '%s\n' "$block" > "$TEST_DIR/banner.sh"
  bash -n "$TEST_DIR/banner.sh"
  grep -q 'GATES_SKIPPED' "$TEST_DIR/banner.sh"
}

@test "AC-599-06: a comma inside a skip reason does not become a second gate" {
  # The exact payload from the issue, observed on a real commit.
  run render_skipped "Gate MP: script not found, parity NOT verified|Gate M Python: gate-m.ts not found|"

  [ "$status" -eq 0 ]
  # One line per recorded skip, nothing more.
  entries=$(printf '%s\n' "$output" | grep -c '^     - ')
  [ "$entries" -eq 2 ] || {
    echo "expected 2 entries, got $entries:"
    printf '%s\n' "$output"
    return 1
  }
  # The invented gate must not appear as a standalone entry.
  if printf '%s\n' "$output" | grep -q '^     - parity NOT verified$'; then
    echo "the reason fragment was printed as its own gate:"
    printf '%s\n' "$output"
    return 1
  fi
  # The real entry keeps its full text, comma included.
  [[ "$output" == *"Gate MP: script not found, parity NOT verified"* ]]
}

@test "AC-599-06: several commas in one reason still yield one entry" {
  run render_skipped "Gate M: skipped, for reasons, a, b, c|Gate S: other|"

  [ "$status" -eq 0 ]
  entries=$(printf '%s\n' "$output" | grep -c '^     - ')
  [ "$entries" -eq 2 ]
  [[ "$output" == *"Gate M: skipped, for reasons, a, b, c"* ]]
}

@test "AC-599-06: an empty skip list still says ALL CHECKS PASSED" {
  run render_skipped ""

  [ "$status" -eq 0 ]
  [[ "$output" == *"ALL CHECKS PASSED"* ]]
  [[ "$output" != *"not every gate ran"* ]]
}

@test "AC-599-06: a single skip is named and the banner does not claim all passed" {
  run render_skipped "Gate MP: script not found|"

  [ "$status" -eq 0 ]
  [[ "$output" == *"not every gate ran"* ]]
  [[ "$output" != *"ALL CHECKS PASSED"* ]]
  [ "$(printf '%s\n' "$output" | grep -c '^     - ')" -eq 1 ]
}

@test "AC-599-06: a reason containing a pipe-free comma and trailing separator is handled" {
  # Trailing separator must be trimmed, not rendered as an empty entry.
  run render_skipped "Gate A: one, two|Gate B: three|"

  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c '^     - ')" -eq 2 ]
  # No blank or dash-only entries.
  if printf '%s\n' "$output" | grep -qE '^     - *$'; then
    echo "an empty entry was rendered:"
    printf '%s\n' "$output"
    return 1
  fi
}
