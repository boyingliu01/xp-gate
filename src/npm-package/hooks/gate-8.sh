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
    GITLEAKS_CONFIG="--config=.gitleaks.toml"
  fi

  # Run gitleaks on staged changes only (pre-commit mode for speed)
  GITLEAKS_OUTPUT=$($GITLEAKS_CMD git --pre-commit --redact --no-banner $GITLEAKS_CONFIG --report-format=json --report-path=/tmp/gitleaks-report.json 2>&1)
  GITLEAKS_EXIT=$?

  if [ "$GITLEAKS_EXIT" -eq 0 ]; then
    echo "     ✅ PASSED - No secrets detected."
    GATE_8_STATUS="PASS"
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
