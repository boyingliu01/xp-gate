#!/usr/bin/env bats

# ============================================================================
# Gate 3/4 Bash Parsing Edge Case Tests
# Verifies that complexity warning counts and principles checker counts
# are properly sanitized for integer comparison.
# ============================================================================

setup() {
  TEST_DIR=$(mktemp -d)
  cd "$TEST_DIR"
}

teardown() {
  rm -rf "$TEST_DIR"
}

# ============================================================================
# Gate 3: Lizard CC_WARNINGS parsing tests
# Bug: lizard table header contains "Rt" which gets parsed as warning count
# ============================================================================

@test "Gate 3: CC_WARNINGS parses numeric value from lizard summary" {
  # Simulate lizard output with proper "Warning cnt" line
  CC_OUTPUT="
  NLOC    CCN   token  PARAM  length  location
      10     2      30      1       5  foo@1-5
1 file analyzed.
==============================================================
Warning cnt   3
"
  CC_WARNINGS=$(echo "$CC_OUTPUT" | grep "Warning cnt" | awk '{print $NF}' | tr -d '[:space:]' || echo "0")
  CC_WARNINGS=${CC_WARNINGS:-0}

  # Must be numeric
  [[ "$CC_WARNINGS" =~ ^[0-9]+$ ]]
  [[ "$CC_WARNINGS" -eq 3 ]]
}

@test "Gate 3: CC_WARNINGS defaults to 0 when no Warning cnt line" {
  CC_OUTPUT="
  NLOC    CCN   token  PARAM  length  location
      10     2      30      1       5  foo@1-5
1 file analyzed.
"
  CC_WARNINGS=$(echo "$CC_OUTPUT" | grep "Warning cnt" | awk '{print $NF}' | tr -d '[:space:]' || echo "0")
  CC_WARNINGS=${CC_WARNINGS:-0}
  # If grep fails, CC_WARNINGS should be empty or "0"
  # After our fix with sed sanitization:
  CC_WARNINGS=$(echo "$CC_WARNINGS" | sed 's/[^0-9]//g')
  CC_WARNINGS=${CC_WARNINGS:-0}

  [[ "$CC_WARNINGS" =~ ^[0-9]+$ ]]
  [[ "$CC_WARNINGS" -eq 0 ]]
}

@test "Gate 3: CC_WARNINGS rejects non-numeric table header artifacts" {
  # Simulate lizard output where grep matches header row containing "Rt"
  CC_OUTPUT="
  NLOC    CCN   token  PARAM  length  Rt
      10     2      30      1       5  foo@1-5
Warning cnt   5
"
  # Current broken behavior: grep matches first line too
  RAW_WARNINGS=$(echo "$CC_OUTPUT" | grep "Warning cnt\|Rt" | awk '{print $NF}' | tr -d '[:space:]' | head -1)

  # Our fix: only extract lines that start with "Warning cnt"
  CC_WARNINGS=$(echo "$CC_OUTPUT" | grep "^Warning cnt" | awk '{print $NF}' | tr -d '[:space:]' || echo "0")
  CC_WARNINGS=$(echo "$CC_WARNINGS" | sed 's/[^0-9]//g')
  CC_WARNINGS=${CC_WARNINGS:-0}

  [[ "$CC_WARNINGS" =~ ^[0-9]+$ ]]
  [[ "$CC_WARNINGS" -eq 5 ]]
}

# ============================================================================
# Gate 4: Principles checker ERROR_COUNT/WARNING_COUNT parsing tests
# Bug: grep -c returns exit code 1 on zero matches, causing "0\n0" from || echo
# ============================================================================

@test "Gate 4: ERROR_COUNT handles grep -c returning 0 matches" {
  # Simulate principles output with no errors
  PRINCIPLES_OUTPUT='{"violations":[],"summary":{"errorCount":0}}'
  echo "$PRINCIPLES_OUTPUT" > /tmp/test-principles.json

  # Broken: grep -c returns "0" AND exit code 1, so || echo "0" adds second "0"
  # BROKEN_COUNT=$(grep -c '"severity":"error"' /tmp/test-principles.json 2>/dev/null || echo "0")
  # [[ "$BROKEN_COUNT" == "0" ]] || true  # Would be "0\n0"

  # Fixed: use a subshell that always succeeds
  ERROR_COUNT=$(grep -c '"severity":"error"' /tmp/test-principles.json 2>/dev/null || true)
  ERROR_COUNT=${ERROR_COUNT:-0}

  [[ "$ERROR_COUNT" =~ ^[0-9]+$ ]]
  [[ "$ERROR_COUNT" -eq 0 ]]

  rm -f /tmp/test-principles.json
}

@test "Gate 4: ERROR_COUNT correctly counts multiple errors" {
  PRINCIPLES_OUTPUT='{"violations":[
    {"severity":"error","ruleId":"solid.srp"},
    {"severity":"error","ruleId":"clean-code.long-function"},
    {"severity":"warning","ruleId":"clean-code.god-class"}
  ]}'
  echo "$PRINCIPLES_OUTPUT" > /tmp/test-principles.json

  ERROR_COUNT=$(grep -c '"severity":"error"' /tmp/test-principles.json 2>/dev/null || true)
  ERROR_COUNT=${ERROR_COUNT:-0}

  [[ "$ERROR_COUNT" =~ ^[0-9]+$ ]]
  [[ "$ERROR_COUNT" -eq 2 ]]

  rm -f /tmp/test-principles.json
}

@test "Gate 4: WARNING_COUNT handles empty violations" {
  PRINCIPLES_OUTPUT='{"violations":[]}'
  echo "$PRINCIPLES_OUTPUT" > /tmp/test-principles.json

  WARNING_COUNT=$(grep -c '"severity":"warning"' /tmp/test-principles.json 2>/dev/null || true)
  WARNING_COUNT=${WARNING_COUNT:-0}

  [[ "$WARNING_COUNT" =~ ^[0-9]+$ ]]
  [[ "$WARNING_COUNT" -eq 0 ]]

  rm -f /tmp/test-principles.json
}
