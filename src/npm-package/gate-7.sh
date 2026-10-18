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
# #536: scanned_files makes a trivial PASS (nothing to scan) auditable in the
# quality report instead of reading like a covered security check.
GATE_7_SCANNED_FILES=0
if [ -z "$IAC_FILES" ]; then
  echo "✅ PASSED - No IaC files detected in changes."
  GATE_7_STATUS="PASS"
else
  GATE_7_SCANNED_FILES=$(printf '%s\n' "$IAC_FILES" | grep -c . || true)
  # Run IaC adapter. Resolution follows the documented 3-tier convention
  # (adapter-common.sh): global ~/.config/xp-gate/adapters -> project
  # githooks/adapters -> script dir. The old cwd-only test silently SKIPped
  # IaC security in every consumer repo without an in-repo githooks/ dir,
  # even with the adapter installed globally (e2e sweep 2026-10-17; pinned
  # by __tests__/gate-7-adapter-resolution.test.bats).
  IAC_ADAPTER=""
  for _candidate in \
    "$HOME/.config/xp-gate/adapters/iac.sh" \
    "githooks/adapters/iac.sh" \
    "${SCRIPT_DIR:-}/adapters/iac.sh"; do
    if [ -n "$_candidate" ] && [ -f "$_candidate" ]; then
      IAC_ADAPTER="$_candidate"
      break
    fi
  done
  if [ -n "$IAC_ADAPTER" ]; then
    # Audit trail: which tier won (r14 walkthrough MAJ-02 — a silent tier-order
    # regression must be visible in the gate output, not only in test diffs).
    echo "   IaC adapter resolved from: $IAC_ADAPTER"
    # shellcheck source=/dev/null
    source "$IAC_ADAPTER"
    
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
