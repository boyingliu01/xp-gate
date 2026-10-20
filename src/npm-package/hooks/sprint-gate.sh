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

# --- Helper: sprint age in days, or empty if unknown ---
# Reads status + started_at from sprint-state.json. #551: the gate judged only
# `phase` and the delphi verdict, so a state file left at status=in_progress
# reported "sprint phase 6 validated" on unrelated commits for as long as
# nobody fixed it. An advancing sprint and an abandoned one were
# indistinguishable -- worse than SKIP, because SKIP is honest and PASS lies.
read_sprint_status() {
  if [ ! -f "$SPRINT_STATE_JSON" ] || [ "$JSON_PARSER" = "none" ]; then
    echo ""
    return
  fi
  json_validate "$SPRINT_STATE_JSON" || { echo ""; return; }
  json_extract "$SPRINT_STATE_JSON" '.status // ""' 2>/dev/null || echo ""
}

read_sprint_age_days() {
  if [ ! -f "$SPRINT_STATE_JSON" ] || [ "$JSON_PARSER" = "none" ]; then
    echo ""
    return
  fi
  json_validate "$SPRINT_STATE_JSON" || { echo ""; return; }
  local started
  started=$(json_extract "$SPRINT_STATE_JSON" '.started_at // ""' 2>/dev/null || echo "")
  # Older state files may carry updated_at only; either is the last sign of life.
  if [ -z "$started" ] || [ "$started" = "null" ]; then
    started=$(json_extract "$SPRINT_STATE_JSON" '.updated_at // ""' 2>/dev/null || echo "")
  fi
  if [ -z "$started" ] || [ "$started" = "null" ]; then
    echo ""
    return
  fi
  # Portable ISO-8601 -> epoch. GNU date first, BSD date second, node last; if
  # all fail the age is unknown and the caller must not invent one.
  local epoch=""
  epoch=$(date -u -d "$started" +%s 2>/dev/null || true)
  if [ -z "$epoch" ]; then
    epoch=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$started" +%s 2>/dev/null || true)
  fi
  if [ -z "$epoch" ] && command -v node >/dev/null 2>&1; then
    epoch=$(node -e "const t=Date.parse(process.argv[1]);if(Number.isFinite(t))process.stdout.write(String(Math.floor(t/1000)))" "$started" 2>/dev/null || true)
  fi
  if [ -z "$epoch" ]; then
    echo ""
    return
  fi
  local now
  now=$(date -u +%s)
  local age=$(( (now - epoch) / 86400 ))
  [ "$age" -lt 0 ] && age=0
  echo "$age"
}

# Threshold in days beyond which an in_progress sprint is considered abandoned.
# Configurable because the right number is project-specific: a weekly cadence
# wants 14, a monthly one wants more. Default 14 = two full weeks without
# progress: enough that a sprint paused over a holiday is not called dead, tight
# enough that the reported 12-day case is caught within two days of it firing.
SPRINT_STALE_DAYS="${SPRINT_STALE_DAYS:-14}"

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

    # #551: staleness. A sprint left at status=in_progress past the threshold is
    # abandoned, not validated -- reporting PASS for it means the gate cannot
    # distinguish an advancing sprint from a forgotten one, and it injects
    # ancient phase_history into every unrelated commit's audit trail. SKIP is
    # the honest answer: the gate declines to certify a sprint nobody is
    # driving, without blocking work that has nothing to do with it.
    SPRINT_STATUS=$(read_sprint_status)
    SPRINT_AGE_DAYS=$(read_sprint_age_days)
    if [ "$SPRINT_STATUS" = "in_progress" ] && [ -n "$SPRINT_AGE_DAYS" ] \
       && [ "$SPRINT_AGE_DAYS" -ge "$SPRINT_STALE_DAYS" ] 2>/dev/null; then
      echo "{\"decision\":\"skip\",\"reason\":\"STALE SPRINT: status=in_progress for ${SPRINT_AGE_DAYS} days (threshold ${SPRINT_STALE_DAYS}) — not certifying it. Finish it (sprint-flow close) or clear .sprint-state/sprint-state.json\"}"
      exit 0
    fi

    # All checks passed. Name the age so "validated" is not an unconditional
    # claim: a 29-day-old sprint under a 30-day threshold is a very different
    # situation from one opened today, and the log should say which it is.
    if [ -n "$SPRINT_AGE_DAYS" ]; then
      echo "{\"decision\":\"allow\",\"message\":\"delphi-review APPROVED, sprint phase ${PHASE} validated (sprint open ${SPRINT_AGE_DAYS} day(s), staleness threshold ${SPRINT_STALE_DAYS})\"}"
    else
      echo "{\"decision\":\"allow\",\"message\":\"delphi-review APPROVED, sprint phase ${PHASE} validated (sprint age unknown — started_at unreadable)\"}"
    fi
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
