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
  JSCPD_SCAN_FILES=""
  while IFS= read -r _jf; do
    [ -n "$_jf" ] || continue
    if ! jscpd_is_default_ignored "$_jf"; then
      JSCPD_SCAN_FILES="$JSCPD_SCAN_FILES $_jf"
    fi
  done <<EOF_CHANGED
$CHANGED_FILES
EOF_CHANGED
  JSCPD_OUTPUT=$(mktemp)
  JSCPD_EXIT=0
  # shellcheck disable=SC2086 # pre-existing splitting of the file list; #477/#591 change the scan set, not the splitting
  jscpd ${JSCPD_ARGS[@]+"${JSCPD_ARGS[@]}"} $JSCPD_SCAN_FILES > "$JSCPD_OUTPUT" 2>&1 || JSCPD_EXIT=$?
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
  else
    echo "✅ PASSED - jscpd duplicate code check completed."
  fi
    ;;
    
    python)
  if command -v pylint &> /dev/null; then
    echo "Running pylint duplicate detection..."
    pylint --disable=all --enable=duplicate-code $(echo "$CHANGED_FILES" | grep "\.py$")
    DUPLICATE_EXIT=$?
    if [ "$DUPLICATE_EXIT" -ne 0 ]; then
      echo "ℹ️  pylint found duplicate code (warning, not typically blocking)"
    else
      echo "✅ PASSED - pylint found no duplicates."
    fi
  else
    echo "ℹ️  pylint not found — skipping Python duplicate code check."
    echo "   Install pylint: pip install pylint"
  fi
    ;;
    
    go)
  if ! require_tool "jscpd" "Gate 2" "npm install -D jscpd"; then
    return 1
  fi
  
  echo "Running jscpd for Go duplicate code detection..."
  FILES_TO_CHECK=$(echo "$CHANGED_FILES" | grep "\.go$" | head -20)
  if [ -n "$FILES_TO_CHECK" ]; then
    # #392-#9: capture jscpd's real exit code via temp file instead of piping
    # through head (which would swallow the exit status under pipefail analysis).
    GO_JSCPD_TMP=$(mktemp)
    jscpd $FILES_TO_CHECK > "$GO_JSCPD_TMP" 2>&1
    JSCPD_GO_EXIT=$?
    head -10 "$GO_JSCPD_TMP"
    rm -f "$GO_JSCPD_TMP"
    if [ "$JSCPD_GO_EXIT" -ne 0 ]; then
      echo "⚠️  jscpd (Go) exited with code $JSCPD_GO_EXIT"
    fi
  fi
  echo "✅ PASSED - Go duplicate code check completed."
    ;;
    
    powershell)
  echo "ℹ️  No PowerShell-native duplicate detector (jscpd does not support .ps1)"
  echo "⏭️  SKIPPED - Duplicate code (no tool for PowerShell)"
    ;;
    
    shell)
  echo "ℹ️  Duplicate detection not typically used for shell scripts"
  echo "⏭️  SKIPPED - Duplicate code (no tool for shell scripts)"
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
    GENERIC_JSCPD_FILES=""
    while IFS= read -r _gf; do
      [ -n "$_gf" ] || continue
      if ! jscpd_is_default_ignored "$_gf"; then
        GENERIC_JSCPD_FILES="$GENERIC_JSCPD_FILES $_gf"
      fi
    done <<EOF_GENERIC
$SOURCE_FILES
EOF_GENERIC
    if [ -n "$GENERIC_JSCPD_FILES" ]; then
      GENERIC_JSCPD_TMP=$(mktemp)
      # shellcheck disable=SC2086
      jscpd $GENERIC_JSCPD_FILES > "$GENERIC_JSCPD_TMP" 2>&1 || GENERIC_JSCPD_EXIT=$?
      head -15 "$GENERIC_JSCPD_TMP" || true
      rm -f "$GENERIC_JSCPD_TMP"
      if [ "${GENERIC_JSCPD_EXIT:-0}" -ne 0 ]; then
        echo "⚠️  jscpd exited with code $GENERIC_JSCPD_EXIT (see output above)"
      fi
    fi
    echo "✅ PASSED - jscpd check completed."
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

