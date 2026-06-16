#!/bin/bash
# sprint-gate.sh — Sprint Flow Enforcement Gate
#
# Validates sprint state consistency at git hook boundaries.
# Called from pre-commit (Gate 10) and pre-push (Gate S).
#
# DESIGN: Works regardless of whether AI commits or human commits.
# Git-level enforcement is the primary mechanism — IDE hooks are secondary.
#
# USAGE:
#   sprint-gate.sh --pre-commit   # Pre-commit validation
#   sprint-gate.sh --pre-push     # Pre-push validation
#
# EXIT CODES:
#   0 = PASS or SKIP (non-sprint project)
#   1 = BLOCK (sprint state inconsistent)
#
# GRACEFUL DEGRADATION:
#   - No .sprint-state/ → SKIP (not a sprint project)
#   - jq missing → WARN but ALLOW (matches delphi-review-guard.sh pattern)

set -euo pipefail

MODE="${1:-}"
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
SPRINT_STATE_DIR="$ROOT_DIR/.sprint-state"
SPRINT_STATE_FILE="$SPRINT_STATE_DIR/sprint-state.json"

# ── Argument validation ──────────────────────────────────────────────
if [ "$MODE" != "--pre-commit" ] && [ "$MODE" != "--pre-push" ]; then
  echo "Usage: sprint-gate.sh --pre-commit|--pre-push" >&2
  exit 1
fi

# ── Non-sprint project → SKIP ────────────────────────────────────────
if [ ! -d "$SPRINT_STATE_DIR" ]; then
  if [ "$MODE" = "--pre-commit" ]; then
    echo "⏭️  SKIPPED - Gate 10: Sprint Flow (not a sprint project)"
  else
    echo "⏭️  SKIPPED - Gate S: Sprint Flow (not a sprint project)"
  fi
  exit 0
fi

# ── jq availability check ────────────────────────────────────────────
if ! command -v jq &>/dev/null; then
  echo "⚠️  WARN - Gate ${MODE#--}: Sprint Flow validation skipped (jq not installed)"
  echo "   Install jq for full sprint state validation."
  exit 0
fi

# ── Sprint state file validation ─────────────────────────────────────
if [ ! -f "$SPRINT_STATE_FILE" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   ❌ SPRINT STATE MISSING - ${MODE#--} BLOCKED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo ".sprint-state/ directory exists but sprint-state.json is missing."
  echo "This indicates a corrupted sprint state."
  echo ""
  echo "Fix: Re-run /sprint-flow or remove .sprint-state/ to start fresh."
  echo ""
  exit 1
fi

# ── JSON validity check ──────────────────────────────────────────────
if ! jq empty "$SPRINT_STATE_FILE" 2>/dev/null; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   ❌ SPRINT STATE CORRUPT - ${MODE#--} BLOCKED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "sprint-state.json is not valid JSON."
  echo ""
  echo "Fix: Re-run /sprint-flow or remove .sprint-state/ to start fresh."
  echo ""
  exit 1
fi

# ── Read current phase ───────────────────────────────────────────────
CURRENT_PHASE=$(jq -r '.currentPhase // "unknown"' "$SPRINT_STATE_FILE" 2>/dev/null)

# ── Pre-commit specific checks ───────────────────────────────────────
if [ "$MODE" = "--pre-commit" ]; then
  # Check: If in Phase 2 (BUILD), delphi-review must be APPROVED
  if [ "$CURRENT_PHASE" = "2" ] || [ "$CURRENT_PHASE" = "BUILD" ]; then
    DELPHI_FILE="$SPRINT_STATE_DIR/delphi-reviewed.json"

    if [ ! -f "$DELPHI_FILE" ]; then
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "   ❌ DELPHI-REVIEW NOT COMPLETED - COMMIT BLOCKED"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "Sprint is in Phase 2 (BUILD) but delphi-reviewed.json is missing."
      echo "Phase 1 delphi-review must be APPROVED before any code commits."
      echo ""
      echo "Fix: Run /delphi-review to complete Phase 1."
      echo ""
      exit 1
    fi

    if ! jq empty "$DELPHI_FILE" 2>/dev/null; then
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "   ❌ DELPHI-REVIEW CORRUPT - COMMIT BLOCKED"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "delphi-reviewed.json is not valid JSON."
      echo ""
      echo "Fix: Re-run /delphi-review."
      echo ""
      exit 1
    fi

    VERDICT=$(jq -r '.verdict // "unknown"' "$DELPHI_FILE" 2>/dev/null)
    if [ "$VERDICT" != "APPROVED" ]; then
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "   ❌ DELPHI-REVIEW NOT APPROVED - COMMIT BLOCKED"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "Sprint is in Phase 2 (BUILD) but delphi-review verdict is: $VERDICT"
      echo "HARD-GATE: Design must reach ≥90% consensus before coding."
      echo ""
      echo "Fix: Address delphi-review issues and re-run /delphi-review."
      echo ""
      exit 1
    fi
  fi

  echo "✅ PASSED - Gate 10: Sprint Flow (phase: $CURRENT_PHASE)"
  exit 0
fi

# ── Pre-push specific checks ─────────────────────────────────────────
if [ "$MODE" = "--pre-push" ]; then
  # Check: specification.yaml must exist if in Phase 2+
  case "$CURRENT_PHASE" in
    2|BUILD|3|REVIEW|4|USER_ACCEPT|5|FEEDBACK|6|SHIP|7|LAND|8|CLEANUP)
      SPEC_FILE="$SPRINT_STATE_DIR/phase-outputs/specification.yaml"
      if [ ! -f "$SPEC_FILE" ]; then
        # Also check root-level specification.yaml
        if [ ! -f "$ROOT_DIR/specification.yaml" ]; then
          echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
          echo "   ❌ SPECIFICATION MISSING - PUSH BLOCKED"
          echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
          echo ""
          echo "Sprint phase is '$CURRENT_PHASE' but specification.yaml is missing."
          echo "Phase 1 PLAN output is required before pushing code."
          echo ""
          echo "Fix: Complete Phase 1 (specification.yaml generation)."
          echo ""
          exit 1
        fi
      fi
      ;;
  esac

  # Check: delphi-review must be APPROVED for any push from sprint branch
  DELPHI_FILE="$SPRINT_STATE_DIR/delphi-reviewed.json"
  if [ -f "$DELPHI_FILE" ]; then
    VERDICT=$(jq -r '.verdict // "unknown"' "$DELPHI_FILE" 2>/dev/null)
    if [ "$VERDICT" != "APPROVED" ]; then
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "   ❌ DELPHI-REVIEW NOT APPROVED - PUSH BLOCKED"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "Sprint delphi-review verdict is: $VERDICT"
      echo "Cannot push from sprint branch without APPROVED design review."
      echo ""
      exit 1
    fi
  fi

  echo "✅ PASSED - Gate S: Sprint Flow (phase: $CURRENT_PHASE)"
  exit 0
fi
