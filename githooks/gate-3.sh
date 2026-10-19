# shellcheck shell=bash
# ============================================================================
# GATE 3: Cyclomatic Complexity Check
# Uses lizard - checks cyclomatic complexity of changed source files
# ============================================================================

 2>&1 echo ""
 2>&1 echo "→ Gate 3: Cyclomatic complexity..."
GATE_3_START=$(gate_start_ms)
# #537: every non-run records WHY so the report can say why a gate is SKIP.
GATE_3_REASON=""

if [ "$PROJECT_LANG" = "documentation-only" ]; then
  echo "⏭️  SKIPPED - Complexity (documentation project)."
  GATE_3_STATUS="SKIP"
  GATE_3_REASON="documentation_project"

elif [ "$PROJECT_LANG" = "powershell" ]; then
  echo "ℹ️  No PowerShell Clean Code / SOLID tool available"
  echo "⏭️  SKIPPED - Complexity (no PowerShell tool)"
  GATE_3_STATUS="SKIP"
  # #537: a PowerShell-primary repo was invisible to this dimension while the
  # score implied full coverage — say exactly why nothing ran.
  GATE_3_REASON="no_powershell_tool"
  
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

      # REQ-D (sprint-20261018-quality): baseline ratchet. When
      # .ccn-baseline.json exists it replaces the flat threshold verdict:
      # recorded functions may not get WORSE (strictly greater blocks), new
      # functions face the live thresholds, improvements only hint. The
      # legacy path below stays byte-for-byte for repos without a baseline.
      if [ -f ".ccn-baseline.json" ]; then
        # #544: lizard's raw CCN is not what the baseline was recorded with.
        # The baseline comes from scripts/ccn-report.cjs, which re-derives every
        # above-threshold CCN from brace-balanced source (lizard's TS parser
        # loses braces on generic-arrow fields and charges neighbours). Feeding
        # the ratchet raw numbers compared two different engines — a function
        # at its recorded ceiling read as "worse" purely from span inflation.
        # Route the CSV through the same verifier; on rows it cannot verify the
        # helper exits non-zero, and this gate fails closed instead of passing
        # an unvalidated number.
        CC_CSV=$("$LIZARD_PATH" --csv ${CC_FILES_ARGS[@]+"${CC_FILES_ARGS[@]}"} 2>/dev/null || true)
        CC_REPORT="$(git rev-parse --show-toplevel 2>/dev/null)/scripts/ccn-report.cjs"
        if [ -f "$CC_REPORT" ] && command -v node >/dev/null 2>&1; then
          _cc_verify_failed=0
          CC_CSV_VERIFIED=$(printf '%s\n' "$CC_CSV" | node "$CC_REPORT" --csv-verified batch --root "$(git rev-parse --show-toplevel 2>/dev/null)") || _cc_verify_failed=1
          if [ "$_cc_verify_failed" -ne 0 ]; then
            echo "❌ BLOCKED - complexity could not be span-verified; refusing to grade unverified CCN."
            GATE_3_DETAIL="mode=ratchet verify=FAILED"
            exit 1
          fi
          CC_CSV="$CC_CSV_VERIFIED"
        fi
        RATCHET_LIB="$GATE_DIR/lib/ccn-ratchet.sh"
        [ -f "$RATCHET_LIB" ] || RATCHET_LIB="$(git rev-parse --show-toplevel 2>/dev/null)/githooks/lib/ccn-ratchet.sh"
        # shellcheck source=/dev/null
        . "$RATCHET_LIB"
        # NOTE: the thresholds must be plain assignments BEFORE the pipe. As a
        # prefix to a variable assignment (`T=1 V=$(... | fn)`) they land in the
        # assignment's subshell, so the function sees no thresholds AND reads an
        # empty stdin — the verdict comes back empty and Gate 3 passes on zero
        # rows (measured while wiring #544: same input passed or blocked
        # depending only on where the prefix sat).
        CCN_WARN_THRESHOLD="$CCN_THRESHOLD"
        CCN_BLOCK_THRESHOLD=$((CCN_THRESHOLD * 2))
        RATCHET_VERDICT=$(printf '%s\n' "$CC_CSV" | evaluate_ccn_ratchet ".ccn-baseline.json")
        CC_WARNINGS=$(printf '%s\n' "$RATCHET_VERDICT" | grep -c '^BLOCK ' || true)
        CC_LOWER=$(printf '%s\n' "$RATCHET_VERDICT" | grep -c '^LOWER ' || true)
        printf '%s\n' "$RATCHET_VERDICT" | grep -v '^OK ' || true
        if [ "${CC_LOWER:-0}" -gt 0 ]; then
          echo "ℹ️  $CC_LOWER function(s) improved below baseline — refresh with: node scripts/ccn-report.cjs --write-baseline"
        fi
        GATE_3_DETAIL="mode=ratchet"
        if [ "${CC_WARNINGS:-0}" -gt 0 ]; then
          echo ""
          echo "❌ BLOCKED - $CC_WARNINGS function(s) violate the complexity ratchet (.ccn-baseline.json)."
          echo "Revert the increase, or refactor; refresh the baseline only via ccn-baseline-refresh commits."
          exit 1
        else
          echo "✅ PASSED - Complexity within ratchet baseline."
          GATE_3_STATUS="PASS"
        fi
      else
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
      fi
    else
      echo "⏭️  SKIPPED - Complexity (no source files to check)."
      GATE_3_STATUS="SKIP"
      GATE_3_REASON="no_source_files_changed"
    fi
  else
    echo "⚠️  WARN - lizard not installed, complexity check not performed"
    echo "   Install with: pip install --user lizard"
    echo "   Gate 3: Complexity check (WARN, tool not available)"
    GATE_3_STATUS="WARN"
    GATE_3_REASON="tool_not_installed"
  fi
fi
record_gate_audit "gate-3" "complexity" "$GATE_3_STATUS" "${CC_WARNINGS:-0}" "$GATE_3_START" "ccn_threshold=${CCN_THRESHOLD:-5}${GATE_3_DETAIL:+ $GATE_3_DETAIL}"
