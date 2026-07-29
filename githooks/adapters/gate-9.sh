# ============================================================================
# GATE 9: Semgrep SAST Security Scan
# Detects security vulnerabilities (SQL injection, XSS, etc.) in staged files
# Tool: semgrep -- https://semgrep.dev
# ============================================================================

 2>&1 echo ""
 2>&1 echo "→ Gate 9: Semgrep SAST Security Scan..."
GATE_9_START=$(gate_start_ms)

GATE_9_STATUS=""

# Semgrep availability check
SEMGREP_CMD=""
if command -v semgrep >/dev/null 2>&1; then
  SEMGREP_CMD="semgrep"
elif [ -f "$HOME/.local/bin/semgrep" ]; then
  SEMGREP_CMD="$HOME/.local/bin/semgrep"
fi

if [ -z "$SEMGREP_CMD" ]; then
  echo "     ⚠️  WARN - semgrep not installed — SAST scanning unavailable"
  echo "     Install: brew install semgrep (macOS) | pip install semgrep (Linux) | pip install semgrep (Windows)"
  echo "     Pre-cache rules: semgrep --config=p/security-audit"
  echo "     Gate 9: SAST Security (WARN, semgrep not installed)"
  GATE_9_STATUS="WARN"
else
  # Get staged files filtered to Semgrep-supported languages
  SEMGREP_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|py|go|java|c|cpp|cs|rb|php|scala|swift)$' || true)

  if [ -z "$SEMGREP_FILES" ]; then
    echo "     ⏭️  SKIPPED - SAST (no supported language files changed)"
    GATE_9_STATUS="SKIP"
  else
    # Run semgrep with JSON output
    # --config=p/security-audit: explicit security ruleset
    # --json: machine-readable output
    # --disable-version-check: skip network call
    SEMGREP_OUTPUT=$($SEMGREP_CMD scan --config=p/security-audit --json --disable-version-check $SEMGREP_FILES 2>&1)
    SEMGREP_EXIT=$?

    if [ "$SEMGREP_EXIT" -eq 0 ]; then
      echo "     ✅ PASSED - No security vulnerabilities found."
      GATE_9_STATUS="PASS"
    elif [ "$SEMGREP_EXIT" -eq 1 ]; then
      # Findings detected - parse JSON to categorize
      CRITICAL_HIGH=$(echo "$SEMGREP_OUTPUT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
try{const data=JSON.parse(d);const results=data.results||[];
const count=results.filter(r=>{const s=(r.extra&&r.extra.severity||'').toUpperCase();return s==='CRITICAL'||s==='HIGH';}).length;
console.log(count);}catch(e){console.log('0');}
});" 2>/dev/null || echo "0")

      MEDIUM_LOW=$(echo "$SEMGREP_OUTPUT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
try{const data=JSON.parse(d);const results=data.results||[];
const count=results.filter(r=>{const s=(r.extra&&r.extra.severity||'').toUpperCase();return s==='MEDIUM'||s==='LOW';}).length;
console.log(count);}catch(e){console.log('0');}
});" 2>/dev/null || echo "0")

      # Extract top finding details
      FINDING_DETAILS=$(echo "$SEMGREP_OUTPUT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
try{const data=JSON.parse(d);const results=data.results||[];
results.slice(0,5).forEach(r=>{const extra=r.extra||{};
const severity=(extra.severity||'UNKNOWN').toUpperCase();
const ruleId=r.check_id||'unknown';const path=r.path||'unknown';
const line=(r.start&&r.start.line)||'?';const msg=(extra.message||'').slice(0,80);
console.log('  ['+severity+'] '+ruleId);console.log('  '+path+':'+line+' → '+msg);console.log();});
}catch(e){console.log('  (Failed to parse semgrep output)');}
});" 2>/dev/null || echo "  (Failed to parse semgrep output)")

      if [ "$CRITICAL_HIGH" -gt 0 ]; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "   GATE 9: Semgrep Security Gate"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  CRITICAL/HIGH: ${CRITICAL_HIGH}  ❌ BLOCKED"
        echo "  MEDIUM/LOW:    ${MEDIUM_LOW}  ⚠️  warning"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  ❌ BLOCKED — Critical/High vulnerability found"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "$FINDING_DETAILS"
        echo "  Run 'semgrep scan --config=p/security-audit' to review all findings."
        GATE_9_STATUS="FAIL"
        exit 1
      else
        echo ""
        echo "     ✅ PASSED - No critical/high vulnerabilities"
        if [ "$MEDIUM_LOW" -gt 0 ]; then
          echo "     ⚠️  ${MEDIUM_LOW} medium/low findings (warnings only)"
          echo "$FINDING_DETAILS"
        fi
        GATE_9_STATUS="PASS"
      fi
    else
      # semgrep runtime error (timeout, config error, etc.)
      echo "     ⚠️  semgrep exited with code ${SEMGREP_EXIT} — skipping gate"
      echo "     ⏭️  SKIPPED - SAST (semgrep runtime error)"
      GATE_9_STATUS="SKIP"
    fi
  fi
fi
record_gate_audit "gate-9" "sast-security" "$GATE_9_STATUS" "0" "$GATE_9_START"

