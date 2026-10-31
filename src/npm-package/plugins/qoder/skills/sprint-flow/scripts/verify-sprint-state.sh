#!/usr/bin/env bash
# sprint-flow: Verify sprint state integrity
# Checks that sprint-state.json is valid JSON and all expected keys exist.
#
# Usage: bash verify-sprint-state.sh [sprint-state-dir]
#
# The expected keys are the ones `xp-gate sprint-init` actually writes (#679).
# They were previously ['sprint_id','status','current_phase','phases'] -- a schema
# this project has never written, so the check failed on every sprint the CLI
# itself had just created. A verifier that rejects its own producer's output is
# worse than no verifier: it trains people to ignore it.

set -euo pipefail

STATE_DIR="${1:-.sprint-state}"
STATE_FILE="$STATE_DIR/sprint-state.json"

if [ ! -f "$STATE_FILE" ]; then
    echo "SKIP: No sprint-state.json found at $STATE_FILE"
    exit 0
fi

# Validate JSON
if ! command -v node &>/dev/null; then
    echo "WARN: node not available, skipping JSON validation"
    exit 0
fi

node -e "
const fs = require('fs');
try {
    const data = JSON.parse(fs.readFileSync('$STATE_FILE', 'utf8'));
    // These are the keys src/npm-package/lib/sprint-init.js writes.
    const requiredKeys = ['id', 'task_description', 'phase', 'status'];
    const missing = requiredKeys.filter(k => !(k in data));
    if (missing.length > 0) {
        console.error('ERROR: Missing required keys in sprint-state.json:', missing.join(', '));
        process.exit(1);
    }
    // phase_history is an array by construction; a non-array here means the file
    // was hand-edited or written by a different tool, which is worth failing on.
    if (!Array.isArray(data.phase_history)) {
        console.error('ERROR: phase_history must be an array in sprint-state.json');
        process.exit(1);
    }
    console.log('OK: sprint-state.json is valid with all required keys');
} catch (e) {
    console.error('ERROR: sprint-state.json is not valid JSON:', e.message);
    process.exit(1);
}
"
