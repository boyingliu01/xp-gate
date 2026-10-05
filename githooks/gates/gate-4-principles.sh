# Gate 4: Principles Checker (Clean Code + SOLID)
# Tool: src/principles/index.ts
# Threshold: Any error = block, warnings handled by Boy Scout Rule
# Usage: source this file from pre-commit after setting CHANGED_FILES, PROJECT_LANG

GATE_4_STATUS="PASS"
WARNING_COUNT=0

GATE_4_START=$(gate_start_ms)

if has_project_lang "documentation-only" 2>/dev/null || [ "$PROJECT_LANG" = "documentation-only" ]; then
  echo "✅ PASSED - Skipped (documentation project)."
  
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
      
      # Resolve the project's `.principlesrc` from the git toplevel so the gate
      # enforces the SAME thresholds regardless of the process's cwd (#457).
      # Before this, `.principlesrc` was parsed and discarded, so the built-in
      # defaults were enforced instead of the project's.
      #
      # Passed as an ARRAY, not a string: the repo path can contain spaces (the
      # default Windows checkout is under `C:/Users/<name>/...`, and names contain
      # spaces), and an unquoted `--config <path>` would split into two argv entries
      # so the config would be silently ignored -- reintroducing exactly the defect
      # #457 fixes, but only on paths with spaces. Deliberately not written as
      # `PRINCIPLES_CONFIG="--config $PRINCIPLES_ROOT/.principlesrc"`: word splitting
      # on expansion is the bug.
      PRINCIPLES_CONFIG=()
      PRINCIPLES_ROOT="$(run_without_git_context git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
      if [ -f "$PRINCIPLES_ROOT/.principlesrc" ]; then
        PRINCIPLES_CONFIG=(--config "$PRINCIPLES_ROOT/.principlesrc")
      fi
      
      if command -v npx > /dev/null 2>&1; then
        # Run principles checker and store results. `${PRINCIPLES_CONFIG[@]+"${PRINCIPLES_CONFIG[@]}"}`
        # expands to nothing when the array is empty, which `set -u` requires on older
        # bash versions (macOS ships 3.2, where a bare `"${arr[@]}"` is an unbound error).
        # The trailing `|| PRINCIPLES_EXIT=$?` captures the exit status without
        # letting a non-zero return abort the hook under `set -e`. Do not simplify
        # this to a bare call followed by `PRINCIPLES_EXIT=$?`: under `set -e` the
        # script never reaches the assignment, and `|| true` would overwrite the
        # status with 0 -- which is exactly the distinction this gate depends on.
        PRINCIPLES_EXIT=0
        # Keep stderr: it carries the checker's configuration warnings -- a rejected
        # threshold or an out-of-vocabulary severity says so here and nowhere else.
        # Sending it to /dev/null made an exit-2 SKIP undiagnosable and hid every
        # .principlesrc typo (Delphi walkthrough MC-03). Captured to a file so a clean
        # run stays quiet, then replayed only when the checker had a problem.
        PRINCIPLES_STDERR=$(mktemp)
        npx tsx "$PRINCIPLES_DIR/index.ts" --files ${PRINCIPLES_ARGS[@]+"${PRINCIPLES_ARGS[@]}"} --format json ${PRINCIPLES_CONFIG[@]+"${PRINCIPLES_CONFIG[@]}"} > /tmp/principles-output.json 2>"$PRINCIPLES_STDERR" || PRINCIPLES_EXIT=$?

        if [ -s "$PRINCIPLES_STDERR" ]; then
          sed 's/^/     /' "$PRINCIPLES_STDERR"
        fi
        rm -f "$PRINCIPLES_STDERR"

        # Exit codes are distinct on purpose: 0 = ran clean, 1 = ran and found
        # ERROR-severity violations, >=2 = the tool itself failed. Branching on
        # `if run_tsx ...` collapsed 1 and 2 together, so an ERROR-severity finding
        # took the crash branch and the gate SKIPped -- releasing the most serious
        # violations while reporting "PASSED (SKIP)".
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
          if [ "$WARNING_COUNT" -gt 0 ]; then
            echo "ℹ️  $WARNING_COUNT warnings found (will be handled by Boy Scout Rule)."
          fi
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
