# shellcheck shell=bash
# ============================================================================
# GATE 10: Semgrep SAST Security Scan
# Detects security vulnerabilities (SQL injection, XSS, etc.) in staged files
# Tool: semgrep -- https://semgrep.dev
# ============================================================================

 2>&1 echo ""
 2>&1 echo "→ Gate 10: Semgrep SAST Security Scan..."
GATE_10_START=$(gate_start_ms)

GATE_10_STATUS=""
# #536: audit trail for "did this commit actually get scanned?". The report
# surfaces reason + scanned_files so a non-scan never reads as a clean PASS.
GATE_10_REASON=""
GATE_10_SCANNED_FILES=0

# Semgrep availability check
SEMGREP_CMD=""
if command -v semgrep >/dev/null 2>&1; then
  SEMGREP_CMD="semgrep"
elif [ -f "$HOME/.local/bin/semgrep" ]; then
  SEMGREP_CMD="$HOME/.local/bin/semgrep"
fi

if [ -z "$SEMGREP_CMD" ]; then
  echo "     ⚠️  WARN - semgrep not installed — SAST scanning unavailable"
  echo "     Install: brew install semgrep (macOS) | pip install semgrep (Linux) | pip install semgrep (Windows)"
  echo "     Pre-cache rules: semgrep --config=p/security-audit"
  echo "     Gate 10: SAST Security (WARN, semgrep not installed)"
  GATE_10_STATUS="WARN"
  GATE_10_REASON="tool_not_installed"
else
  # Get staged files filtered to Semgrep-supported languages
  SEMGREP_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|py|go|java|c|cpp|cs|rb|php|scala|swift)$' || true)

  if [ -z "$SEMGREP_FILES" ]; then
    echo "     ⏭️  SKIPPED - SAST (no supported language files changed)"
    GATE_10_STATUS="SKIP"
    GATE_10_REASON="no_supported_files"
  else
    # One path per line into an array. Quoting the newline-joined list would hand
    # semgrep ONE argument containing newlines -> "Invalid scanning root" once
    # >=2 files are staged (#490). Same defect class as the Gate 4 --files fix
    # (#457): an array is the only form that keeps spaces intact AND splits files.
    #
    # Each element gets a ./ prefix: a tracked path may legitimately start with
    # '-' (`git add -- ./-o.ts`), and bare in argv that element reads as an option
    # and rewrites the scan it was meant to constrain. ./ is a path to every
    # argument parser.
    #
    # The unquoted heredoc below expands $SEMGREP_FILES once, then feeds literal
    # lines to `read`; bash never rescans the result for separators. Its correct
    # reading rests on one property of the producer above, not of the loop:
    # `git diff --cached --name-only` terminates paths with LF and quotes control
    # characters (a CR in a name arrives as the four bytes \215, never as a bare
    # CR), so one line is exactly one path. Asserted for spaces and a leading '-'
    # by AC-490-04.
    SEMGREP_ARGS=()
    while IFS= read -r _semgrep_file; do
      [ -n "$_semgrep_file" ] && SEMGREP_ARGS+=("./$_semgrep_file")
    done <<EOF
$SEMGREP_FILES
EOF

    # The verdict is parsed from the JSON with node (see below), so node is a
    # hard dependency of this gate — check it BEFORE spending a semgrep run
    # (#518 R2): without it we would silently SKIP every finding as
    # "unparseable" and lose the whole security net on minimal CI images.
    if ! command -v node >/dev/null 2>&1; then
      echo "     ⚠️  WARN - node is not installed — Gate 10 needs it to parse semgrep's JSON verdict"
      echo "     Install node (https://nodejs.org); without it SAST findings cannot be classified"
      echo "     ⏭️  SKIPPED - SAST (node not installed)"
      GATE_10_STATUS="SKIP"
      GATE_10_REASON="tool_not_installed"
    else

    # Run semgrep with JSON output. stdout and stderr are captured SEPARATELY:
    # --json writes findings to stdout, progress/summary lines to stderr, and the
    # old `2>&1` merge poisoned the very JSON the verdict now depends on (#518).
    # SEMGREP_OUTPUT keeps its name and role — what the tool said, printed on the
    # SKIP path (AC-475-04).
    #
    # #518: the exit code does NOT carry the verdict. semgrep exits 0 even with
    # ERROR-severity findings, and its exit-code semantics have drifted across
    # versions and platforms (upstream currently reports findings WITH --error
    # as exit 1 and failures as 2, but that mapping is not something a gate
    # should bet on). The JSON carries what the exit code never could —
    # per-severity counts — so the verdict is read from the JSON and the exit
    # code is demoted to "did the tool itself run". --error stays OFF: it would
    # add nothing the JSON does not already provide, and keeping it off leaves
    # failure exit codes unambiguous for the #475 diagnostics path.
    SEMGREP_STDOUT_FILE=$(mktemp)
    SEMGREP_OUTPUT=$("$SEMGREP_CMD" scan --config=p/security-audit --json --disable-version-check "${SEMGREP_ARGS[@]}" 2>&1 >"$SEMGREP_STDOUT_FILE")
    SEMGREP_EXIT=$?

    # One node pass over the JSON: first line = verdict counts, remaining lines =
    # finding details. The severity vocabulary is the UNION of the two scales
    # (#518): semgrep's own ERROR is its most severe tier (it maps to the old
    # CRITICAL/HIGH → BLOCK intent), its WARNING/INFO align with the old
    # MEDIUM/LOW → warnings-only tier. Anything OUTSIDE both lists (missing,
    # empty, or a future/new tier) counts as BLOCKING — a security gate must
    # fail closed on severities it does not recognize (#518 R2). Parsing
    # failure degrades to PARSE=FAIL — a fail-closed SKIP below, never a PASS.
    SEMGREP_VERDICT=$(node -e '
let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
let data;try{data=JSON.parse(d);}catch(e){console.log("PARSE=FAIL RESULTS=0 ERRORS=0 BLOCKING=0 WARNINGS=0");return;}
const results=data.results||[];const errors=data.errors||[];
const sev=r=>((r.extra&&r.extra.severity)||"").toUpperCase();
const WARNV=["WARNING","INFO","MEDIUM","LOW"];
let b=0,w=0;results.forEach(r=>{if(WARNV.indexOf(sev(r))>=0)w++;else b++;});
console.log("PARSE=OK RESULTS="+results.length+" ERRORS="+errors.length+" BLOCKING="+b+" WARNINGS="+w);
results.slice(0,5).forEach(r=>{const extra=r.extra||{};const s=sev(r)||"UNKNOWN";
console.log("  ["+s+"] "+(r.check_id||"unknown"));
console.log("  "+(r.path||"unknown")+":"+((r.start&&r.start.line)||"?")+" → "+(extra.message||"").slice(0,80));
console.log("");});
});' < "$SEMGREP_STDOUT_FILE") || SEMGREP_VERDICT="PARSE=FAIL RESULTS=0 ERRORS=0 BLOCKING=0 WARNINGS=0"

    PARSE_LINE=$(printf '%s\n' "$SEMGREP_VERDICT" | sed -n '1p')
    FINDING_DETAILS=$(printf '%s\n' "$SEMGREP_VERDICT" | sed -n '2,$p')
    V_PARSE=$(printf '%s\n' "$PARSE_LINE" | sed -n 's/^PARSE=\([A-Z]*\) .*/\1/p')
    V_RESULTS=$(printf '%s\n' "$PARSE_LINE" | sed -n 's/.* RESULTS=\([0-9]*\) .*/\1/p')
    V_ERRORS=$(printf '%s\n' "$PARSE_LINE" | sed -n 's/.* ERRORS=\([0-9]*\) .*/\1/p')
    V_BLOCKING=$(printf '%s\n' "$PARSE_LINE" | sed -n 's/.* BLOCKING=\([0-9]*\) .*/\1/p')
    V_WARNINGS=$(printf '%s\n' "$PARSE_LINE" | sed -n 's/.* WARNINGS=\([0-9]*\)$/\1/p')
    # Keep the raw stdout tail for the unparseable branch's diagnostics BEFORE
    # the temp file goes away (#518 R2: stderr alone often says nothing there).
    SEMGREP_STDOUT_TAIL=$(tail -5 "$SEMGREP_STDOUT_FILE" 2>/dev/null)
    rm -f "$SEMGREP_STDOUT_FILE"

    # Fail closed: an unparseable payload OR an OK parse with any missing count
    # field (verdict-line format drift) must SKIP, never silently degrade to
    # PASS (#518).
    if [ "$V_PARSE" != "OK" ] || [ -z "$V_RESULTS" ] || [ -z "$V_ERRORS" ] || [ -z "$V_BLOCKING" ] || [ -z "$V_WARNINGS" ]; then
      # Unparseable output: nothing the exit code claims can be trusted (#518).
      # Fail closed — SKIP with diagnostics, never a PASS.
      echo "     ⚠️  semgrep output unparseable or verdict fields missing (exit code ${SEMGREP_EXIT}) — cannot determine verdict"
      if [ -n "$SEMGREP_OUTPUT" ]; then
        echo "     ── what semgrep reported on stderr ──"
        printf '%s\n' "$SEMGREP_OUTPUT" | tail -10 | sed 's/^/     /'
      fi
      if [ -n "$SEMGREP_STDOUT_TAIL" ]; then
        echo "     ── what semgrep wrote to stdout (tail) ──"
        printf '%s\n' "$SEMGREP_STDOUT_TAIL" | sed 's/^/     /'
      fi
      echo "     ⏭️  SKIPPED - SAST (semgrep output unparseable)"
      GATE_10_STATUS="SKIP"
      GATE_10_REASON="output_unparseable"
    elif [ "$V_RESULTS" -eq 0 ] && { [ "$V_ERRORS" -gt 0 ] || [ "$SEMGREP_EXIT" -ne 0 ]; }; then
      # Nothing was scanned to a verdict: semgrep either failed outright
      # (nonzero exit) or completed but reported scan errors for every input
      # (#518 R2: exit 0 + results:[] + errors:[{...}] used to fall through to
      # PASS). An operational failure must neither block nor claim a pass
      # (#475 kept).
      echo "     ⚠️  semgrep exit=${SEMGREP_EXIT}, scan errors=${V_ERRORS}, findings=${V_RESULTS} — nothing to judge"
      if [ -n "$SEMGREP_OUTPUT" ]; then
        echo "     ── what semgrep reported ──"
        printf '%s\n' "$SEMGREP_OUTPUT" | tail -10 | sed 's/^/     /'
      fi
      echo "     ⏭️  SKIPPED - SAST (semgrep runtime error)"
      GATE_10_STATUS="SKIP"
      GATE_10_REASON="semgrep_runtime_error"
    elif [ "$V_BLOCKING" -gt 0 ]; then
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "   GATE 10: Semgrep Security Gate"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "  CRITICAL/HIGH/ERROR:     ${V_BLOCKING}  ❌ BLOCKED"
      echo "  MEDIUM/LOW/WARNING/INFO: ${V_WARNINGS}  ⚠️  warning"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "  ❌ BLOCKED — blocking-severity vulnerability found"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "$FINDING_DETAILS"
      echo "  Run 'semgrep scan --config=p/security-audit' to review all findings."
      GATE_10_STATUS="FAIL"
      GATE_10_SCANNED_FILES=${#SEMGREP_ARGS[@]}
      exit 1
    else
      GATE_10_SCANNED_FILES=${#SEMGREP_ARGS[@]}
      echo ""
      echo "     ✅ PASSED - No blocking vulnerabilities (files scanned: ${#SEMGREP_ARGS[@]})"
      if [ "$V_WARNINGS" -gt 0 ]; then
        echo "     ⚠️  ${V_WARNINGS} non-blocking findings (warnings only)"
        echo "$FINDING_DETAILS"
      fi
      GATE_10_STATUS="PASS"
    fi

    fi # node available
  fi
fi
record_gate_audit "gate-10" "sast-security" "$GATE_10_STATUS" "0" "$GATE_10_START"
