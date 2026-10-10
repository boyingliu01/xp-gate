# shellcheck shell=bash
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
  # S2 (#507): three-level CCN threshold override --
  # .xp-gate/ccn-threshold (positive integer) > XP_GATE_CCN_THRESHOLD > 5.
  # Invalid values WARN on stderr and fall back to the default; the resolved
  # value reaches the gate-3 audit record via the --detail argument below.
  # Implemented with bash builtins only (no tr/grep spawns): every process
  # spawn is expensive on Windows under AV filter drivers.
  resolve_ccn_threshold() {
    local default=5 val
    if [ -f ".xp-gate/ccn-threshold" ]; then
      val=$(<".xp-gate/ccn-threshold")
      val="${val//[[:space:]]/}"
      case "$val" in
        ''|*[!0-9]*|0)
          echo "WARN - invalid .xp-gate/ccn-threshold value '${val}' (expected a positive integer), falling back to ${default}" >&2
          ;;
        *)
          echo "$val"
          return 0
          ;;
      esac
      echo "$default"
      return 0
    fi
    val=${XP_GATE_CCN_THRESHOLD:-}
    if [ -n "$val" ]; then
      case "$val" in
        ''|*[!0-9]*|0)
          echo "WARN - invalid XP_GATE_CCN_THRESHOLD value '${val}' (expected a positive integer), falling back to ${default}" >&2
          ;;
        *)
          echo "$val"
          return 0
          ;;
      esac
    fi
    echo "$default"
  }

  CCN_THRESHOLD=$(resolve_ccn_threshold)
  
  # Check lizard availability
  LIZARD_CMD=""
  if command -v lizard > /dev/null 2>&1; then
    LIZARD_CMD=lizard
  elif [ -f ~/.local/bin/lizard ]; then
    LIZARD_CMD=~/.local/bin/lizard
  fi
  
  if [ -n "$LIZARD_CMD" ]; then
    LIZARD_PATH=$(eval echo "$LIZARD_CMD")
    
    # Get changed source files for complexity check (includes test files)
    CC_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx|js|jsx|py|go|java|swift|cpp|c|hpp|h|m|mm|kt)$' || true)
    
    if [ -n "$CC_FILES" ]; then
      echo "Checking complexity for source files..."
      
      # Run lizard with CCN threshold
      # One path per line, into an array. Unquoted $CC_FILES relied on word
      # splitting, which also splits any path containing a space -- handing
      # lizard two bogus paths and checking neither (#457 defect class, same
      # fix as gate-4's PRINCIPLES_ARGS). Quoting the scalar would instead
      # collapse the list into one argument. An array does both.
      CC_FILES_ARGS=()
      while IFS= read -r _cc_file; do
        [ -n "$_cc_file" ] && CC_FILES_ARGS+=("$_cc_file")
      done <<< "$CC_FILES"
      CC_OUTPUT=$("$LIZARD_PATH" -C "$CCN_THRESHOLD" ${CC_FILES_ARGS[@]+"${CC_FILES_ARGS[@]}"} 2>&1 || true)
      
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
record_gate_audit "gate-3" "complexity" "$GATE_3_STATUS" "${CC_WARNINGS:-0}" "$GATE_3_START" "ccn_threshold=${CCN_THRESHOLD:-5}"
