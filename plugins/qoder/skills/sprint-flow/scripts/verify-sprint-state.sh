#!/usr/bin/env bash
# sprint-flow: Verify sprint state integrity
# Checks that sprint-state.json is valid JSON and all expected keys exist.
#
# Usage: bash verify-sprint-state.sh [sprint-state-dir]

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
    const requiredKeys = ['sprint_id', 'status', 'current_phase', 'phases'];
    const missing = requiredKeys.filter(k => !(k in data));
    if (missing.length > 0) {
        console.error('ERROR: Missing required keys in sprint-state.json:', missing.join(', '));
        process.exit(1);
    }
    console.log('OK: sprint-state.json is valid with all required keys');
} catch (e) {
    console.error('ERROR: sprint-state.json is not valid JSON:', e.message);
    process.exit(1);
}
"
