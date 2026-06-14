# Gate 3: Cyclomatic Complexity Check
# Tool: lizard
# Threshold: CCN > 5 (warn), > 10 (block)
# Usage: source this file from pre-commit after setting CHANGED_FILES, PROJECT_LANG

GATE_3_STATUS="PASS"
CC_WARNINGS=0

GATE_3_START=$(gate_start_ms)

if [ "$PROJECT_LANG" = "documentation-only" ]; then
  echo "✅ PASSED - Skipped (documentation project)."

elif [ "$PROJECT_LANG" = "powershell" ]; then
  echo "ℹ️  No PowerShell principles checker available"
  echo "✅ PASSED - Skipped (no PowerShell Clean Code / SOLID tool)"
  
else
  CCN_THRESHOLD=5
  
  # Check lizard availability
  LIZARD_CMD=""
  if command -v lizard > /dev/null 2>&1; then
    LIZARD_CMD=lizard
  elif [ -f ~/.local/bin/lizard ]; then
    LIZARD_CMD=~/.local/bin/lizard
  fi
  
  if [ -n "$LIZARD_CMD" ]; then
    LIZARD_PATH=$(eval echo "$LIZARD_CMD")
    
    # Get changed source files for complexity check
    CC_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx|js|jsx|py|go|java|swift|cpp|c|hpp|h|m|mm|kt)$' || true)
    
    if [ -n "$CC_FILES" ]; then
      echo "Checking complexity for source files..."
      
      # Run lizard with CCN threshold
      CC_OUTPUT=$($LIZARD_PATH -C $CCN_THRESHOLD $CC_FILES 2>&1 || true)
      
      # Parse warning count from the summary table: "Warning cnt   8"
      # Use anchored grep to avoid matching lizard table headers (e.g. "Rt" column)
      CC_WARNINGS=$(echo "$CC_OUTPUT" | grep "^Warning cnt" | awk '{print $NF}' | tr -d '[:space:]' | sed 's/[^0-9]//g' || true)
      CC_WARNINGS=${CC_WARNINGS:-0}
      
      if [ "$CC_WARNINGS" -gt 0 ]; then
        echo "$CC_OUTPUT"
        echo ""
        echo "❌ BLOCKED - $CC_WARNINGS functions with CCN > $CCN_THRESHOLD found."
        echo "Refactor high-complexity functions to keep below $CCN_THRESHOLD complexity."
        GATE_3_STATUS="FAIL"
        exit 1
      else
        echo "✅ PASSED - All functions within complexity threshold ($CCN_THRESHOLD)."
      fi
    else
      echo "✅ PASSED - No source files to check for complexity."
    fi
  else
    echo "⚠️  WARN - lizard not installed, complexity check not performed"
    echo "   Install with: pip install --user lizard"
    echo "   Gate 3: Complexity check (WARN, tool not available)"
    GATE_3_STATUS="WARN"
  fi
fi

# Note: GATE_3_STATUS and CC_WARNINGS are set for caller to use
# Caller must call: record_gate_audit "gate-3" "complexity" "$GATE_3_STATUS" "${CC_WARNINGS:-0}" "$GATE_3_START"
