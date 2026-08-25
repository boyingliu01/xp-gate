#!/usr/bin/env bats

# @test REQ-TDD-004
# @intent Verify Gate M2 threshold adjustment behavior
# @covers AC-TDD-002-01 through AC-TDD-002-10
#
# Test matrix:
#   - Mock density 29% → PASS (below 30% threshold)
#   - Mock density 35% without annotation → WARNING (Phase 1)
#   - Mock density 35% with @mock-justified → PASS
#   - Mock density 55% without annotation → WARNING (Phase 1)
#   - .mockpolicyrc custom threshold 40% → uses 40%
#   - No test files in push → SKIPPED
#   - @mock-justified with short reason (< 10 chars) → WARNING
#   - Mock density exactly at threshold (30%) → PASS
#   - Multiple test files, one over threshold → WARNING for that file
#   - Phase 1 mode — no blocking even at high density

# Resolve source repo
SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

setup() {
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"
  git config core.hooksPath .git/hooks

  # Create mock jscpd so Gate 2 doesn't block on missing tool
  mkdir -p "$TEST_DIR/bin"
  cat > "$TEST_DIR/bin/jscpd" << 'MOCK'
#!/bin/bash
echo '{"duplicates":[]}'
exit 0
MOCK
  chmod +x "$TEST_DIR/bin/jscpd"
  export PATH="$TEST_DIR/bin:$PATH"

  # Copy pre-push hook
  mkdir -p .git/hooks
  cp "$SOURCE_GITHOOKS/pre-push" .git/hooks/pre-push
  chmod +x .git/hooks/pre-push
  mkdir -p .git/hooks/lib
  cp "$SOURCE_GITHOOKS/lib/validate-code-walkthrough.cjs" .git/hooks/lib/validate-code-walkthrough.cjs
  # adapter-common.sh is sourced by pre-push at Gate M
  cp "$SOURCE_GITHOOKS/adapter-common.sh" .git/hooks/adapter-common.sh 2>/dev/null || true

  # Create initial commit (no test files — clean baseline for diff-tree)
  echo "init" > README.md
  git add . && git commit -q -m "init"

  # Create walkthrough result file so Delphi validator doesn't block
  # This is required by the pre-push hook's code-walkthrough section (lines 516-537)
  local current_sha
  current_sha="$(git rev-parse HEAD)"
  cat > .code-walkthrough-result.json << EOF
{
  "commit": "$current_sha",
  "verdict": "APPROVED",
  "timestamp": "$(date -u -d '-1 minute' +%Y-%m-%dT%H:%M:%SZ)",
  "expires": "$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)",
  "branch": "test-branch",
  "consensus_ratio": 0.95,
  "experts": [
    {"role":"architecture","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-a","resolved_model":"model-a"},
    {"role":"technical","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-b","resolved_model":null},
    {"role":"feasibility","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-c","resolved_model":"model-c"}
  ]
}
EOF
}

teardown() {
  rm -rf "$TEST_DIR"
}

# Helper: create a test file with specific mock density
# Generates non-comment code lines + mock lines so that
# mock_count / (code_lines + mock_lines) = mock_lines / total_lines
# Comments and empty lines are excluded from the denominator by the hook.
create_test_file_with_density() {
  local file=$1
  local mock_lines=$2
  local total_lines=$3
  local code_lines=$((total_lines - mock_lines))
  mkdir -p "$(dirname "$file")"
  # Generate non-mock code lines (not comments — comments are excluded from denominator)
  local i
  for i in $(seq 1 "$code_lines"); do
    echo "const code_line_$i = $i;" >> "$file"
  done
  # Generate mock lines (each contains exactly one mock keyword match)
  for i in $(seq 1 "$mock_lines"); do
    echo "jest.mock('module$i');" >> "$file"
  done
}

# Helper: run pre-push with simulated ref info (new-branch scenario)
# Pipes stdin so the hook's `while read` loop gets valid ref data.
# Creates a fresh .code-walkthrough-result.json matching current HEAD
# so the Delphi validator doesn't block (required by lines 516-537 of pre-push).
run_pre_push() {
  local local_sha
  local_sha="$(git rev-parse HEAD)"
  local zeros="0000000000000000000000000000000000000000"
  # Write walkthrough result with current HEAD so Delphi validator passes
  cat > .code-walkthrough-result.json << EOF
{
  "commit": "$local_sha",
  "verdict": "APPROVED",
  "timestamp": "$(date -u -d '-1 minute' +%Y-%m-%dT%H:%M:%SZ)",
  "expires": "$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)",
  "branch": "test-branch",
  "consensus_ratio": 0.95,
  "experts": [
    {"role":"architecture","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-a","resolved_model":"model-a"},
    {"role":"technical","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-b","resolved_model":null},
    {"role":"feasibility","verdict":"APPROVED","result_type":"delphi_expert_result","requested_model":"model-c","resolved_model":"model-c"}
  ]
}
EOF
  run bash -c "echo 'refs/heads/main $local_sha refs/heads/main $zeros' | .git/hooks/pre-push origin https://example.com"
}

# ── AC-TDD-002-01: Mock density 29% → PASS ───────────────────────────

@test "mock density 29% PASSES (below 30% threshold)" {
  create_test_file_with_density "src/foo.test.ts" 29 100
  git add src/foo.test.ts && git commit -q -m "add test"
  run_pre_push
  [ "$status" -eq 0 ]
  [[ "$output" == *"within"* ]] || [[ "$output" == *"acceptable"* ]] || [[ "$output" == *"29."* ]]
}

# ── AC-TDD-002-02: Mock density 35% without annotation → WARNING ─────

@test "mock density 35% without annotation WARNS in Phase 1" {
  create_test_file_with_density "src/foo.test.ts" 35 100
  git add src/foo.test.ts && git commit -q -m "add test"
  run_pre_push
  [ "$status" -eq 0 ]  # Phase 1: WARNING only, no block
  [[ "$output" == *"WARNING"* ]]
}

# ── AC-TDD-002-03: Mock density 35% with @mock-justified → PASS ──────

@test "mock density 35% with @mock-justified PASSES" {
  create_test_file_with_density "src/foo.test.ts" 35 100
  echo "// @mock-justified: This test requires extensive mocking of external APIs and services" >> "src/foo.test.ts"
  git add src/foo.test.ts && git commit -q -m "add test"
  run_pre_push
  [ "$status" -eq 0 ]
  [[ "$output" == *"justified"* ]]
}

# ── AC-TDD-002-04: Mock density 55% without annotation → WARNING ─────

@test "mock density 55% without annotation WARNS in Phase 1" {
  create_test_file_with_density "src/foo.test.ts" 55 100
  git add src/foo.test.ts && git commit -q -m "add test"
  run_pre_push
  [ "$status" -eq 0 ]  # Phase 1: WARNING only
  [[ "$output" == *"WARNING"* ]]
}

# ── AC-TDD-002-05: .mockpolicyrc custom threshold 40% ────────────────

@test ".mockpolicyrc mock-threshold: 40 changes threshold to 40%" {
  echo '{"mock-threshold": 40}' > .mockpolicyrc
  create_test_file_with_density "src/foo.test.ts" 35 100
  git add .mockpolicyrc src/foo.test.ts && git commit -q -m "add config and test"
  run_pre_push
  [ "$status" -eq 0 ]
  # 35% is within the custom 40% threshold → should show within/pass
  [[ "$output" == *"40%"* ]] || [[ "$output" == *"within"* ]] || [[ "$output" == *"35."* ]]
}

# ── AC-TDD-002-06: No test files in push → SKIPPED ───────────────────

@test "no test files in push SKIPS mock density check" {
  # Only add a non-test source file
  mkdir -p src
  echo "export const x = 1;" > src/foo.ts
  git add src/foo.ts && git commit -q -m "add source"
  run_pre_push
  # Gate M2 should be skipped (no test files)
  [[ "$output" == *"SKIPPED"* ]] || [[ "$output" == *"no test files"* ]]
}

# ── AC-TDD-002-07: @mock-justified with short reason → WARNING ───────

@test "@mock-justified with short reason still WARNS" {
  create_test_file_with_density "src/foo.test.ts" 35 100
  # Reason < 10 chars — does NOT satisfy the min-length requirement
  echo "// @mock-justified: short" >> "src/foo.test.ts"
  git add src/foo.test.ts && git commit -q -m "add test"
  run_pre_push
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARNING"* ]]
}

# ── AC-TDD-002-08: Mock density exactly at threshold (30%) → PASS ────

@test "mock density exactly 30% PASSES (threshold is >)" {
  create_test_file_with_density "src/foo.test.ts" 30 100
  git add src/foo.test.ts && git commit -q -m "add test"
  run_pre_push
  [ "$status" -eq 0 ]
  # 30% is NOT > 30%, so it passes
  [[ "$output" == *"within"* ]] || [[ "$output" == *"acceptable"* ]] || [[ "$output" == *"30."* ]] || [[ "$output" == *"30%"* ]]
}

# ── AC-TDD-002-09: Multiple test files, one over threshold ───────────

@test "multiple test files with one over threshold WARNS for that file" {
  create_test_file_with_density "src/foo.test.ts" 10 100
  create_test_file_with_density "src/bar.test.ts" 40 100
  git add src/foo.test.ts src/bar.test.ts && git commit -q -m "add tests"
  run_pre_push
  [ "$status" -eq 0 ]
  [[ "$output" == *"bar.test.ts"* ]]
  [[ "$output" == *"WARNING"* ]]
}

# ── AC-TDD-002-10: Phase 1 — no blocking even at high density ────────

@test "Phase 1 WARNING mode does NOT block even at 80% density" {
  create_test_file_with_density "src/foo.test.ts" 80 100
  git add src/foo.test.ts && git commit -q -m "add test"
  run_pre_push
  [ "$status" -eq 0 ]  # Must NOT block in Phase 1
  [[ "$output" == *"WARNING"* ]]
  [[ "$output" != *"BLOCKED"* ]]
}
