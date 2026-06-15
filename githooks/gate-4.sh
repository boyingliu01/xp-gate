# ============================================================================
# GATE 4: Principles Checker (Clean Code + SOLID)
# Reuses existing principles checker logic
# ============================================================================

 2>&1 echo ""
 2>&1 echo "→ Gate 4: Principles checker (Clean Code + SOLID)..."
GATE_4_START=$(gate_start_ms)

GATE_4_STATUS=""

if [ "$PROJECT_LANG" = "documentation-only" ]; then
  echo "⏭️  SKIPPED - Principles check (documentation project)."
  GATE_4_STATUS="SKIP"
  
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
            npx tsx src/principles/index.ts --files $PRINCIPLES_FILES --format console
            GATE_4_STATUS="FAIL"
            exit 1
          fi
          
          echo "✅ PASSED - Principles checker (no errors found)."
          GATE_4_STATUS="PASS"
          if [ "$WARNING_COUNT" -gt 0 ]; then
            echo "ℹ️  $WARNING_COUNT warnings found (will be handled by Boy Scout Rule)."
          fi
        else
          echo "⚠️  Warning: Principles checker execution failed"
          echo "⏭️  SKIPPED - Principles check (execution issue)"
          GATE_4_STATUS="SKIP"
        fi
      else
        echo "ℹ️  npx not available - skipping principles check"
        echo "⏭️  SKIPPED - Principles check (no Node.js/npx)"
        GATE_4_STATUS="SKIP"
      fi
    else
      echo "ℹ️  Principles checker not found in project - skipping"
      echo "⏭️  SKIPPED - Principles check (checker not in project)"
      GATE_4_STATUS="SKIP"
    fi
  else
    echo "⏭️  SKIPPED - Principles check (no matching source files changed)"
    GATE_4_STATUS="SKIP"
  fi
fi
record_gate_audit "gate-4" "principles" "$GATE_4_STATUS" "${WARNING_COUNT:-0}" "$GATE_4_START"
