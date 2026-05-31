#!/bin/bash
# delphi-review-guard.sh — PreToolUse Hook Guard
#
# PURPOSE: Physically prevent LLM from editing/writing code before
# delphi-review is APPROVED. Blocks Edit/Write/ApplyEdit tools.
#
# INTEGRATION: Registered in plugins/claude-code/hooks/hooks.json
# as a PreToolUse hook.
#
# MECHANISM:
#   - Reads .sprint-state/delphi-reviewed.json
#   - If file missing or verdict != "APPROVED" → deny
#   - If verdict == "APPROVED" → allow
#
# GRACEFUL DEGRADATION:
#   - If .sprint-state/ directory doesn't exist → ALLOW (not a sprint project)
#   - If jq not available → ALLOW with warning (zero degradation for existing projects)

# Check if this is a sprint project
SPRINT_STATE_DIR="$(git rev-parse --show-toplevel 2>/dev/null)/.sprint-state"
APPROVED_FILE="$SPRINT_STATE_DIR/delphi-reviewed.json"

# If no .sprint-state directory, this isn't a sprint project → allow
if [ ! -d "$SPRINT_STATE_DIR" ]; then
  exit 0
fi

# If delphi-reviewed.json doesn't exist, delphi-review hasn't completed → DENY
if [ ! -f "$APPROVED_FILE" ]; then
  echo '{"decision":"deny","reason":"delphi-review not APPROVED. Complete Phase 1 delphi-review before any code modification. Run: /delphi-review"}'
  exit 1
fi

# Check jq availability
if ! command -v jq &> /dev/null; then
  # jq not available → warn but allow (degradation for existing project)
  echo '{"decision":"allow","warning":"jq not available, cannot verify delphi-review verdict. Install jq for full protection."}'
  exit 0
fi

# Validate JSON
if ! jq empty "$APPROVED_FILE" 2>/dev/null; then
  echo '{"decision":"deny","reason":"delphi-reviewed.json is not valid JSON. Re-run: /delphi-review"}'
  exit 1
fi

# Check verdict
VERDICT=$(jq -r '.verdict' "$APPROVED_FILE" 2>/dev/null)
MODE=$(jq -r '.mode' "$APPROVED_FILE" 2>/dev/null)

if [ "$VERDICT" != "APPROVED" ]; then
  DENY_MSG="{\"decision\":\"deny\",\"reason\":\"delphi-review verdict is '${VERDICT}', not APPROVED. Fix issues and re-run: /delphi-review\"}"
  echo "$DENY_MSG"
  exit 1
fi

# APPROVED → allow
if [ "$MODE" = "design" ]; then
  SPEC_PATH=$(jq -r '.specification_path // "not found"' "$APPROVED_FILE" 2>/dev/null)
  echo "{\"decision\":\"allow\",\"message\":\"delphi-review design APPROVED. specification: ${SPEC_PATH}\"}"
elif [ "$MODE" = "code-walkthrough" ]; then
  COMMIT=$(jq -r '.commit // "unknown"' "$APPROVED_FILE" 2>/dev/null)
  echo "{\"decision\":\"allow\",\"message\":\"delphi-review code-walkthrough APPROVED. commit: ${COMMIT}\"}"
else
  echo '{"decision":"allow","message":"delphi-review APPROVED"}'
fi

exit 0
