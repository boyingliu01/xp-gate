# ============================================================================
# GATE 8: Secret Scanning (gitleaks)
# Detects secrets (API keys, passwords, tokens) in staged files
# Tool: gitleaks -- https://github.com/gitleaks/gitleaks
# ============================================================================

 2>&1 echo ""
 2>&1 echo "→ Gate 8: Secret scanning (gitleaks)..."
GATE_8_START=$(gate_start_ms)

# Gitleaks availability check
GITLEAKS_CMD=""
if command -v gitleaks >/dev/null 2>&1; then
  GITLEAKS_CMD="gitleaks"
elif [ -f "$HOME/.local/bin/gitleaks" ]; then
  GITLEAKS_CMD="$HOME/.local/bin/gitleaks"
fi

if [ -n "$GITLEAKS_CMD" ]; then
  GITLEAKS_CONFIG=""
  if [ -f ".gitleaks.toml" ]; then
    # gitleaks is a native binary and may not understand MSYS paths, so pass an
    # absolute path in the host's own format when we can derive one (#449).
    if command -v cygpath >/dev/null 2>&1; then
      GITLEAKS_CONFIG="--config=$(cygpath -w "$(pwd)/.gitleaks.toml")"
    else
      GITLEAKS_CONFIG="--config=$(pwd)/.gitleaks.toml"
    fi
  fi

  # Scan the INDEX, not history. gitleaks 8.x `git --pre-commit` walks committed
  # revisions and reports "0 commits scanned" on a pre-commit run -- so a staged
  # secret was never seen and Gate 8 always passed. `git --staged` scans
  # `git diff --cached`, which is exactly the pre-commit payload (#449).
  GITLEAKS_REPORT="${TMPDIR:-/tmp}/gitleaks-report.json"
  rm -f "$GITLEAKS_REPORT"
  GITLEAKS_OUTPUT=$($GITLEAKS_CMD git --staged --redact --no-banner $GITLEAKS_CONFIG --report-format=json --report-path="$GITLEAKS_REPORT" 2>&1)
  GITLEAKS_EXIT=$?

  if [ "$GITLEAKS_EXIT" -eq 0 ]; then
    # Decide SKIP from the REPORT ARTIFACT, not from log wording. Parsing stdout
    # meant a gitleaks message change would silently turn a no-evidence run into
    # a PASS -- the same fail-open class this gate just fixed (#449).
    # The report exists and is a JSON array of findings; `[]` == clean scan.
    GITLEAKS_FINDINGS="?"
    if [ -f "$GITLEAKS_REPORT" ]; then
      GITLEAKS_FINDINGS=$(grep -c '"RuleID"' "$GITLEAKS_REPORT" 2>/dev/null || echo 0)
    fi

    if [ "$GITLEAKS_FINDINGS" = "0" ]; then
      echo "     ✅ PASSED - No secrets detected."
      GATE_8_STATUS="PASS"
    elif [ "$GITLEAKS_FINDINGS" = "?" ]; then
      # Exit 0 but no readable report: we have no evidence the scan happened.
      # Fail closed on the *claim*: report SKIP, never PASS.
      echo "     ⚠️  gitleaks exited 0 but produced no readable report"
      echo "     ⏭️  SKIPPED - secret scanning produced no evidence (not a pass)"
      GATE_8_STATUS="SKIP"
    else
      echo "     ❌ BLOCKED - gitleaks reported $GITLEAKS_FINDINGS finding(s)"
      echo "$GITLEAKS_OUTPUT"
      echo ""
      echo "Remediation: remove the secret, or allowlist a false positive in .gitleaks.toml."
      exit 1
    fi
  elif [ "$GITLEAKS_EXIT" -eq 1 ]; then
    # Secrets found — output details
    echo "$GITLEAKS_OUTPUT"
    echo ""
    echo "❌ BLOCKED - Secrets detected in staged files."
    echo ""
    echo "Remediation options:"
    echo "  1. Remove the secret and use environment variables instead"
    echo "  2. Add a false positive to .gitleaks.toml allowlist"
    echo "  3. Use git secret or vault for sensitive data"
    echo ""
    echo "See: https://github.com/gitleaks/gitleaks"
    exit 1
  else
    echo "     ⚠️  gitleaks exited with code $GITLEAKS_EXIT - skipping gate"
    echo "     ✅ Secret Scanning (SKIP, gitleaks error)"
    GATE_8_STATUS="SKIP"
  fi
else
  echo "     ℹ️  gitleaks not installed — secret scanning unavailable"
  echo "     Install: brew install gitleaks (macOS) | winget install gitleaks (Windows) | scripts/install-gitleaks.sh (Linux)"
  echo "     ⏭️  SKIPPED - Secret scanning (gitleaks not installed)"
  GATE_8_STATUS="SKIP"
fi
record_gate_audit "gate-8" "secret-scanning" "$GATE_8_STATUS" "0" "$GATE_8_START"
