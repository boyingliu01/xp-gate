#!/bin/bash
# sprint-flow-guard.sh — Qoder PreToolUse Hook Guard
#
# Registered in plugins/qoder/hooks/hooks.json as a PreToolUse hook.
#
# The guard itself lives in plugins/shared/bin/delphi-review-guard.sh. Qoder's
# manifest registers it under a sprint-flow name, but the rule it enforces is the same
# one: no code modification before a delphi-review is APPROVED. Keeping one
# implementation is what stops the two hosts from disagreeing about whether a review
# passed.
#
# If the shared script is missing, DENY: an enforcement edge that silently does
# nothing is the failure mode the guard exists to prevent.

SHARED="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../shared/bin" 2>/dev/null && pwd)/delphi-review-guard.sh"
if [ ! -f "$SHARED" ]; then
  echo '{"decision":"deny","reason":"delphi-review guard is missing (plugins/shared/bin). Reinstall the plugin."}'
  exit 1
fi
exec bash "$SHARED"
