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
# Consumed by the sourcing parent, not here (see #548).
# shellcheck disable=SC2034
GATE_7_SCANNED_FILES=0
# Initialised here, not only inside the adapter branch: the journal line at the
# bottom runs on EVERY path, and an unset variable there is an error under set -u.
IAC_ISSUE_COUNT=0
# Why this gate is not checking anything, recorded for the quality report and
# the audit journal. Gate 7 had NO reason variable at all: both SKIP arms
# printed a sentence to the console and the journal then recorded a bare SKIP
# -- this codebase's oldest defect family, "not checked" with nothing saying
# why. Each arm below sets it.
# shellcheck disable=SC2034
GATE_7_REASON=""
if [ -z "$IAC_FILES" ]; then
  # #800: "nothing to scan" must never be rendered as "scanned and clean".
  # This branch used to print PASSED and set GATE_7_STATUS=PASS, while the report
  # simultaneously carried scanned_files=0 -- the gate contradicted itself, and
  # the PASS was what downstream consumers read. A change set with no IaC file is
  # a SKIP with a reason, exactly like the no-adapter branch below.
  echo "⏭️  SKIPPED - IaC security (no IaC files in this change set)."
  GATE_7_STATUS="SKIP"
  # shellcheck disable=SC2034
  GATE_7_REASON="no_iac_files_changed"
else
  # Consumed by the sourcing parent, not here (see #548).
  # shellcheck disable=SC2034
  GATE_7_SCANNED_FILES=$(printf '%s\n' "$IAC_FILES" | sed -n '/./p' | wc -l | tr -d '[:space:]')
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
      IAC_ISSUE_COUNT=0
    else
      echo ""
      echo "❌ BLOCKED - IaC security issues detected"
      echo "Fix the security issues above before committing."
      echo "Tip: Install checkov for comprehensive IaC scanning: pip install checkov"
      GATE_7_STATUS="FAIL"
      # Counted from the adapter's own output instead of the hardcoded 0 this
      # gate used to journal on every path, including the blocked one.
      IAC_ISSUE_COUNT=$(printf '%s\n' "$IAC_OUTPUT" | grep -cE '^[[:space:]]*(❌|FAIL|ERROR|Critical|HIGH)' || true)
      # The journal line must be reached ON THIS PATH, and the single call site at
      # the bottom of the file is not reached: sourcing this file means `return 1`
      # leaves before the bottom. The earlier `exit 1` had the same effect for a
      # different reason. Measured by driving the arm with a stubbed recorder and
      # a failing adapter: no AUDIT row at all, on the one outcome an operator
      # most needs to find in the journal.
      #
      # So record here, then `return` -- not `exit` -- so the driver keeps its
      # single exit point and the EXIT trap fires with the same status.
      record_gate_audit "gate-7" "iac-security" "$GATE_7_STATUS" "${IAC_ISSUE_COUNT:-0}" "$GATE_7_START" "${GATE_7_REASON:-}"
      return 1
    fi
  else
    echo "ℹ️  SKIP - IaC adapter not found"
    echo "⏭️  SKIPPED - IaC security (no IaC adapter found)"
    GATE_7_STATUS="SKIP"
    # shellcheck disable=SC2034
    GATE_7_REASON="adapter_not_found"
  fi
fi
# The single exit point for the journal, reached on every path now that the
# blocked arm returns instead of exiting.
record_gate_audit "gate-7" "iac-security" "$GATE_7_STATUS" "${IAC_ISSUE_COUNT:-0}" "$GATE_7_START" "${GATE_7_REASON:-}"
