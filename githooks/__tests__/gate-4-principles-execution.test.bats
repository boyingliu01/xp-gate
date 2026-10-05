#!/usr/bin/env bats

# ============================================================================
# Issue #478: Gate 4 reports "Principles checker execution failed -> SKIPPED"
# for a perfectly healthy checker in single-language-subdirectory mode, and
# (worse) treats the checker's own exit 1 ("ran with violations") as a crash —
# which made the ERROR_COUNT / BLOCK branch unreachable and silently skipped
# working checks.
#
# Three layered root causes, all covered here:
#   1. path basis: CHANGED_FILES is repo-root-relative but the checker resolved
#      paths against the subdir CWD -> "Analysis failed: Could not read file"
#   2. exit-code contract: src/principles/index.ts exits 1 when
#      summary.totalViolations > 0; the gate's `if run_tsx` mapped that to
#      "execution failed" (SKIP) instead of parsing the JSON
#   3. stderr was discarded (2>/dev/null) so the real cause was invisible
#
# Fix: run from PROJECT_ROOT, discriminate crash (no JSON) from findings
# (valid JSON, any exit 0/1), BLOCK on severity error, keep the failure guard
# for genuine crashes but surface stderr.
# ============================================================================

SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

setup() {
  TEST_DIR=$(mktemp -d)
  PROJ="$TEST_DIR/proj"
  mkdir -p "$PROJ/web/src" "$PROJ/bin"
  printf '%s\n' 'export const a = 1' > "$PROJ/web/src/a.ts"

  # gate-4.sh + prelude, run as a FILE so the BLOCK branch's `exit 1` is
  # capturable and never kills the test shell.
  cat > "$TEST_DIR/run-gate4.sh" <<PRELUDE
#!/usr/bin/env bash
PROJECT_ROOT="$PROJ"
PROJECT_LANG="typescript"
CHANGED_FILES="web/src/a.ts"
gate_start_ms() { echo 0; }
record_gate_audit() { :; }
run_tsx() {
  { echo "CWD=\$(pwd)"; echo "ARGS=\$*"; } >> "$TEST_DIR/run-tsx.log"
  case "\${PRINCIPLES_STUB_MODE:-clean}" in
    clean)
      echo '{ "violations": [], "summary": { "totalViolations": 0 } }'
      exit 0
      ;;
    warnings)
      printf '%s\n' '{ "violations": [ { "severity": "warning" } ], "summary": { "totalViolations": 1 } }'
      exit 1
      ;;
    errors)
      printf '%s\n' '{ "violations": [ { "severity": "error" } ], "summary": { "totalViolations": 1 } }'
      exit 1
      ;;
    crash)
      echo "Analysis failed: Could not read file: web/src/a.ts" >&2
      exit 1
      ;;
  esac
}
PRELUDE
  cat "$SOURCE_GITHOOKS/gate-4.sh" >> "$TEST_DIR/run-gate4.sh"
  echo 'echo "FINAL_STATUS=$GATE_4_STATUS"' >> "$TEST_DIR/run-gate4.sh"
  chmod +x "$TEST_DIR/run-gate4.sh"

  # Simulate the single-language-subdir mode: CWD is web/, not the repo root.
  cd "$PROJ/web"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

@test "Gate 4 runs the checker from the repo root so subdir-mode paths resolve (#478)" {
  PRINCIPLES_STUB_MODE=clean run bash "$TEST_DIR/run-gate4.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED - Principles checker"* ]]
  [[ "$output" == *"FINAL_STATUS=PASS"* ]]

  # The checker must have run with CWD = repo root, not web/.
  run grep -F "CWD=$PROJ" "$TEST_DIR/run-tsx.log"
  [ "$status" -eq 0 ]
  run grep -F "ARGS=" "$TEST_DIR/run-tsx.log"
  [[ "$output" == *"web/src/a.ts"* ]]
}

@test "Gate 4 BLOCKS on error-severity violations instead of skipping (#478)" {
  PRINCIPLES_STUB_MODE=errors run bash "$TEST_DIR/run-gate4.sh"

  echo "output: $output"
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED - 1 principle ERROR(S) found"* ]]
  [[ "$output" != *"execution issue"* ]]
}

@test "Gate 4 reports warnings as PASS-with-warning, not as an execution crash (#478)" {
  PRINCIPLES_STUB_MODE=warnings run bash "$TEST_DIR/run-gate4.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED - Principles checker"* ]]
  [[ "$output" == *"1 warnings found"* ]]
  [[ "$output" != *"execution issue"* ]]
}

@test "Gate 4 keeps the crash guard for genuine failures and surfaces stderr (#478)" {
  PRINCIPLES_STUB_MODE=crash run bash "$TEST_DIR/run-gate4.sh"

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Principles checker execution failed"* ]]
  [[ "$output" == *"SKIPPED - Principles check (execution issue)"* ]]
  # The real cause must be visible instead of discarded.
  [[ "$output" == *"Could not read file: web/src/a.ts"* ]]
}
