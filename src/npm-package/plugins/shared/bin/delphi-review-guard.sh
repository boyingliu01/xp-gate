#!/bin/bash
# delphi-review-guard.sh — the PreToolUse guard shared by every plugin host.
#
# PURPOSE: Physically prevent the model from editing or writing code before a
# delphi-review is APPROVED. Blocks Edit / Write / ApplyEdit.
#
# WHY THIS FILE EXISTS: the Claude Code and Qoder copies were byte-identical except
# for two comment lines, and the mirror under src/npm-package held two more. Four
# copies of an ENFORCEMENT EDGE is four places for a fix to go missing -- and the one
# that drifts is not the one anyone reads. Each host's `bin/*-guard.sh` now only
# documents itself and delegates here.
#
# MECHANISM:
#   - reads .sprint-state/delphi-reviewed.json
#   - missing file, invalid JSON, or verdict != APPROVED -> deny
#   - verdict == APPROVED -> allow
#
# GRACEFUL DEGRADATION, and the direction matters: degrade toward doing LESS, never
# toward claiming success.
#   - no .sprint-state/ directory -> allow (not a sprint project)
#   - no jq -> allow WITH a warning, because an existing project must not be blocked
#     by a missing viewer; the warning is what keeps that from reading as a pass.

# The guard is opt-in per project: no sprint state means this is not a sprint.
SPRINT_STATE_DIR="$(git rev-parse --show-toplevel 2>/dev/null)/.sprint-state"
if [ ! -d "$SPRINT_STATE_DIR" ]; then
  exit 0
fi

APPROVED_FILE="$SPRINT_STATE_DIR/delphi-reviewed.json"

if [ ! -f "$APPROVED_FILE" ]; then
  echo '{"decision":"deny","reason":"delphi-review not APPROVED. Complete Phase 1 delphi-review before any code modification. Run: /delphi-review"}'
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo '{"decision":"allow","warning":"jq not available, cannot verify delphi-review verdict. Install jq for full protection."}'
  exit 0
fi

if ! jq empty "$APPROVED_FILE" 2>/dev/null; then
  echo '{"decision":"deny","reason":"delphi-reviewed.json is not valid JSON. Re-run: /delphi-review"}'
  exit 1
fi

VERDICT=$(jq -r '.verdict' "$APPROVED_FILE" 2>/dev/null)
MODE=$(jq -r '.mode' "$APPROVED_FILE" 2>/dev/null)

if [ "$VERDICT" != "APPROVED" ]; then
  echo "{\"decision\":\"deny\",\"reason\":\"delphi-review verdict is '${VERDICT}', not APPROVED. Fix issues and re-run: /delphi-review\"}"
  exit 1
fi

# APPROVED. The message names WHAT was approved: a design names its specification, a
# walkthrough names its commit, and the reader needs that to know the approval still
# covers the code in front of them.
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
