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
    # Same anchoring as githooks/gate-4.sh: CHANGED_FILES paths are repo-root relative
    # and the checker resolves them against its own working directory, so both the
    # probes and the invocation run from the repo root. Resolving them against the
    # hook's CWD lost the checker in single-language subdir mode (#478).
    PRINCIPLES_BASE="${PROJECT_ROOT:-$(pwd)}"

    PRINCIPLES_DIR=""
    for _principles_candidate in \
      "$PRINCIPLES_BASE/.xp-gate/modules/principles" \
      "$PRINCIPLES_BASE/src/principles" \
      "$(pwd)/.xp-gate/modules/principles" \
      "$(pwd)/src/principles" \
      "$HOME/.config/xp-gate/modules/principles"; do
      if [ -f "$_principles_candidate/index.ts" ]; then
        PRINCIPLES_DIR="$_principles_candidate"
        break
      fi
    done
    
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
        # letting a non-zero return abort the hook under `set -e`. pre-commit itself
        # runs with only `set -o pipefail` (no `set -e`, pinned by
        # scripts/__tests__/gate-5-runner-error.test.ts AC-454-08), but this module is
        # also sourced by consumer hooks that may set it, and a bare call followed by
        # `PRINCIPLES_EXIT=$?` never reaches the assignment under `set -e`. `|| true`
        # would erase the status -- which is exactly the distinction this gate depends
        # on.
        PRINCIPLES_EXIT=0
        # Keep stderr: it carries the checker's configuration warnings -- a rejected
        # threshold or an out-of-vocabulary severity says so here and nowhere else.
        # Sending it to /dev/null made an exit-2 SKIP undiagnosable and hid every
        # .principlesrc typo (Delphi walkthrough MC-03). Captured to a file so a clean
        # run stays quiet, then replayed only when the checker had a problem.
        # `cd || exit 2`: a base we cannot enter means the checker never ran, which is
        # this module's tool-failure code. Falling through would return the exit status
        # of the failed cd (1), and 1 asserts "I examined files and found errors" -- an
        # empty report at 1 reads as a clean pass.
        #
        # The report is a PER-INVOCATION mktemp, not a shared `/tmp/principles-output.json`:
        # two commits racing on one machine (two worktrees, a hook and a CI job) overwrote
        # each other's report before it was counted, so a run with ERROR findings could
        # read a clean report and PASS (#457). PRINCIPLES_JSON is exported so a caller can
        # point a harness at the same file.
        PRINCIPLES_STDERR=$(mktemp)
        PRINCIPLES_JSON=$(mktemp)
        export PRINCIPLES_JSON
        ( cd "$PRINCIPLES_BASE" 2>/dev/null || exit 2
          npx tsx "$PRINCIPLES_DIR/index.ts" --files ${PRINCIPLES_ARGS[@]+"${PRINCIPLES_ARGS[@]}"} --format json ) > "$PRINCIPLES_JSON" 2>"$PRINCIPLES_STDERR" || PRINCIPLES_EXIT=$?

        if [ -s "$PRINCIPLES_STDERR" ]; then
          sed 's/^/     /' "$PRINCIPLES_STDERR"
        fi
        rm -f "$PRINCIPLES_STDERR"

        if [ "$PRINCIPLES_EXIT" -ge 2 ]; then
          echo "⚠️  Warning: Principles checker execution failed"
          echo "⏭️  SKIPPED - Principles check (execution issue)"
          GATE_4_STATUS="SKIP"
          rm -f "$PRINCIPLES_JSON"
        else
          # Check severity levels. The reporter emits JSON.stringify(out, null, 2),
          # i.e. `"severity": "warning"` WITH a space; tolerate any whitespace so a
          # future minified format cannot silently zero these counts again (#444).
          ERROR_COUNT=$(grep -cE '"severity"[[:space:]]*:[[:space:]]*"error"' "$PRINCIPLES_JSON" 2>/dev/null || true)
          ERROR_COUNT=${ERROR_COUNT:-0}
          WARNING_COUNT=$(grep -cE '"severity"[[:space:]]*:[[:space:]]*"warning"' "$PRINCIPLES_JSON" 2>/dev/null || true)
          WARNING_COUNT=${WARNING_COUNT:-0}
          rm -f "$PRINCIPLES_JSON"
          
          if [ "$ERROR_COUNT" -gt 0 ]; then
            echo ""
            echo "❌ BLOCKED - $ERROR_COUNT principle ERROR(S) found"
            echo "Critical violations must be fixed before commit:"
            echo "  - error-handling violations"
            echo "  - SOLID principle violations"
            echo "  - architectural violations"
            ( cd "$PRINCIPLES_BASE" 2>/dev/null || exit 2
              npx tsx "$PRINCIPLES_DIR/index.ts" --files ${PRINCIPLES_ARGS[@]+"${PRINCIPLES_ARGS[@]}"} --format console )
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
