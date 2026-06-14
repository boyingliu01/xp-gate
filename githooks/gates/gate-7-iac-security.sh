# Gate 7: IaC Security Scan
# Tools: checkov, hadolint, kube-score, tflint
# Threshold: Any High-severity finding = block
# Usage: source this file from pre-commit after setting CHANGED_FILES

GATE_7_STATUS="PASS"

GATE_7_START=$(gate_start_ms)

# Check if any IaC files are changed
IAC_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E "\.(tf|yaml|yml)$|Dockerfile" || true)
if [ -z "$IAC_FILES" ]; then
  echo "✅ PASSED - No IaC files detected in changes."
  GATE_7_STATUS="PASS"
else
  # Run IaC adapter
  if [ -f "githooks/adapters/iac.sh" ]; then
    # shellcheck source=githooks/adapters/iac.sh
    source "githooks/adapters/iac.sh"
    
    # Run static analysis for IaC files
    IAC_OUTPUT=$(run_static_analysis "$IAC_FILES" 2>&1)
    IAC_EXIT=$?
    
    echo "$IAC_OUTPUT"
    
    if [ $IAC_EXIT -eq 0 ]; then
      echo "✅ PASSED - IaC security scan."
      GATE_7_STATUS="PASS"
    else
      echo ""
      echo "❌ BLOCKED - IaC security issues detected"
      echo "Fix the security issues above before committing."
      echo "Tip: Install checkov for comprehensive IaC scanning: pip install checkov"
      GATE_7_STATUS="FAIL"
      exit 1
    fi
  else
    echo "ℹ️  SKIP - IaC adapter not found"
    echo "✅ PASSED - IaC Security (SKIP)"
    GATE_7_STATUS="SKIP"
  fi
fi

# Note: GATE_7_STATUS is set for caller to use
# Caller must call: record_gate_audit "gate-7" "iac-security" "$GATE_7_STATUS" "0" "$GATE_7_START"
