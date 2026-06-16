#!/usr/bin/env bats

# Tests for sprint-gate.sh (Sprint Flow Enforcement Gate)
# REQ-1: Standalone sprint validation script called from pre-commit (Gate 10) and pre-push (Gate S)
#
# Test matrix:
#   - No .sprint-state/ → SKIP (not a sprint project)
#   - jq missing → WARN but ALLOW
#   - sprint-state.json missing → BLOCK
#   - sprint-state.json corrupt → BLOCK
#   - Phase 2 + no delphi-reviewed.json → BLOCK (pre-commit)
#   - Phase 2 + verdict != APPROVED → BLOCK (pre-commit)
#   - Phase 2 + verdict == APPROVED → PASS (pre-commit)
#   - Phase 1 (not BUILD) → PASS without delphi check (pre-commit)
#   - Pre-push: Phase 2+ without specification.yaml → BLOCK
#   - Pre-push: Phase 2+ with delphi not APPROVED → BLOCK
#   - Invalid arguments → usage error

setup() {
  # Create a temp git repo for each test
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  git commit --allow-empty -m "init" -q

  SPRINT_GATE="$BATS_TEST_DIRNAME/../sprint-gate.sh"
}

teardown() {
  rm -rf "$TEST_DIR"
}

# ── Argument validation ──────────────────────────────────────────────

@test "sprint-gate.sh exits with usage on no arguments" {
  run bash "$SPRINT_GATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "sprint-gate.sh exits with usage on invalid argument" {
  run bash "$SPRINT_GATE" --invalid
  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage:"* ]]
}

# ── Non-sprint project → SKIP ────────────────────────────────────────

@test "sprint-gate.sh --pre-commit SKIPs when no .sprint-state/" {
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 0 ]
  [[ "$output" == *"SKIPPED"* ]]
  [[ "$output" == *"not a sprint project"* ]]
}

@test "sprint-gate.sh --pre-push SKIPs when no .sprint-state/" {
  run bash "$SPRINT_GATE" --pre-push
  [ "$status" -eq 0 ]
  [[ "$output" == *"SKIPPED"* ]]
  [[ "$output" == *"not a sprint project"* ]]
}

# ── Missing sprint-state.json → BLOCK ────────────────────────────────

@test "sprint-gate.sh --pre-commit BLOCKs when sprint-state.json missing" {
  mkdir -p .sprint-state
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 1 ]
  [[ "$output" == *"SPRINT STATE MISSING"* ]]
}

# ── Corrupt sprint-state.json → BLOCK ────────────────────────────────

@test "sprint-gate.sh --pre-commit BLOCKs on corrupt JSON" {
  mkdir -p .sprint-state
  echo "not valid json{{{" > .sprint-state/sprint-state.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 1 ]
  [[ "$output" == *"SPRINT STATE CORRUPT"* ]]
}

# ── Phase 1 (not BUILD) → PASS without delphi check ─────────────────

@test "sprint-gate.sh --pre-commit PASSes in Phase 1 without delphi check" {
  mkdir -p .sprint-state
  echo '{"currentPhase":"1"}' > .sprint-state/sprint-state.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED"* ]]
  [[ "$output" == *"Gate 10"* ]]
}

# ── Phase 2 + no delphi-reviewed.json → BLOCK ────────────────────────

@test "sprint-gate.sh --pre-commit BLOCKs Phase 2 without delphi-reviewed.json" {
  mkdir -p .sprint-state
  echo '{"currentPhase":"2"}' > .sprint-state/sprint-state.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 1 ]
  [[ "$output" == *"DELPHI-REVIEW NOT COMPLETED"* ]]
}

# ── Phase 2 + delphi verdict != APPROVED → BLOCK ─────────────────────

@test "sprint-gate.sh --pre-commit BLOCKs Phase 2 with REJECTED verdict" {
  mkdir -p .sprint-state
  echo '{"currentPhase":"2"}' > .sprint-state/sprint-state.json
  echo '{"verdict":"REJECTED","mode":"design"}' > .sprint-state/delphi-reviewed.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 1 ]
  [[ "$output" == *"DELPHI-REVIEW NOT APPROVED"* ]]
  [[ "$output" == *"REJECTED"* ]]
}

# ── Phase 2 + delphi APPROVED → PASS ─────────────────────────────────

@test "sprint-gate.sh --pre-commit PASSes Phase 2 with APPROVED verdict" {
  mkdir -p .sprint-state
  echo '{"currentPhase":"2"}' > .sprint-state/sprint-state.json
  echo '{"verdict":"APPROVED","mode":"design","specification_path":"spec.yaml"}' > .sprint-state/delphi-reviewed.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED"* ]]
  [[ "$output" == *"Gate 10"* ]]
}

# ── Phase BUILD (string alias) → same as Phase 2 ─────────────────────

@test "sprint-gate.sh --pre-commit recognizes BUILD as Phase 2" {
  mkdir -p .sprint-state
  echo '{"currentPhase":"BUILD"}' > .sprint-state/sprint-state.json
  echo '{"verdict":"APPROVED","mode":"design"}' > .sprint-state/delphi-reviewed.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED"* ]]
}

# ── Pre-push: Phase 2+ without specification.yaml → BLOCK ────────────

@test "sprint-gate.sh --pre-push BLOCKs Phase 2 without specification.yaml" {
  mkdir -p .sprint-state
  echo '{"currentPhase":"2"}' > .sprint-state/sprint-state.json
  echo '{"verdict":"APPROVED","mode":"design"}' > .sprint-state/delphi-reviewed.json
  run bash "$SPRINT_GATE" --pre-push
  [ "$status" -eq 1 ]
  [[ "$output" == *"SPECIFICATION MISSING"* ]]
}

# ── Pre-push: Phase 2+ with specification.yaml + APPROVED → PASS ─────

@test "sprint-gate.sh --pre-push PASSes with spec + APPROVED" {
  mkdir -p .sprint-state/phase-outputs
  echo '{"currentPhase":"2"}' > .sprint-state/sprint-state.json
  echo '{"verdict":"APPROVED","mode":"design"}' > .sprint-state/delphi-reviewed.json
  echo "requirements: []" > .sprint-state/phase-outputs/specification.yaml
  run bash "$SPRINT_GATE" --pre-push
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED"* ]]
  [[ "$output" == *"Gate S"* ]]
}

# ── Pre-push: root-level specification.yaml also accepted ────────────

@test "sprint-gate.sh --pre-push accepts root-level specification.yaml" {
  mkdir -p .sprint-state
  echo '{"currentPhase":"3"}' > .sprint-state/sprint-state.json
  echo '{"verdict":"APPROVED","mode":"design"}' > .sprint-state/delphi-reviewed.json
  echo "requirements: []" > specification.yaml
  run bash "$SPRINT_GATE" --pre-push
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED"* ]]
}

# ── Pre-push: delphi not APPROVED → BLOCK ────────────────────────────

@test "sprint-gate.sh --pre-push BLOCKs with non-APPROVED delphi" {
  mkdir -p .sprint-state/phase-outputs
  echo '{"currentPhase":"2"}' > .sprint-state/sprint-state.json
  echo '{"verdict":"PENDING","mode":"design"}' > .sprint-state/delphi-reviewed.json
  echo "requirements: []" > .sprint-state/phase-outputs/specification.yaml
  run bash "$SPRINT_GATE" --pre-push
  [ "$status" -eq 1 ]
  [[ "$output" == *"DELPHI-REVIEW NOT APPROVED"* ]]
}

# ── Pre-push: Phase 0/1 → PASS without spec check ───────────────────

@test "sprint-gate.sh --pre-push PASSes Phase 0 without spec check" {
  mkdir -p .sprint-state
  echo '{"currentPhase":"0"}' > .sprint-state/sprint-state.json
  run bash "$SPRINT_GATE" --pre-push
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED"* ]]
}

# ── Corrupt delphi-reviewed.json → BLOCK ─────────────────────────────

@test "sprint-gate.sh --pre-commit BLOCKs on corrupt delphi-reviewed.json" {
  mkdir -p .sprint-state
  echo '{"currentPhase":"2"}' > .sprint-state/sprint-state.json
  echo "not json{{{" > .sprint-state/delphi-reviewed.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 1 ]
  [[ "$output" == *"DELPHI-REVIEW CORRUPT"* ]]
}
