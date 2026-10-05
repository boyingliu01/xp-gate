#!/usr/bin/env bats

# ============================================================================
# Issue #476: Gate 11 misreported "sprint-gate.sh not found" while the file
# sat in the canonical install dir, and its output (the raw decision JSON or
# the skip line) printed straight under the Gate 10 heading with no banner of
# its own — the two gates looked like one garbled block (#475 observed the
# same mixing).
#
# Layered conclusions this suite pins down:
#   - sprint-gate.sh's "not a sprint project" skip is by design
#     (sprint-gate.sh:63-66) — translated into a Gate 11 human line, not
#     silenced and not left as anonymous JSON
#   - deny stays a hard block (exit 1), including a defensive deny-with-exit-0
#   - the not-found message lists the searched locations instead of a bare
#     "not found", and the resolution chain gained an explicit
#     ~/.config/xp-gate/hooks/ tier
#   - Gate 11 prints its own banner so its output cannot be mistaken for
#     Gate 10's
# ============================================================================

SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"
PRE_COMMIT="$SOURCE_GITHOOKS/pre-commit"

setup() {
  TEST_DIR=$(mktemp -d)
  PROJ="$TEST_DIR/proj"
  GATEDIR="$TEST_DIR/gatedir"
  mkdir -p "$PROJ" "$GATEDIR" "$TEST_DIR/fakehome"

  git -C "$PROJ" init -q -b test-branch
  git -C "$PROJ" config user.email "test@test.com"
  git -C "$PROJ" config user.name "Test"

  # Extract the whole Gate 11 block (banner + resolution + dispatch + timing).
  sed -n '/echo "→ Gate 11: Sprint Flow enforcement/,/^echo "✅ Gate 11 completed in/p' \
    "$PRE_COMMIT" > "$TEST_DIR/gate11-block.sh"
  [ -s "$TEST_DIR/gate11-block.sh" ]

  cat > "$TEST_DIR/run-gate11.sh" <<PRELUDE
#!/usr/bin/env bash
PROJECT_ROOT="$PROJ"
GATE_DIR="$GATEDIR"
SCRIPT_DIR="$TEST_DIR/scriptdir-empty"
HOME="$TEST_DIR/fakehome"
record_gate_audit() { :; }
PRELUDE
  cat "$TEST_DIR/gate11-block.sh" >> "$TEST_DIR/run-gate11.sh"
  chmod +x "$TEST_DIR/run-gate11.sh"

  cd "$PROJ"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

install_sprint_gate() {
  cat > "$GATEDIR/sprint-gate.sh" <<STUB
#!/usr/bin/env bash
cat <<'JSON'
$1
JSON
exit $2
STUB
  chmod +x "$GATEDIR/sprint-gate.sh"
}

@test "Gate 11 translates the skip verdict into a human line (no raw JSON leak) (#476)" {
  install_sprint_gate '{"decision":"skip","reason":"not a sprint project"}' 0
  run bash "$TEST_DIR/run-gate11.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SKIPPED - Gate 11: Sprint Flow (not a sprint project)"* ]]
  [[ "$output" != *"sprint-gate.sh not found"* ]]
  # The banner must attribute the output to Gate 11 (mixes-with-10 fix #475).
  [[ "$output" == *"Gate 11: Sprint Flow enforcement"* ]]
}

@test "Gate 11 allow verdict reports PASS (#476)" {
  install_sprint_gate '{"decision":"allow"}' 0
  run bash "$TEST_DIR/run-gate11.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED - Gate 11: Sprint Flow enforcement"* ]]
}

@test "Gate 11 deny verdict stays a hard block (#476, no gate weakening)" {
  install_sprint_gate '{"decision":"deny","reason":"delphi-review missing"}' 1
  run bash "$TEST_DIR/run-gate11.sh"

  echo "output: $output"
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED - Gate 11: Sprint Flow Enforcement"* ]]
  [[ "$output" == *"delphi-review missing"* ]]
}

@test "Gate 11 deny printed with exit 0 still blocks (defensive) (#476)" {
  install_sprint_gate '{"decision":"deny","reason":"verdict is not APPROVED"}' 0
  run bash "$TEST_DIR/run-gate11.sh"

  echo "output: $output"
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED - Gate 11: Sprint Flow Enforcement"* ]]
}

@test "Gate 11 not-found message lists the searched locations (#476)" {
  # No sprint-gate.sh in GATE_DIR, SCRIPT_DIR, repo githooks/ or fake HOME.
  run bash "$TEST_DIR/run-gate11.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"sprint-gate.sh not found"* ]]
  [[ "$output" == *"searched:"* ]]
  [[ "$output" == *"~/.config/xp-gate/hooks/"* ]]
}

@test "Gate 11 resolution gains an explicit ~/.config/xp-gate/hooks/ tier (static)" {
  run grep -F 'SPRINT_GATE_SCRIPT="$HOME/.config/xp-gate/hooks/sprint-gate.sh"' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
  # And the banner exists in both shipped copies.
  run grep -F 'Gate 11: Sprint Flow enforcement' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
  run grep -F 'Gate 11: Sprint Flow enforcement' "$BATS_TEST_DIRNAME/../../src/npm-package/hooks/pre-commit"
  [ "$status" -eq 0 ]
}
