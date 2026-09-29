#!/usr/bin/env bash
# delphi-review: Verify consensus report integrity
# Checks that delphi-reviewed.json is valid JSON and contains expected verdict field.
#
# Usage: bash verify-consensus.sh [state-dir]

set -euo pipefail

STATE_DIR="${1:-.sprint-state}"
STATE_FILE="$STATE_DIR/delphi-reviewed.json"

if [ ! -f "$STATE_FILE" ]; then
    echo "SKIP: No delphi-reviewed.json found at $STATE_FILE"
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
    const requiredKeys = ['mode', 'timestamp', 'verdict', 'consensus_ratio'];
    const missing = requiredKeys.filter(k => !(k in data));
    if (missing.length > 0) {
        console.error('ERROR: Missing required keys in delphi-reviewed.json:', missing.join(', '));
        process.exit(1);
    }
    const validVerdicts = ['APPROVED', 'PASS_WITH_CAVEATS', 'REQUEST_CHANGES', 'BLOCKED'];
    if (!validVerdicts.includes(data.verdict)) {
        console.error('ERROR: Invalid verdict:', data.verdict, '(expected one of:', validVerdicts.join(', '), ')');
        process.exit(1);
    }
    console.log('OK: delphi-reviewed.json is valid with verdict:', data.verdict);
} catch (e) {
    console.error('ERROR: delphi-reviewed.json is not valid JSON:', e.message);
    process.exit(1);
}
"
