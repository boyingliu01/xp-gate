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
#     - If jq AND node unavailable → WARN but ALLOW (graceful degradation)
#     - If jq unavailable but node available → use Node.js JSON parser fallback
#
#   --pre-push:
#     - If .sprint-state/ missing → SKIP
#     - If branch doesn't match sprint/* → SKIP
#     - If delphi-reviewed.json missing or verdict != "APPROVED" → DENY
#     - If phase < 2 (BUILD not started) → DENY
#     - If phase >= 2 and specification.yaml missing → DENY
#     - If jq AND node unavailable → DENY (cannot verify verdict)
#
# GRACEFUL DEGRADATION:
#   - If .sprint-state/ directory doesn't exist → SKIP (not a sprint project)
#   - If sprint-state.json is missing/invalid → SKIP (non-sprint commit)
#   - JSON parser fallback chain: jq → Node.js → explicit degradation message
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

# --- Helper: check tool availability ---
HAS_JQ=false
if command -v jq &>/dev/null; then
  HAS_JQ=true
fi

HAS_NODE=false
if command -v node &>/dev/null; then
  HAS_NODE=true
fi

# JSON_PARSER: "jq" | "node" | "none"
if $HAS_JQ; then
  JSON_PARSER="jq"
elif $HAS_NODE; then
  JSON_PARSER="node"
else
  JSON_PARSER="none"
fi

# --- Helper: validate JSON file ---
# Returns 0 if valid, 1 if invalid or no parser available
json_validate() {
  local file="$1"
  if [ ! -f "$file" ]; then
    return 1
  fi
  case "$JSON_PARSER" in
    jq)
      jq empty "$file" 2>/dev/null
      return $?
      ;;
    node)
      node -e "try{JSON.parse(require('fs').readFileSync('$file','utf8'));process.exit(0)}catch(e){process.exit(1)}" 2>/dev/null
      return $?
      ;;
    *)
      return 1
      ;;
  esac
}

# --- Helper: extract JSON field ---
# Usage: json_extract <file> <jq-filter>
# jq-filter is a jq expression like '.phase // -1' or '.verdict // ""'
# Falls back to Node.js when jq is unavailable
json_extract() {
  local file="$1"
  local filter="$2"
  case "$JSON_PARSER" in
    jq)
      jq -r "$filter" "$file" 2>/dev/null
      return $?
      ;;
    node)
      # Translate simple jq filters to Node.js
      # Supports: .field // default patterns
      local field default_val
      field=$(echo "$filter" | sed 's/^\.//;s/ *\/\/.*$//')
      default_val=$(echo "$filter" | sed -n 's/.*\/\/ *//p')
      node -e "
        try {
          var d=JSON.parse(require('fs').readFileSync('$file','utf8'));
          var v=d['${field}'];
          if(v===undefined||v===null){v=${default_val:-null}}
          process.stdout.write(String(v));
        }catch(e){process.stdout.write('${default_val:-}');process.exit(1)}
      " 2>/dev/null
      return $?
      ;;
    *)
      echo ""
      return 1
      ;;
  esac
}

# --- Helper: read phase from sprint-state.json ---
# Returns phase number or -1 if unreadable
read_phase() {
  if [ ! -f "$SPRINT_STATE_JSON" ]; then
    echo "-1"
    return
  fi
  if [ "$JSON_PARSER" = "none" ]; then
    echo "-1"
    return
  fi
  if ! json_validate "$SPRINT_STATE_JSON"; then
    echo "-1"
    return
  fi
  local phase
  phase=$(json_extract "$SPRINT_STATE_JSON" '.phase // -1') || phase="-1"
  echo "$phase"
}

# --- Helper: read delphi verdict ---
# Returns verdict string or empty if unreadable
read_verdict() {
  if [ ! -f "$APPROVED_FILE" ]; then
    echo ""
    return
  fi
  if [ "$JSON_PARSER" = "none" ]; then
    echo ""
    return
  fi
  if ! json_validate "$APPROVED_FILE"; then
    echo ""
    return
  fi
  json_extract "$APPROVED_FILE" '.verdict // ""' || echo ""
}

# --- Pre-commit mode ---
if [ "$MODE" = "pre-commit" ]; then
  PHASE=$(read_phase)

  # If sprint-state.json is missing or invalid, skip (non-sprint commit)
  if [ "$PHASE" = "-1" ]; then
    if [ ! -f "$SPRINT_STATE_JSON" ]; then
      echo '{"decision":"skip","reason":"sprint-state.json not found, non-sprint commit"}'
    else
      echo '{"decision":"skip","warning":"sprint-state.json is not valid JSON or no JSON parser available (install jq or node), allowing commit"}'
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

    # If no JSON parser available, warn but allow (graceful degradation)
    if [ "$JSON_PARSER" = "none" ]; then
      echo '{"decision":"allow","warning":"neither jq nor node available, cannot verify delphi-review verdict. Install jq or node for full protection."}'
      exit 0
    fi

    # Validate delphi-reviewed.json is valid JSON
    if ! json_validate "$APPROVED_FILE"; then
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

  if [ "$JSON_PARSER" = "none" ]; then
    echo '{"decision":"deny","reason":"neither jq nor node available, cannot verify delphi-review verdict. Install jq or node to push from sprint branch."}'
    exit 1
  fi

  if ! json_validate "$APPROVED_FILE"; then
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
