# Extracted Gate Scripts

This directory contains extracted gate scripts from `pre-commit` for better maintainability.

## Structure

```
gates/
├── gate-3-complexity.sh      # Cyclomatic complexity check (lizard)
├── gate-4-principles.sh      # Clean Code + SOLID principles
├── gate-7-iac-security.sh    # IaC security scan (checkov/hadolint/kube-score/tflint)
├── gate-8-secret-scanning.sh # Secret detection (gitleaks)
├── gate-9-sast-security.sh   # SAST security scan (semgrep)
└── README.md                 # This file
```

## Usage

Each gate script:
1. Sets `GATE_N_STATUS` variable (PASS/FAIL/WARN/SKIP)
2. Sets gate-specific metrics (e.g., `CC_WARNINGS`, `WARNING_COUNT`)
3. Uses `GATE_N_START` timestamp (set by caller)
4. **Does NOT call `record_gate_audit`** - caller must do this

### Example usage in pre-commit:

```bash
# Set start time
GATE_3_START=$(gate_start_ms)

# Source the gate script (it will exit on FAIL)
source "githooks/gates/gate-3-complexity.sh"

# Record audit (after gate script returns)
record_gate_audit "gate-3" "complexity" "$GATE_3_STATUS" "${CC_WARNINGS:-0}" "$GATE_3_START"
```

## Variables Set by Each Gate

| Gate | Status Var | Metrics Var | Description |
|------|-----------|-------------|-------------|
| 3 | `GATE_3_STATUS` | `CC_WARNINGS` | Functions with CCN > threshold |
| 4 | `GATE_4_STATUS` | `WARNING_COUNT` | Principle violations |
| 7 | `GATE_7_STATUS` | (none) | IaC security issues |
| 8 | `GATE_8_STATUS` | (none) | Secret detections |
| 9 | `GATE_9_STATUS` | (none) | SAST vulnerabilities |

## Shared Dependencies

All gates require:
- `CHANGED_FILES` - space-separated list of changed files
- `PROJECT_LANG` - detected project language
- `gate_start_ms()` - from adapter-common.sh
- `record_gate_audit()` - from adapter-common.sh
- Gate-specific tools (lizard, semgrep, gitleaks, etc.)

## TODO: Remaining Refactoring Steps

1. ✅ Extract Gate 3 (complexity)
2. ✅ Extract Gate 4 (principles)
3. ✅ Extract Gate 7 (IaC security)
4. ✅ Extract Gate 8 (secret scanning)
5. ✅ Extract Gate 9 (SAST security)
6. ⏳ Update pre-commit to source Gate 3-4-7-8-9 scripts
7. ⏳ Extract generate_quality_report() to separate file
8. ⏳ Create shared utilities file for common functions
9. ⏳ Add tests for extracted gate scripts
