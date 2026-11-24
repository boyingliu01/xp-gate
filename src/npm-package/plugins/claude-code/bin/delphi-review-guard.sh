#!/bin/bash
# delphi-review-guard.sh — PreToolUse Hook Guard (Claude Code)
#
# Registered in plugins/claude-code/hooks/hooks.json as a PreToolUse hook.
#
# The guard itself lives in plugins/shared/bin/delphi-review-guard.sh. It was copied
# into each host's bin/ with two comment lines changed, so a fix had four places to
# land and the drifted copy was never the one being read. This file only locates the
# shared script and hands over.
#
# If the shared script is missing, DENY: an enforcement edge that silently does
# nothing is the failure mode the guard exists to prevent.

SHARED="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../shared/bin" 2>/dev/null && pwd)/delphi-review-guard.sh"
if [ ! -f "$SHARED" ]; then
  echo '{"decision":"deny","reason":"delphi-review guard is missing (plugins/shared/bin). Reinstall the plugin."}'
  exit 1
fi
exec bash "$SHARED"
