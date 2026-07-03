# ============================================================================
# GATE 7: IaC Security Scanning (Terraform, Kubernetes, Docker)
# Detects security issues in Infrastructure as Code files
# Tools: checkov (recommended), hadolint, kube-score, tflint
# ============================================================================

 2>&1 echo ""
 2>&1 echo "→ Gate 7: IaC Security Scanning (Terraform, Kubernetes, Docker)..."
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
    echo "⏭️  SKIPPED - IaC security (no IaC adapter found)"
    GATE_7_STATUS="SKIP"
  fi
fi
record_gate_audit "gate-7" "iac-security" "$GATE_7_STATUS" "0" "$GATE_7_START"
