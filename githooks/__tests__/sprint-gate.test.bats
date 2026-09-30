#!/usr/bin/env bats

# Tests for sprint-gate.sh (Sprint Flow Enforcement Gate)
# REQ-1: Standalone sprint validation script called from pre-commit (Gate 10) and pre-push (Gate S)
#
# Contract (JSON on stdout, exit code drives the hook):
#   - No .sprint-state/ → SKIP (not a sprint project)
#   - sprint-state.json missing → SKIP (non-sprint commit)
#   - sprint-state.json corrupt → SKIP (non-sprint commit)
#   - Phase >= 1 → delphi-reviewed.json required (pre-commit)
#   - Phase >= 1 + non-APPROVED verdict → DENY (pre-commit)
#   - Phase >= 1 + APPROVED verdict → ALLOW (pre-commit)
#   - Pre-push: non-sprint/* branch → SKIP
#   - Pre-push: sprint/* branch without delphi-reviewed.json → DENY
#   - Pre-push: sprint/* branch + APPROVED + specification.yaml → ALLOW
#   - Invalid arguments → usage error

setup() {
  # Create a temp git repo for each test
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  # Silence hooks that the host's global core.hooksPath may run on this commit
  git commit --allow-empty -m "init" -q >/dev/null 2>&1

  SPRINT_GATE="$BATS_TEST_DIRNAME/../sprint-gate.sh"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

has_json_parser() {
  command -v jq >/dev/null 2>&1 || command -v node >/dev/null 2>&1
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
  [[ "$output" == *'"decision":"skip"'* ]]
  [[ "$output" == *"not a sprint project"* ]]
}

@test "sprint-gate.sh --pre-push SKIPs when no .sprint-state/" {
  run bash "$SPRINT_GATE" --pre-push
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"skip"'* ]]
  [[ "$output" == *"not a sprint project"* ]]
}

# ── Missing sprint-state.json → SKIP (non-sprint commit) ─────────────

@test "sprint-gate.sh --pre-commit SKIPs when sprint-state.json missing" {
  mkdir -p .sprint-state
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"skip"'* ]]
  [[ "$output" == *"non-sprint commit"* ]]
}

# ── Corrupt sprint-state.json → SKIP (non-sprint commit) ─────────────

@test "sprint-gate.sh --pre-commit SKIPs on corrupt sprint-state.json" {
  mkdir -p .sprint-state
  echo "not valid json{{{" > .sprint-state/sprint-state.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"skip"'* ]]
  [[ "$output" == *"not valid JSON"* ]]
}

# ── Phase >= 1 + no delphi-reviewed.json → DENY ──────────────────────

@test "sprint-gate.sh --pre-commit BLOCKs phase 1 without delphi-reviewed.json" {
  mkdir -p .sprint-state
  echo '{"phase":1}' > .sprint-state/sprint-state.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 1 ]
  [[ "$output" == *'"decision":"deny"'* ]]
  [[ "$output" == *"delphi-review not APPROVED"* ]]
}

@test "sprint-gate.sh --pre-commit BLOCKs Phase 2 without delphi-reviewed.json" {
  mkdir -p .sprint-state
  echo '{"phase":2}' > .sprint-state/sprint-state.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 1 ]
  [[ "$output" == *'"decision":"deny"'* ]]
  [[ "$output" == *"delphi-review not APPROVED"* ]]
}

# ── Phase 2 + corrupt delphi-reviewed.json → DENY ────────────────────

@test "sprint-gate.sh --pre-commit BLOCKs on corrupt delphi-reviewed.json" {
  has_json_parser || skip "requires jq or node for JSON validation"
  mkdir -p .sprint-state
  echo '{"phase":2}' > .sprint-state/sprint-state.json
  echo "not json{{{" > .sprint-state/delphi-reviewed.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 1 ]
  [[ "$output" == *'"decision":"deny"'* ]]
  [[ "$output" == *"not valid JSON"* ]]
}

# ── Phase 2 + delphi verdict != APPROVED → DENY ──────────────────────

@test "sprint-gate.sh --pre-commit BLOCKs Phase 2 with REJECTED verdict" {
  has_json_parser || skip "requires jq or node for JSON validation"
  mkdir -p .sprint-state
  echo '{"phase":2}' > .sprint-state/sprint-state.json
  echo '{"verdict":"REJECTED","mode":"design"}' > .sprint-state/delphi-reviewed.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 1 ]
  [[ "$output" == *'"decision":"deny"'* ]]
  [[ "$output" == *"REJECTED"* ]]
}

# ── Phase 2 + delphi APPROVED → ALLOW ────────────────────────────────

@test "sprint-gate.sh --pre-commit PASSes Phase 2 with APPROVED verdict" {
  has_json_parser || skip "requires jq or node for JSON validation"
  mkdir -p .sprint-state
  echo '{"phase":2}' > .sprint-state/sprint-state.json
  echo '{"verdict":"APPROVED","mode":"design"}' > .sprint-state/delphi-reviewed.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"allow"'* ]]
  [[ "$output" == *"delphi-review APPROVED"* ]]
}

# ── Non-numeric phase → pre-PLAN path (no delphi enforcement) ────────

@test "sprint-gate.sh --pre-commit allows non-numeric phase via pre-PLAN path" {
  has_json_parser || skip "requires jq or node for JSON validation"
  mkdir -p .sprint-state
  echo '{"phase":"BUILD"}' > .sprint-state/sprint-state.json
  run bash "$SPRINT_GATE" --pre-commit
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"allow"'* ]]
  [[ "$output" == *"pre-PLAN"* ]]
}

# ── Pre-push: non-sprint branch → SKIP ───────────────────────────────

@test "sprint-gate.sh --pre-push SKIPs on a non-sprint branch" {
  mkdir -p .sprint-state
  echo '{"phase":2}' > .sprint-state/sprint-state.json
  run bash "$SPRINT_GATE" --pre-push
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"skip"'* ]]
  [[ "$output" == *"does not match sprint/*"* ]]
}

# ── Pre-push: sprint/* branch without delphi-reviewed.json → DENY ────

@test "sprint-gate.sh --pre-push BLOCKs sprint branch without delphi-reviewed.json" {
  git checkout -q -b sprint/test-1
  mkdir -p .sprint-state
  echo '{"phase":2}' > .sprint-state/sprint-state.json
  run bash "$SPRINT_GATE" --pre-push
  [ "$status" -eq 1 ]
  [[ "$output" == *'"decision":"deny"'* ]]
  [[ "$output" == *"delphi-reviewed.json not found"* ]]
}

# ── Pre-push: sprint/* branch + APPROVED but no spec → DENY ──────────

@test "sprint-gate.sh --pre-push BLOCKs Phase 2 without specification.yaml" {
  has_json_parser || skip "requires jq or node for JSON validation"
  git checkout -q -b sprint/test-1
  mkdir -p .sprint-state
  echo '{"phase":2}' > .sprint-state/sprint-state.json
  echo '{"verdict":"APPROVED","mode":"design"}' > .sprint-state/delphi-reviewed.json
  run bash "$SPRINT_GATE" --pre-push
  [ "$status" -eq 1 ]
  [[ "$output" == *'"decision":"deny"'* ]]
  [[ "$output" == *"specification.yaml not found"* ]]
}

# ── Pre-push: sprint/* branch + spec + APPROVED → PASS ───────────────

@test "sprint-gate.sh --pre-push PASSes with spec + APPROVED" {
  has_json_parser || skip "requires jq or node for JSON validation"
  git checkout -q -b sprint/test-1
  mkdir -p .sprint-state/phase-outputs
  echo '{"phase":2}' > .sprint-state/sprint-state.json
  echo '{"verdict":"APPROVED","mode":"design"}' > .sprint-state/delphi-reviewed.json
  echo "requirements: []" > .sprint-state/phase-outputs/specification.yaml
  run bash "$SPRINT_GATE" --pre-push
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"allow"'* ]]
  [[ "$output" == *"sprint push validated"* ]]
}

# ── Pre-push: root-level specification.yaml also accepted ────────────

@test "sprint-gate.sh --pre-push accepts root-level specification.yaml" {
  has_json_parser || skip "requires jq or node for JSON validation"
  git checkout -q -b sprint/test-1
  mkdir -p .sprint-state
  echo '{"phase":3}' > .sprint-state/sprint-state.json
  echo '{"verdict":"APPROVED","mode":"design"}' > .sprint-state/delphi-reviewed.json
  echo "requirements: []" > specification.yaml
  run bash "$SPRINT_GATE" --pre-push
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"allow"'* ]]
}

# ── Pre-push: delphi not APPROVED → DENY ─────────────────────────────

@test "sprint-gate.sh --pre-push BLOCKs with non-APPROVED delphi" {
  has_json_parser || skip "requires jq or node for JSON validation"
  git checkout -q -b sprint/test-1
  mkdir -p .sprint-state/phase-outputs
  echo '{"phase":2}' > .sprint-state/sprint-state.json
  echo '{"verdict":"PENDING","mode":"design"}' > .sprint-state/delphi-reviewed.json
  echo "requirements: []" > .sprint-state/phase-outputs/specification.yaml
  run bash "$SPRINT_GATE" --pre-push
  [ "$status" -eq 1 ]
  [[ "$output" == *'"decision":"deny"'* ]]
  [[ "$output" == *"not APPROVED"* ]]
}

# ── pre-commit SPRINT_GATE_SCRIPT resolution ─────────────────────────
# The resolution block is extracted verbatim so the real logic runs in-test
# (same pattern as the GIT CONTEXT FALLBACK tests in adapter-common.test.bats).

extract_sprint_gate_resolution() {
  awk '
/^# BEGIN SPRINT_GATE_SCRIPT RESOLUTION$/ { capture = 1; next }
/^# END SPRINT_GATE_SCRIPT RESOLUTION$/ { capture = 0 }
    capture
  ' "$BATS_TEST_DIRNAME/../pre-commit"
}

@test "pre-commit resolution: GATE_DIR wins when sprint-gate.sh exists everywhere" {
  mkdir -p hooks gatedir githooks
  touch hooks/sprint-gate.sh gatedir/sprint-gate.sh githooks/sprint-gate.sh
  SCRIPT_DIR="hooks"
  GATE_DIR="gatedir"
  SPRINT_GATE_SCRIPT=""
  eval "$(extract_sprint_gate_resolution)"
  [ "$SPRINT_GATE_SCRIPT" = "$GATE_DIR/sprint-gate.sh" ]
}

@test "pre-commit resolution: repo-root githooks beats the SCRIPT_DIR hooks dir" {
  mkdir -p hooks gatedir githooks
  touch hooks/sprint-gate.sh githooks/sprint-gate.sh
  SCRIPT_DIR="hooks"
  GATE_DIR="gatedir"
  SPRINT_GATE_SCRIPT=""
  eval "$(extract_sprint_gate_resolution)"
  [ "$SPRINT_GATE_SCRIPT" = "$(git rev-parse --show-toplevel)/githooks/sprint-gate.sh" ]
}

@test "pre-commit resolution: SCRIPT_DIR hooks dir is the last resort" {
  mkdir -p hooks gatedir
  touch hooks/sprint-gate.sh
  SCRIPT_DIR="hooks"
  GATE_DIR="gatedir"
  SPRINT_GATE_SCRIPT=""
  eval "$(extract_sprint_gate_resolution)"
  [ "$SPRINT_GATE_SCRIPT" = "$SCRIPT_DIR/sprint-gate.sh" ]
}

@test "pre-commit resolution: stays empty when sprint-gate.sh is absent everywhere" {
  mkdir -p hooks gatedir
  SCRIPT_DIR="hooks"
  GATE_DIR="gatedir"
  SPRINT_GATE_SCRIPT=""
  eval "$(extract_sprint_gate_resolution)"
  [ -z "$SPRINT_GATE_SCRIPT" ]
}

@test "npm mirror pre-commit stays byte-identical to the canonical hook" {
  cmp -s "$BATS_TEST_DIRNAME/../pre-commit" "$BATS_TEST_DIRNAME/../../src/npm-package/hooks/pre-commit"
}
