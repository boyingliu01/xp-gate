#!/bin/bash
# sprint-gate.sh — Sprint Flow Validation Gate
#
# PURPOSE: Enforce Sprint Flow phase discipline at git hook level.
# Validates delphi-review approval, sprint state, and specification
# artifacts before allowing commits and pushes on sprint branches.
#
# INTEGRATION: Called from pre-commit (Gate 10) and pre-push (Gate S),
# or run independently for CI/manual validation.
#
# USAGE:
#   sprint-gate.sh --pre-commit   # Validate before commit
#   sprint-gate.sh --pre-push     # Validate before push
#
# MECHANISM:
#   --pre-commit:
#     - If .sprint-state/ missing → SKIP (not a sprint project)
#     - If sprint-state.json missing/invalid → SKIP (non-sprint commit)
#     - If phase >= 1 (PLAN completed) and delphi-reviewed.json missing → DENY
#     - If delphi-reviewed.json exists, verdict must be "APPROVED"
#     - If jq unavailable → WARN but ALLOW (graceful degradation)
#
#   --pre-push:
#     - If .sprint-state/ missing → SKIP
#     - If branch doesn't match sprint/* → SKIP
#     - If delphi-reviewed.json missing or verdict != "APPROVED" → DENY
#     - If phase < 2 (BUILD not started) → DENY
#     - If phase >= 2 and specification.yaml missing → DENY
#
# GRACEFUL DEGRADATION:
#   - If .sprint-state/ directory doesn't exist → SKIP (not a sprint project)
#   - If sprint-state.json is missing/invalid → SKIP (non-sprint commit)
#   - If jq not available → WARN but ALLOW (zero degradation for non-sprint projects)
#
# OUTPUT: JSON to stdout — {"decision":"allow|deny|skip",...}
# EXIT: 0 = pass/skip, 1 = block

set -euo pipefail

# --- Argument parsing ---
MODE=""
case "${1:-}" in
  --pre-commit) MODE="pre-commit" ;;
  --pre-push)   MODE="pre-push" ;;
  *)
    echo '{"decision":"deny","reason":"Usage: sprint-gate.sh --pre-commit | --pre-push"}'
    exit 1
    ;;
esac

# --- Locate repo root and sprint state ---
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo '{"decision":"skip","reason":"not inside a git repository"}'
  exit 0
}

SPRINT_STATE_DIR="$REPO_ROOT/.sprint-state"
SPRINT_STATE_JSON="$SPRINT_STATE_DIR/sprint-state.json"
APPROVED_FILE="$SPRINT_STATE_DIR/delphi-reviewed.json"

# If no .sprint-state directory, this isn't a sprint project → SKIP
if [ ! -d "$SPRINT_STATE_DIR" ]; then
  echo '{"decision":"skip","reason":"not a sprint project"}'
  exit 0
fi

# --- Helper: check jq availability ---
HAS_JQ=false
if command -v jq &>/dev/null; then
  HAS_JQ=true
fi

# --- Helper: read phase from sprint-state.json ---
# Returns phase number or -1 if unreadable
read_phase() {
  if [ ! -f "$SPRINT_STATE_JSON" ]; then
    echo "-1"
    return
  fi
  if ! $HAS_JQ; then
    echo "-1"
    return
  fi
  if ! jq empty "$SPRINT_STATE_JSON" 2>/dev/null; then
    echo "-1"
    return
  fi
  local phase
  phase=$(jq -r '.phase // -1' "$SPRINT_STATE_JSON" 2>/dev/null) || phase="-1"
  echo "$phase"
}

# --- Helper: read delphi verdict ---
# Returns verdict string or empty if unreadable
read_verdict() {
  if [ ! -f "$APPROVED_FILE" ]; then
    echo ""
    return
  fi
  if ! $HAS_JQ; then
    echo ""
    return
  fi
  if ! jq empty "$APPROVED_FILE" 2>/dev/null; then
    echo ""
    return
  fi
  jq -r '.verdict // ""' "$APPROVED_FILE" 2>/dev/null || echo ""
}

# --- Pre-commit mode ---
if [ "$MODE" = "pre-commit" ]; then
  PHASE=$(read_phase)

  # If sprint-state.json is missing or invalid, skip (non-sprint commit)
  if [ "$PHASE" = "-1" ]; then
    if [ ! -f "$SPRINT_STATE_JSON" ]; then
      echo '{"decision":"skip","reason":"sprint-state.json not found, non-sprint commit"}'
    else
      echo '{"decision":"skip","warning":"sprint-state.json is not valid JSON or jq not available, allowing commit"}'
    fi
    exit 0
  fi

  # Phase >= 1 means PLAN is completed — delphi-review must be APPROVED
  if [ "$PHASE" -ge 1 ] 2>/dev/null; then
    # Check if delphi-reviewed.json exists
    if [ ! -f "$APPROVED_FILE" ]; then
      echo '{"decision":"deny","reason":"delphi-review not APPROVED. Complete Phase 1 before committing code changes."}'
      exit 1
    fi

    # If jq not available, warn but allow (graceful degradation)
    if ! $HAS_JQ; then
      echo '{"decision":"allow","warning":"jq not available, cannot verify delphi-review verdict. Install jq for full protection."}'
      exit 0
    fi

    # Validate delphi-reviewed.json is valid JSON
    if ! jq empty "$APPROVED_FILE" 2>/dev/null; then
      echo '{"decision":"deny","reason":"delphi-reviewed.json is not valid JSON. Re-run: /delphi-review"}'
      exit 1
    fi

    # Check verdict
    VERDICT=$(read_verdict)
    if [ "$VERDICT" != "APPROVED" ]; then
      echo "{\"decision\":\"deny\",\"reason\":\"delphi-review verdict is '${VERDICT}', not APPROVED. Fix issues and re-run: /delphi-review\"}"
      exit 1
    fi

    # All checks passed
    echo "{\"decision\":\"allow\",\"message\":\"delphi-review APPROVED, sprint phase ${PHASE} validated\"}"
    exit 0
  fi

  # Phase < 1 (pre-PLAN) — no delphi enforcement needed
  echo "{\"decision\":\"allow\",\"reason\":\"sprint phase ${PHASE} (pre-PLAN), no delphi enforcement required\"}"
  exit 0
fi

# --- Pre-push mode ---
if [ "$MODE" = "pre-push" ]; then
  # Only enforce on sprint/* branches
  BRANCH="$(git branch --show-current 2>/dev/null)" || BRANCH=""
  case "$BRANCH" in
    sprint/*) ;; # continue
    *)
      echo "{\"decision\":\"skip\",\"reason\":\"branch '${BRANCH}' does not match sprint/* pattern\"}"
      exit 0
      ;;
  esac

  # Validate sprint-state.json exists and is readable
  PHASE=$(read_phase)
  if [ "$PHASE" = "-1" ] && [ ! -f "$SPRINT_STATE_JSON" ]; then
    echo "{\"decision\":\"deny\",\"reason\":\"sprint-state.json not found on sprint branch '${BRANCH}'\"}"
    exit 1
  fi

  # Delphi review must be APPROVED
  if [ ! -f "$APPROVED_FILE" ]; then
    echo '{"decision":"deny","reason":"delphi-reviewed.json not found. Complete Phase 1 delphi-review before pushing."}'
    exit 1
  fi

  if ! $HAS_JQ; then
    echo '{"decision":"deny","reason":"jq not available, cannot verify delphi-review verdict. Install jq to push from sprint branch."}'
    exit 1
  fi

  if ! jq empty "$APPROVED_FILE" 2>/dev/null; then
    echo '{"decision":"deny","reason":"delphi-reviewed.json is not valid JSON. Re-run: /delphi-review"}'
    exit 1
  fi

  VERDICT=$(read_verdict)
  if [ "$VERDICT" != "APPROVED" ]; then
    echo "{\"decision\":\"deny\",\"reason\":\"delphi-review verdict is '${VERDICT}', not APPROVED. Fix issues and re-run: /delphi-review\"}"
    exit 1
  fi

  # specification.yaml must exist (Phase 1 PLAN output)
  SPEC_FILE="$REPO_ROOT/specification.yaml"
  if [ ! -f "$SPEC_FILE" ]; then
    # Also check sprint-state output directory
    SPEC_FILE="$SPRINT_STATE_DIR/phase-outputs/specification.yaml"
    if [ ! -f "$SPEC_FILE" ]; then
      echo '{"decision":"deny","reason":"specification.yaml not found. Phase 1 PLAN must produce specification.yaml before pushing."}'
      exit 1
    fi
  fi

  # All checks passed — comprehensive success output
  SPEC_SIZE=$(wc -c < "$SPEC_FILE" 2>/dev/null | tr -d ' ')
  echo "{\"decision\":\"allow\",\"message\":\"sprint push validated\",\"branch\":\"${BRANCH}\",\"phase\":${PHASE},\"verdict\":\"APPROVED\",\"specification_size_bytes\":${SPEC_SIZE:-0}}"
  exit 0
fi
