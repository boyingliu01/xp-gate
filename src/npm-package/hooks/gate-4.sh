# ============================================================================
# GATE 4: Principles Checker (Clean Code + SOLID)
# Reuses existing principles checker logic
# ============================================================================

# Run a TypeScript entrypoint under tsx without routing arguments through the
# npx shim: Windows cmd.exe caps command lines at 8191 chars and long staged
# file lists overflow it, turning a healthy run into a false BLOCK. Prefer the
# repo-local tsx CLI driven by node directly; keep npx as fallback for consumer
# repos relying on a global install. Defined here as well so this module also
# works when sourced outside pre-commit.
if ! declare -F run_tsx >/dev/null 2>&1; then
  run_tsx() {
    local _root="${PROJECT_ROOT:-$(pwd)}" _timeout=()
    if [ -n "${RUN_TSX_TIMEOUT:-}" ]; then
      _timeout=(timeout "$RUN_TSX_TIMEOUT")
    fi
    if [ -f "$_root/node_modules/tsx/dist/cli.mjs" ] && command -v node >/dev/null 2>&1; then
      "${_timeout[@]}" node "$_root/node_modules/tsx/dist/cli.mjs" "$@"
    else
      "${_timeout[@]}" npx tsx "$@"
    fi
  }
fi

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
    # Check for principles checker in installed modules first, then project src/.
    # Probes go through PROJECT_ROOT FIRST: in single-language-subdirectory mode
    # the hook has cd'd into the subdir (#478) and repo-root .xp-gate/ and
    # src/principles/ are invisible from there, so resolution silently fell
    # through to the $HOME copy. The CWD-relative probes are kept as fallback
    # for plain root projects (unchanged behaviour).
    PRINCIPLES_DIR=""
    _PR_ROOT="${PROJECT_ROOT:-$(pwd)}"
    for _pr_dir in "$_PR_ROOT/.xp-gate/modules/principles" \
                   "$_PR_ROOT/src/principles" \
                   ".xp-gate/modules/principles" \
                   "src/principles" \
                   "$HOME/.config/xp-gate/modules/principles"; do
      if [ -n "$_pr_dir" ] && [ -f "$_pr_dir/index.ts" ]; then
        PRINCIPLES_DIR="$_pr_dir"
        break
      fi
    done
    if [ -n "$PRINCIPLES_DIR" ]; then
      # Canonicalise: the run below cd's to PROJECT_ROOT, so a CWD-relative
      # fallback hit must not stay CWD-relative (#478 review finding).
      PRINCIPLES_DIR="$(cd "$PRINCIPLES_DIR" 2>/dev/null && pwd)" || PRINCIPLES_DIR=""
    fi
    
    if [ -n "$PRINCIPLES_DIR" ]; then
      echo "Checking Clean Code + SOLID principles..."
      
      if command -v npx > /dev/null 2>&1 || [ -f "${PROJECT_ROOT:-$(pwd)}/node_modules/tsx/dist/cli.mjs" ]; then
        # Run principles checker and store results. The checker resolves its
        # --files paths against the CWD while CHANGED_FILES is always
        # repo-root-relative (git diff --cached --name-only); in subdir mode the
        # old call died with "Analysis failed: Could not read file: web/..." and
        # the gate reported an "execution issue" for a perfectly healthy checker
        # (#478). Pin the CWD at the repo root so path bases agree.
        PRINCIPLES_OUT=$(mktemp 2>/dev/null || echo "/tmp/principles-output.json")
        PRINCIPLES_ERR=$(mktemp 2>/dev/null || echo "/tmp/principles-error.log")
        # `|| PRINCIPLES_EXIT=$?` keeps this errexit-safe for standalone sourcing
        # (bats runs test bodies under `set -e`): the checker's contract uses
        # exit 1 for "ran with violations", which must not abort the gate.
        PRINCIPLES_EXIT=0
        (cd "$_PR_ROOT" && run_tsx "$PRINCIPLES_DIR/index.ts" --files $PRINCIPLES_FILES --format json > "$PRINCIPLES_OUT" 2> "$PRINCIPLES_ERR") || PRINCIPLES_EXIT=$?
        # src/principles/index.ts contract: exit 0 = ran clean, exit 1 = ran WITH
        # violations (summary.totalViolations > 0). Only a run that produced no
        # parseable JSON is a real execution failure. The old `if run_tsx ...`
        # treated every non-zero exit as a crash, which made the ERROR_COUNT /
        # BLOCK branch unreachable — violations were silently SKIPPED instead of
        # blocking (#478). Keep the failure guard, but only for genuine crashes.
        if grep -q '"summary"' "$PRINCIPLES_OUT" 2>/dev/null; then
          # Check severity levels. The reporter emits JSON.stringify(out, null, 2),
          # i.e. `"severity": "warning"` WITH a space; tolerate any whitespace so a
          # future minified format cannot silently zero these counts again (#444).
          ERROR_COUNT=$(grep -cE '"severity"[[:space:]]*:[[:space:]]*"error"' "$PRINCIPLES_OUT" 2>/dev/null || true)
          ERROR_COUNT=${ERROR_COUNT:-0}
          WARNING_COUNT=$(grep -cE '"severity"[[:space:]]*:[[:space:]]*"warning"' "$PRINCIPLES_OUT" 2>/dev/null || true)
          WARNING_COUNT=${WARNING_COUNT:-0}
          
          if [ "$ERROR_COUNT" -gt 0 ]; then
            echo ""
            echo "❌ BLOCKED - $ERROR_COUNT principle ERROR(S) found"
            echo "Critical violations must be fixed before commit:"
            echo "  - error-handling violations"
            echo "  - SOLID principle violations"
            echo "  - architectural violations"
            (cd "$_PR_ROOT" && run_tsx "$PRINCIPLES_DIR/index.ts" --files $PRINCIPLES_FILES --format console) || true
            rm -f "$PRINCIPLES_OUT" "$PRINCIPLES_ERR"
            GATE_4_STATUS="FAIL"
            exit 1
          fi
          
          echo "✅ PASSED - Principles checker (no errors found)."
          GATE_4_STATUS="PASS"
          if [ "$WARNING_COUNT" -gt 0 ]; then
            echo "ℹ️  $WARNING_COUNT warnings found (will be handled by Boy Scout Rule)."
          fi
        else
          echo "⚠️  Warning: Principles checker execution failed (exit ${PRINCIPLES_EXIT:-?})"
          # Surface the real cause instead of discarding it (#478).
          if [ -s "$PRINCIPLES_ERR" ]; then
            sed 's/^/     /' "$PRINCIPLES_ERR" | tail -5
          fi
          echo "⏭️  SKIPPED - Principles check (execution issue)"
          GATE_4_STATUS="SKIP"
        fi
        rm -f "$PRINCIPLES_OUT" "$PRINCIPLES_ERR"
      else
        echo "ℹ️  npx/tsx not available - skipping principles check"
        echo "⏭️  SKIPPED - Principles check (no Node.js/tsx)"
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
