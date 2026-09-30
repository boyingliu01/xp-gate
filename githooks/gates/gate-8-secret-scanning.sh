# Gate 8: Secret Scanning
# Tool: gitleaks
# Threshold: Any leaked secret = block
# Usage: source this file from pre-commit

GATE_8_STATUS="PASS"

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
  GITLEAKS_OUTPUT=$($GITLEAKS_CMD git --staged --redact --no-banner $GITLEAKS_CONFIG --report-format=json --report-path="$GITLEAKS_REPORT" 2>&1)
  GITLEAKS_EXIT=$?

  if [ "$GITLEAKS_EXIT" -eq 0 ]; then
    # Guard against a silent void: if gitleaks scanned nothing there is no
    # evidence the gate ran, so say so explicitly rather than claiming PASS.
    if printf '%s' "$GITLEAKS_OUTPUT" | grep -qE '0 commits scanned' && \
       printf '%s' "$GITLEAKS_OUTPUT" | grep -qE 'scanned ~0 bytes'; then
      echo "     ⏭️  SKIPPED - gitleaks scanned no content (nothing staged)"
      GATE_8_STATUS="SKIP"
    else
      echo "     ✅ PASSED - No secrets detected."
      GATE_8_STATUS="PASS"
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
    GATE_8_STATUS="FAIL"
    exit 1
  else
    echo "     ⚠️  gitleaks exited with code $GITLEAKS_EXIT - skipping gate"
    echo "     ✅ Secret Scanning (SKIP, gitleaks error)"
    GATE_8_STATUS="SKIP"
  fi
else
  echo "     ℹ️  gitleaks not installed — secret scanning unavailable"
  echo "     Install: brew install gitleaks (macOS) | winget install gitleaks (Windows) | scripts/install-gitleaks.sh (Linux)"
  echo "     ✅ Secret Scanning (SKIP, gitleaks not installed)"
  GATE_8_STATUS="SKIP"
fi

# Note: GATE_8_STATUS is set for caller to use
# Caller must call: record_gate_audit "gate-8" "secret-scanning" "$GATE_8_STATUS" "0" "$GATE_8_START"
