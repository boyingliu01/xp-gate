#!/usr/bin/env bash
# ============================================================================
# gate-2 entry — extracted from pre-commit by scripts/extract-gates.cjs
#
# WHY THIS FILE EXISTS (#798)
#   The gate order used to BE the physical order of blocks in a 6341-line
#   hook, so changing the order meant moving thousands of lines. An attempt at
#   that also moved the hook epilogue, after which every gate past Gate 13
#   silently stopped running while `bash -n`, a line count and five ordering
#   tests all passed. Gate 5a stopped blocking and only a behavioural test
#   noticed. With one file per gate, order is a list of names in
#   pre-commit's GATE_ORDER and cannot detach a body from its position.
#
# THE BODY BELOW IS A BYTE-EXACT SLICE of the original block. It is wrapped
# in a function so the gate keeps its own variable scope, and is called from
# pre-commit at the point the driver reaches it. Edit the gate here from now
# on - there is no copy left in the hook.
# ============================================================================

# ============================================================================
# GATE 2: Duplicate Code Detection (NEW gate)
# Uses jscpd, or similar tools, specific to language
# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_2_run() {
 2>&1 echo ""
 2>&1 echo "→ Gate 2: Duplicate code detection..."
GATE_2_START=$(gate_start_ms)
GATE_2_STATUS="PASS"

if ! gate_enabled 2; then
  echo "⏭️  SKIPPED - Gate 2: Duplicate code (not selected by XP_GATE_ONLY_GATE)"
  GATE_2_STATUS="SKIP"
  GATE_2_DETAIL="not_selected"

elif [ "$PROJECT_LANG" = "documentation-only" ] || [ "$DOCS_ONLY_COMMIT" = true ]; then
echo "⏭️  SKIPPED - Duplicate code (documentation-only ${DOCS_ONLY_COMMIT:+commit})."
GATE_2_STATUS="SKIP"
 # GATE_2_DETAIL feeds record_gate_audit's detail field. The previous
 # GATE_2_REASON was assigned and never read by anything, which is worse than
 # useless: it looks like the skip reason reaches the audit journal when it does
 # not (no set -u, so nothing complained).
 GATE_2_DETAIL="docs_only_change"

else
  for CURRENT_LANG in $PROJECT_LANGS; do
    echo "   ── Checking $CURRENT_LANG ──"
    case "$CURRENT_LANG" in
      typescript)
  if ! require_tool "jscpd" "Gate 2" "npm install -D jscpd"; then
    return 1
  fi
  
  echo "Running jscpd for duplicate code detection..."
  # #477: only pass --config when the file actually exists, and let jscpd's report
  # decide the message. Before this, a missing config produced "os error 2" and a
  # non-zero exit that the gate translated into a fabricated "found duplicated
  # code"; a real clone report that exited 0 was announced as a clean pass.
  JSCPD_CONFIG=$(resolve_jscpd_config)
  JSCPD_ARGS=()
  if [ -n "$JSCPD_CONFIG" ]; then
    JSCPD_ARGS=(--config "$JSCPD_CONFIG")
  else
    # #591: with no project config, jscpd's own defaults treat .yaml/.txt/.log as
    # scannable source, so an exemptions manifest, a golden snapshot and two build
    # logs were reported as "duplicated code" (measured: 48.72% on a fixture with
    # no source in it). Print the baseline that is actually in force, or the user
    # cannot tell what was scanned.
    echo "ℹ️  No jscpd.conf.json found - using the xp-gate default ignore set"
    echo "   $(jscpd_default_ignore_patterns)"
  fi
  # #591: drop data/evidence/build-output paths before the scan. Real source
  # extensions are untouched, so this narrows the noise, not the gate.
  JSCPD_SCAN_FILES=()
  while IFS= read -r _jf; do
    [ -n "$_jf" ] || continue
    if ! jscpd_is_default_ignored "$_jf"; then
      JSCPD_SCAN_FILES+=("$_jf")
    fi
  done <<EOF_CHANGED
$CHANGED_FILES
EOF_CHANGED
  JSCPD_OUTPUT=$(mktemp)
  JSCPD_EXIT=0
  jscpd ${JSCPD_ARGS[@]+"${JSCPD_ARGS[@]}"} ${JSCPD_SCAN_FILES[@]+"${JSCPD_SCAN_FILES[@]}"} > "$JSCPD_OUTPUT" 2>&1 || JSCPD_EXIT=$?
  head -30 "$JSCPD_OUTPUT" || true
  JSCPD_OUTCOME=$(classify_jscpd_run "$JSCPD_EXIT" "$(cat "$JSCPD_OUTPUT")")
  rm -f "$JSCPD_OUTPUT"
  if [ "$JSCPD_OUTCOME" = "duplicates" ]; then
    echo "ℹ️  jscpd found duplicated code (warning, not blocking by default)"
    echo "   Consider refactoring duplicate code blocks."
  elif [ "$JSCPD_OUTCOME" = "error" ]; then
    echo "⚠️  jscpd exited with code $JSCPD_EXIT without a report — the output above is its real error"
    echo "⏭️  SKIPPED - Duplicate code (jscpd run error)"
    GATE_2_STATUS="SKIP"
  elif [ "$JSCPD_OUTCOME" = "no_files" ]; then
    # jscpd ran, exited 0, and examined nothing -- its own stderr says so. That is
    # not a clean scan: "Found 0 clones" over zero files is a statement about the
    # filter, not about the code. Measured 2026-11-19 on a Dart fixture, where the
    # change set named a .dart file that jscpd's --format set did not cover: the
    # table read "Total: 0 files" and Gate 2 still recorded PASS.
    #
    # SKIP, not BLOCK: the project may legitimately contain no file of a type
    # jscpd understands, and blocking would punish a language for jscpd's format
    # list. SKIP with this reason keeps it distinguishable from "checked, clean".
    echo "⏭️  SKIPPED - Duplicate code (jscpd analysed no files)"
    echo "   jscpd exited 0 but examined 0 files, so its 'Found 0 clones' is not a"
    echo "   verdict on this change set. Check that the changed file extensions are"
    echo "   covered by jscpd's --format set (or the project's jscpd config)."
    GATE_2_STATUS="SKIP"
    GATE_2_DETAIL="jscpd_analysed_no_files"
  else
    echo "✅ PASSED - jscpd duplicate code check completed."
  fi
    ;;
    
    python)
  if command -v pylint &> /dev/null; then
    echo "Running pylint duplicate detection..."
    # Array, not an unquoted substitution: with no .py file in the change set the
    # old form expanded to zero arguments and pylint was invoked on the whole
    # cwd; with a path containing a space it expanded to two bogus paths. The
    # `if ! require` guard keeps this arm from running on an empty list.
    PYLINT_FILES=()
    while IFS= read -r _pf; do
      [ -n "$_pf" ] || continue
      PYLINT_FILES+=("$_pf")
    done <<PYLINT_LIST
$(echo "$CHANGED_FILES" | grep "\.py$" || true)
PYLINT_LIST
    if [ "${#PYLINT_FILES[@]}" -eq 0 ]; then
      echo "ℹ️  No .py files in this change set — nothing to scan."
    else
      pylint --disable=all --enable=duplicate-code "${PYLINT_FILES[@]}"
      DUPLICATE_EXIT=$?
      if [ "$DUPLICATE_EXIT" -ne 0 ]; then
        # pylint's exit status is a BITMASK (1 fatal, 2 error, 4 warning,
        # 8 refactor, 16 convention, 32 usage error). duplicate-code is a
        # REFACTOR message, so "found duplicates" is bit 8 -- and a fatal error
        # or a crash also exits non-zero. The old code treated every non-zero as
        # "found duplicates (warning)" and every zero as "✅ PASSED", so a pylint
        # that could not even start still reached the PASS line below.
        if [ $(( DUPLICATE_EXIT & 1 )) -ne 0 ]; then
          echo "⏭️  SKIPPED - Duplicate code (pylint fatal error, exit $DUPLICATE_EXIT)"
          GATE_2_STATUS="SKIP"
          GATE_2_DETAIL="pylint_fatal"
        elif [ $(( DUPLICATE_EXIT & 32 )) -ne 0 ]; then
          echo "⏭️  SKIPPED - Duplicate code (pylint usage error, exit $DUPLICATE_EXIT)"
          GATE_2_STATUS="SKIP"
          GATE_2_DETAIL="pylint_usage_error"
        elif [ $(( DUPLICATE_EXIT & 8 )) -ne 0 ]; then
          echo "ℹ️  pylint found duplicate code (warning, not typically blocking)"
        else
          echo "ℹ️  pylint reported other messages (exit $DUPLICATE_EXIT); duplicate-code was not among them."
        fi
      else
        echo "✅ PASSED - pylint found no duplicates."
      fi
    fi
  else
    echo "ℹ️  pylint not found — skipping Python duplicate code check."
    echo "   Install pylint: pip install pylint"
    echo "⏭️  SKIPPED - Duplicate code (pylint not installed)"
    GATE_2_STATUS="SKIP"
    GATE_2_DETAIL="pylint_not_installed"
  fi
    ;;
    
    go)
  if ! require_tool "jscpd" "Gate 2" "npm install -D jscpd"; then
    return 1
  fi
  
  echo "Running jscpd for Go duplicate code detection..."
  # Reading one path per line into an ARRAY fixes two defects that shared this
  # one line:
  #   - `head -20` silently dropped every .go file past the twentieth. Measured
  #     in a 30-file fixture: jscpd was handed 20 paths and the other 10 were
  #     never scanned, with no message saying so. A scan that quietly covers part
  #     of the change set is the same lie as one that covers none of it.
  #   - unquoted `$FILES_TO_CHECK` relied on word splitting, which also splits a
  #     path containing a space -- handing jscpd two bogus paths (#457 class,
  #     same fix gate 3's lizard call already carries).
  # Chunked rather than one argv for the whole list: Windows caps a command line
  # at 32,767 characters, and an oversized argv fails without scanning anything.
  GO_JSCPD_FILES=()
  while IFS= read -r _gof; do
    [ -n "$_gof" ] || continue
    GO_JSCPD_FILES+=("$_gof")
  done <<GO_LIST
$(echo "$CHANGED_FILES" | grep "\.go$" || true)
GO_LIST
  if [ "${#GO_JSCPD_FILES[@]}" -gt 0 ]; then
    # #392-#9: capture jscpd's real exit code via temp file instead of piping
    # through head (which would swallow the exit status under pipefail analysis).
    GO_JSCPD_TMP=$(mktemp)
    JSCPD_GO_EXIT=0
    GO_ARGV_BUDGET="${XP_GATE_JSCPD_ARGV_BUDGET:-8000}"
    GO_BATCH=()
    GO_SIZE=0
    for _gof in "${GO_JSCPD_FILES[@]}"; do
      if [ "${#GO_BATCH[@]}" -gt 0 ] && [ $((GO_SIZE + ${#_gof} + 1)) -gt "$GO_ARGV_BUDGET" ]; then
        jscpd "${GO_BATCH[@]}" >> "$GO_JSCPD_TMP" 2>&1 || JSCPD_GO_EXIT=$?
        GO_BATCH=()
        GO_SIZE=0
      fi
      GO_BATCH+=("$_gof")
      GO_SIZE=$((GO_SIZE + ${#_gof} + 1))
    done
    if [ "${#GO_BATCH[@]}" -gt 0 ]; then
      jscpd "${GO_BATCH[@]}" >> "$GO_JSCPD_TMP" 2>&1 || JSCPD_GO_EXIT=$?
    fi
    head -10 "$GO_JSCPD_TMP"
    rm -f "$GO_JSCPD_TMP"
    if [ "$JSCPD_GO_EXIT" -ne 0 ]; then
      # This used to print the warning and then fall through to "✅ PASSED -
      # Go duplicate code check completed." below, unconditionally. Measured with
      # a jscpd stub exiting 1:
      #     ⚠️  jscpd (Go) exited with code 1
      #     ✅ PASSED - Go duplicate code check completed.
      #     [audit] status=PASS
      # A tool that failed to run is not a clean result, and the Go half is the
      # one place in this gate that never consulted an outcome at all.
      echo "⏭️  SKIPPED - Duplicate code (jscpd Go run error, exit $JSCPD_GO_EXIT)"
      GATE_2_STATUS="SKIP"
      GATE_2_DETAIL="jscpd_go_run_error"
    elif [ "$GATE_2_STATUS" = "PASS" ]; then
      echo "✅ PASSED - Go duplicate code check completed."
    fi
  else
    echo "ℹ️  No .go files in this change set — nothing to scan."
  fi
    ;;
    
    powershell)
  echo "ℹ️  No PowerShell-native duplicate detector (jscpd does not support .ps1)"
  echo "⏭️  SKIPPED - Duplicate code (no tool for PowerShell)"
  # These two arms printed SKIP prose and set nothing. GATE_2_STATUS kept its
  # initial "PASS", so the journal recorded a pass for a language that was never
  # scanned -- the same defect the TypeScript/Go/generic arms just had removed,
  # surviving here because these arms never claimed to have scanned anything.
  # They still do not claim it; but "no verdict" was being recorded as "passed".
  GATE_2_STATUS="SKIP"
  GATE_2_DETAIL="no_tool_for_powershell"
    ;;
    
    shell)
  echo "ℹ️  Duplicate detection not typically used for shell scripts"
  echo "⏭️  SKIPPED - Duplicate code (no tool for shell scripts)"
  GATE_2_STATUS="SKIP"
  GATE_2_DETAIL="no_tool_for_shell"
    ;;
    
    *)
  SOURCE_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx|js|jsx|py|go|java|scala|kt|cpp|c|h|rs|php|dart|swift|cs|csx|fs|vb)$' || true)
  if [ -n "$SOURCE_FILES" ]; then
    if ! require_tool "jscpd" "Gate 2" "npm install -D jscpd"; then
      return 1
    fi
    echo "Running jscpd for duplicate code detection..."
    # #591 point 4: this branch piped straight into `head`, so jscpd's exit status
    # was replaced by head's (and SIGPIPE under pipefail) — inconsistent with the
    # temp-file treatment the typescript branch already had from #477/#392. The
    # #591 default ignore set applies here too.
    GENERIC_JSCPD_FILES=()
    while IFS= read -r _gf; do
      [ -n "$_gf" ] || continue
      if ! jscpd_is_default_ignored "$_gf"; then
        GENERIC_JSCPD_FILES+=("$_gf")
      fi
    done <<EOF_GENERIC
$SOURCE_FILES
EOF_GENERIC
    if [ "${#GENERIC_JSCPD_FILES[@]}" -gt 0 ]; then
      GENERIC_JSCPD_TMP=$(mktemp)
      jscpd ${GENERIC_JSCPD_FILES[@]+"${GENERIC_JSCPD_FILES[@]}"} > "$GENERIC_JSCPD_TMP" 2>&1 || GENERIC_JSCPD_EXIT=$?
      head -15 "$GENERIC_JSCPD_TMP" || true
      rm -f "$GENERIC_JSCPD_TMP"
      if [ "${GENERIC_JSCPD_EXIT:-0}" -ne 0 ]; then
        # Same shape as the Go arm: a warning, then an unconditional "✅ PASSED"
        # on the next line. Measured with a jscpd stub exiting 2:
        #     ⚠️  jscpd exited with code 2 (see output above)
        #     ✅ PASSED - jscpd check completed.
        echo "⏭️  SKIPPED - Duplicate code (jscpd run error, exit $GENERIC_JSCPD_EXIT)"
        GATE_2_STATUS="SKIP"
        GATE_2_DETAIL="jscpd_run_error"
      fi
    fi
    if [ "$GATE_2_STATUS" = "PASS" ]; then
      echo "✅ PASSED - jscpd check completed."
    fi
  else
    echo "✅ PASSED - No source files detected for duplicate checking."
  fi
    ;;
    esac
  done
fi
# Set at the top of this gate; a branch may already have marked it SKIP (#477). The
# audit must record what happened, not what the gate defaults to.
record_gate_audit "gate-2" "duplicate-code" "$GATE_2_STATUS" "0" "$GATE_2_START" "${GATE_2_DETAIL:-}"
  return 0
}



# Called by pre-commit's ordered driver.

