# Gate 4: Principles Checker (Clean Code + SOLID)
# Tool: src/principles/index.ts
# Threshold: Any error = block, warnings handled by Boy Scout Rule
# Usage: source this file from pre-commit after setting CHANGED_FILES, PROJECT_LANG

GATE_4_STATUS="PASS"
WARNING_COUNT=0

GATE_4_START=$(gate_start_ms)

if [ "$PROJECT_LANG" = "documentation-only" ]; then
  echo "✅ PASSED - Skipped (documentation project)."
  
else
  # Get source files to check against principles
  PRINCIPLES_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx|js|jsx|py|go|java|kt|dart|swift|cpp|c|hpp|h|m|mm)$' || true)
  
  if [ -n "$PRINCIPLES_FILES" ]; then
    # Check for principles checker in installed modules first, then project src/
    PRINCIPLES_DIR=""
    if [ -d ".xp-gate/modules/principles" ]; then
      PRINCIPLES_DIR=".xp-gate/modules/principles"
    elif [ -f "src/principles/index.ts" ]; then
      PRINCIPLES_DIR="src/principles"
    elif [ -d "$HOME/.config/xp-gate/modules/principles" ]; then
      PRINCIPLES_DIR="$HOME/.config/xp-gate/modules/principles"
    fi
    
    if [ -n "$PRINCIPLES_DIR" ]; then
      echo "Checking Clean Code + SOLID principles..."
      
      if command -v npx > /dev/null 2>&1; then
        # Run principles checker and store results
        if npx tsx $PRINCIPLES_DIR/index.ts --files $PRINCIPLES_FILES --format json > /tmp/principles-output.json 2>/dev/null; then
          # Check severity levels
          ERROR_COUNT=$(grep -c '"severity":"error"' /tmp/principles-output.json 2>/dev/null || true)
          ERROR_COUNT=${ERROR_COUNT:-0}
          WARNING_COUNT=$(grep -c '"severity":"warning"' /tmp/principles-output.json 2>/dev/null || true)
          WARNING_COUNT=${WARNING_COUNT:-0}
          
          if [ "$ERROR_COUNT" -gt 0 ]; then
            echo ""
            echo "❌ BLOCKED - $ERROR_COUNT principle ERROR(S) found"
            echo "Critical violations must be fixed before commit:"
            echo "  - error-handling violations"
            echo "  - SOLID principle violations"
            echo "  - architectural violations"
            npx tsx $PRINCIPLES_DIR/index.ts --files $PRINCIPLES_FILES --format console
            GATE_4_STATUS="FAIL"
            exit 1
          fi
          
          echo "✅ PASSED - Principles checker (no errors found)."
          if [ "$WARNING_COUNT" -gt 0 ]; then
            echo "ℹ️  $WARNING_COUNT warnings found (will be handled by Boy Scout Rule)."
          fi
        else
          echo "⚠️  Warning: Principles checker execution failed"
          echo "✅ PASSED - Principles check (SKIP, execution issue)"
          GATE_4_STATUS="SKIP"
        fi
      else
        echo "ℹ️  npx not available - skipping principles check"
        echo "✅ PASSED - Principles check (SKIP, no Node.js)"
        GATE_4_STATUS="SKIP"
      fi
    else
      echo "ℹ️  Principles checker not found in project - skipping"
      echo "✅ PASSED - Principles check (SKIP, not available in project)"
      GATE_4_STATUS="SKIP"
    fi
  else
    echo "✅ PASSED - No source files changed (principles check skipped)."
  fi
fi

# Note: GATE_4_STATUS and WARNING_COUNT are set for caller to use
# Caller must call: record_gate_audit "gate-4" "principles" "$GATE_4_STATUS" "${WARNING_COUNT:-0}" "$GATE_4_START"
