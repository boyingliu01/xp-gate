#!/usr/bin/env bats

# ============================================================================
# Issue #475: semgrep exit code 2 (operational error — ruleset fetch failure,
# network blip, unusable paths...) produced
#   "⚠️  semgrep exited with code 2 — skipping gate"
#   "⏭️  SKIPPED - SAST (semgrep runtime error)"
# with the captured semgrep output never shown, so the intermittent failure
# was unaactionable. Exit 2 must stay a SKIP (an operational error is not a
# security verdict) but the real cause must be printed.
#
# Also pins the no-weakening direction: exit 1 with a CRITICAL/HIGH finding
# still BLOCKS exactly as before.
# ============================================================================

SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

setup() {
  TEST_DIR=$(mktemp -d)
  PROJ="$TEST_DIR/proj"
  mkdir -p "$PROJ/src" "$PROJ/bin"
  printf '%s\n' 'export const a = 1' > "$PROJ/src/a.ts"

  git -C "$PROJ" init -q -b test-branch
  git -C "$PROJ" config user.email "test@test.com"
  git -C "$PROJ" config user.name "Test"
  git -C "$PROJ" add src/a.ts

  # gate-10.sh + prelude, run as a file (the CRITICAL branch exits 1).
  cat > "$TEST_DIR/run-gate10.sh" <<PRELUDE
#!/usr/bin/env bash
gate_start_ms() { echo 0; }
record_gate_audit() { :; }
PRELUDE
  cat "$SOURCE_GITHOOKS/gate-10.sh" >> "$TEST_DIR/run-gate10.sh"
  echo 'echo "FINAL_STATUS=$GATE_10_STATUS"' >> "$TEST_DIR/run-gate10.sh"
  chmod +x "$TEST_DIR/run-gate10.sh"

  # Stub semgrep: behaviour driven by SEMGREP_STUB_* env vars.
  cat > "$PROJ/bin/semgrep" <<'STUB'
#!/usr/bin/env bash
cat "$SEMGREP_STUB_OUTPUT"
exit "$SEMGREP_STUB_STATUS"
STUB
  chmod +x "$PROJ/bin/semgrep"

  cd "$PROJ"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

write_stub_output() {
  printf '%s\n' "$1" > "$TEST_DIR/semgrep-output.txt"
}

@test "Gate 10 exit 2 SKIPs but surfaces the real semgrep error (#475)" {
  write_stub_output "fatal: failed to download ruleset p/security-audit (connection reset)"
  SEMGREP_STUB_STATUS=2 SEMGREP_STUB_OUTPUT="$TEST_DIR/semgrep-output.txt" \
    PATH="$PROJ/bin:$PATH" run bash "$TEST_DIR/run-gate10.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"semgrep exited with code 2"* ]]
  [[ "$output" == *"semgrep said:"* ]]
  [[ "$output" == *"failed to download ruleset p/security-audit"* ]]
  [[ "$output" == *"SKIPPED - SAST (semgrep runtime error, see above)"* ]]
  [[ "$output" == *"FINAL_STATUS=SKIP"* ]]
}

@test "Gate 10 exit 1 with CRITICAL finding still BLOCKS (#475, no weakening)" {
  write_stub_output '{"results":[{"check_id":"x","path":"src/a.ts","start":{"line":1},"extra":{"severity":"CRITICAL","message":"sink"}}]}'
  SEMGREP_STUB_STATUS=1 SEMGREP_STUB_OUTPUT="$TEST_DIR/semgrep-output.txt" \
    PATH="$PROJ/bin:$PATH" run bash "$TEST_DIR/run-gate10.sh"

  echo "output: $output"
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED"* ]]
}

@test "Gate 10 exit 0 reports PASS (#475, unchanged happy path)" {
  write_stub_output '{"results":[]}'
  SEMGREP_STUB_STATUS=0 SEMGREP_STUB_OUTPUT="$TEST_DIR/semgrep-output.txt" \
    PATH="$PROJ/bin:$PATH" run bash "$TEST_DIR/run-gate10.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No security vulnerabilities found"* ]]
  [[ "$output" == *"FINAL_STATUS=PASS"* ]]
}
