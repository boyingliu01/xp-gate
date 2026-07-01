# ============================================================================
# GATE 3: Cyclomatic Complexity Check
# Uses lizard - checks cyclomatic complexity of changed source files
# ============================================================================

 2>&1 echo ""
 2>&1 echo "→ Gate 3: Cyclomatic complexity..."
GATE_3_START=$(gate_start_ms)

if [ "$PROJECT_LANG" = "documentation-only" ]; then
  echo "⏭️  SKIPPED - Complexity (documentation project)."
  GATE_3_STATUS="SKIP"

elif [ "$PROJECT_LANG" = "powershell" ]; then
  echo "ℹ️  No PowerShell Clean Code / SOLID tool available"
  echo "⏭️  SKIPPED - Complexity (no PowerShell tool)"
  GATE_3_STATUS="SKIP"
  
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
        exit 1
      else
        echo "✅ PASSED - All functions within complexity threshold ($CCN_THRESHOLD)."
        GATE_3_STATUS="PASS"
      fi
    else
      echo "⏭️  SKIPPED - Complexity (no source files to check)."
      GATE_3_STATUS="SKIP"
    fi
  else
    echo "⚠️  WARN - lizard not installed, complexity check not performed"
    echo "   Install with: pip install --user lizard"
    echo "   Gate 3: Complexity check (WARN, tool not available)"
    GATE_3_STATUS="WARN"
  fi
fi
record_gate_audit "gate-3" "complexity" "$GATE_3_STATUS" "${CC_WARNINGS:-0}" "$GATE_3_START"
