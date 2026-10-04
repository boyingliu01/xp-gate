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

  # One path per line, into an array. Passing $PRINCIPLES_FILES unquoted relies on
  # word splitting to turn the list into separate argv entries, which also splits
  # any path containing a space -- handing the checker two bogus paths and checking
  # neither. Quoting it would instead collapse the list into one argument. An array
  # is the only form that does both. Same defect class as the --config fix (#457).
  PRINCIPLES_ARGS=()
  while IFS= read -r _principles_file; do
    [ -n "$_principles_file" ] && PRINCIPLES_ARGS+=("$_principles_file")
  done <<< "$PRINCIPLES_FILES"
  
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
        # Run principles checker and store results.
        #
        # Do NOT wrap this in `if ...; then`: the checker's exit codes are
        # deliberately distinct (0 clean, 1 ERROR-severity findings, >=2 tool
        # failure), and an `if` collapses 1 and 2 into "failed". That sent real
        # error-severity findings down the crash branch, which SKIPs and prints
        # PASSED -- releasing exactly the most serious violations.
        # The trailing `|| PRINCIPLES_EXIT=$?` captures the exit status without
        # letting a non-zero return abort the hook under `set -e`. Do not simplify
        # this to a bare call followed by `PRINCIPLES_EXIT=$?`: under `set -e` the
        # script never reaches the assignment, and `|| true` would overwrite the
        # status with 0 -- which is exactly the distinction this gate depends on.
        PRINCIPLES_EXIT=0
        npx tsx "$PRINCIPLES_DIR/index.ts" --files ${PRINCIPLES_ARGS[@]+"${PRINCIPLES_ARGS[@]}"} --format json > /tmp/principles-output.json 2>/dev/null || PRINCIPLES_EXIT=$?

        if [ "$PRINCIPLES_EXIT" -ge 2 ]; then
          echo "⚠️  Warning: Principles checker execution failed"
          echo "⏭️  SKIPPED - Principles check (execution issue)"
          GATE_4_STATUS="SKIP"
        else
          # Check severity levels. The reporter emits JSON.stringify(out, null, 2),
          # i.e. `"severity": "warning"` WITH a space; tolerate any whitespace so a
          # future minified format cannot silently zero these counts again (#444).
          ERROR_COUNT=$(grep -cE '"severity"[[:space:]]*:[[:space:]]*"error"' /tmp/principles-output.json 2>/dev/null || true)
          ERROR_COUNT=${ERROR_COUNT:-0}
          WARNING_COUNT=$(grep -cE '"severity"[[:space:]]*:[[:space:]]*"warning"' /tmp/principles-output.json 2>/dev/null || true)
          WARNING_COUNT=${WARNING_COUNT:-0}
          
          if [ "$ERROR_COUNT" -gt 0 ]; then
            echo ""
            echo "❌ BLOCKED - $ERROR_COUNT principle ERROR(S) found"
            echo "Critical violations must be fixed before commit:"
            echo "  - error-handling violations"
            echo "  - SOLID principle violations"
            echo "  - architectural violations"
            npx tsx "$PRINCIPLES_DIR/index.ts" --files ${PRINCIPLES_ARGS[@]+"${PRINCIPLES_ARGS[@]}"} --format console
            GATE_4_STATUS="FAIL"
            exit 1
          fi
          
          echo "✅ PASSED - Principles checker (no errors found)."
          GATE_4_STATUS="PASS"
          if [ "$WARNING_COUNT" -gt 0 ]; then
            echo "ℹ️  $WARNING_COUNT warnings found (will be handled by Boy Scout Rule)."
          fi
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
