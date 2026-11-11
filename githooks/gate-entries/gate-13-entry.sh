#!/usr/bin/env bash
# ============================================================================
# gate-13 entry — extracted from pre-commit by scripts/extract-gates.cjs
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
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
generate_quality_report() {
  local HISTORY_FILE=".quality-history.jsonl"
  local COMMIT_HASH
  local TIMESTAMP
  local BRANCH
  local PASSED_COUNT=0
  # #680: the gate list is the single source of truth. TOTAL_GATES, the scoring
  # loop, the console table and the JSON `overall` block all derive from it.
  #
  # Gate 13 was added in v0.35.x with only its execution and JSON write -- these
  # three sites kept saying "12". A machine with no C/C++ compiler therefore saw
  # `10.0/10 effective`, `gatesWarned: 0` and a table that stopped at Gate 12,
  # while the JSON `gates` object held 13 keys. "Compiler strictness was never
  # checked" and "compiler reported zero warnings" rendered identically, which is
  # the same silent-success pattern as #561/#570/#585.
  #
  # Adding a gate now means editing ALL_GATE_NUMBERS + ONE table row. Nothing
  # else carries a count.
  local ALL_GATE_NUMBERS="1 2 3 4 5 6 7 8 9 10 11 12 13"
  local TOTAL_GATES=0
  local _g
  for _g in $ALL_GATE_NUMBERS; do TOTAL_GATES=$((TOTAL_GATES + 1)); done
  local SKIP_COUNT=0
  local WARN_COUNT=0
  local NONPASS_COUNT=0

  # #711: capture the probe output first, then fall back — never `|| echo` a
  # command whose stdout is only shown on success.
  #
  # On a repository with no commits yet, `git rev-parse --abbrev-ref HEAD`
  # PRINTS "HEAD" and then exits non-zero. With `$(cmd || echo unknown)` the
  # captured value becomes "HEAD\nunknown" — two lines — and it is embedded
  # verbatim into the JSON report as `"branch": "HEAD\nunknown"`, which is not
  # valid JSON (a raw newline cannot appear inside a string literal).
  #
  # Gate 12 then reads that report on the NEXT commit and BLOCKS with
  # "YAML/JSON syntax errors" against a file the gate itself wrote. The first
  # commit of every freshly-initialised consumer repo therefore fails once for a
  # reason that has nothing to do with the user's change.
  COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null) || COMMIT_HASH=""
  [ -n "$COMMIT_HASH" ] || COMMIT_HASH="unknown"
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || BRANCH=""
  # A detached HEAD reports the literal word "HEAD"; keep it (it is the truth)
  # but never allow a multi-line value into the report.
  BRANCH=$(printf '%s' "$BRANCH" | tr -d '\r\n')
  [ -n "$BRANCH" ] || BRANCH="unknown"
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Scoring per #507 S3: SKIP removes a gate from the denominator (a missing
  # tool must not drag the score down -- that was the "honest but punishing"
  # old behavior), WARN stays in the denominator but never counts as passed,
  # and FAIL/BLOCK count as non-passing items like before. NONPASS tracks
  # non-passing gates INSIDE the effective denominator only -- a skipped gate
  # is out of scope, not a failure.
  local gate_status gate_default
  # #536: a WARN means the check could not run (typically tool_not_installed)
  # -- degraded coverage, kept in the denominator but flagged separately so a
  # degraded gate is never confused with a real PASS.
  local DEGRADED_COUNT=0
  # The report's gatesDegraded is a superset: DEGRADED plus WARN (#536), because
  # both mean "this gate could not fully verify what it was asked to". Kept
  # separate from the scoring loop's DEGRADED_COUNT above so the two statuses stay
  # distinct where that distinction is load-bearing (#599-10).
  local REPORT_DEGRADED_COUNT=0
  local DEGRADED_JSON=""
  local FAIL_COUNT=0
  local FAILED_JSON=""
  for gate in $ALL_GATE_NUMBERS; do
    local status_var="GATE_${gate}_STATUS"
    # Default mirrors the JSON report rendering below EXACTLY (gates 1-11
    # PASS, gate 12 WARN): a gate that never assigned a status is "not
    # applicable" and must render and score identically. A previous scoring
    # default of FAIL produced self-contradictory reports -- the gate showed
    # PASS in JSON but scored as FAIL (#507 Delphi round-1 A-MAJOR-2).
    # Default direction is "did not run", never "passed": an unassigned status
    # is a gate that never reached a verdict, and scoring it PASS both claims a
    # success that did not happen and hides the gap in the effective rate.
    #
    # Gate 13 defaults to SKIP like the rest: it is only WARN when the toolchain
    # is missing and the gate explicitly says so, and Gate 12 is the one gate
    # whose "no verdict" is still a warning rather than "not applicable".
    if [ "$gate" -eq 12 ]; then gate_default="WARN"; else gate_default="SKIP"; fi
    gate_status="${!status_var:-$gate_default}"
    case "$gate_status" in
      PASS) PASSED_COUNT=$((PASSED_COUNT + 1)) ;;
      SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
      # #536: a WARN gate ran but could not fully do its job, so the REPORT's
      # gatesDegraded must include it -- that field answers "how much of this run
      # could actually verify what it was asked to". The scoring loop's
      # DEGRADED_COUNT deliberately does NOT include it: a plain WARN must stay
      # distinguishable from a gate that reported DEGRADED (#599-10), or the two
      # statuses become one and neither is worth anything.
      WARN) REPORT_DEGRADED_COUNT=$((REPORT_DEGRADED_COUNT + 1)); WARN_COUNT=$((WARN_COUNT + 1)); NONPASS_COUNT=$((NONPASS_COUNT + 1)) ;;
      # #574: DEGRADED is a status a gate really produces -- Gate 5 reports it
      # when coverage could not be measured honestly instead of claiming PASS.
      # It had no arm here, so it fell into the catch-all below and counted as a
      # HARD FAILURE: the gate was punished for telling the truth about itself.
      # It must also feed WARN_COUNT, because the FAIL predicate is
      # (NONPASS_COUNT - WARN_COUNT) > 0; adding only NONPASS_COUNT would turn
      # every honest DEGRADED run into FAIL.
      DEGRADED) DEGRADED_COUNT=$((DEGRADED_COUNT + 1)); REPORT_DEGRADED_COUNT=$((REPORT_DEGRADED_COUNT + 1)); WARN_COUNT=$((WARN_COUNT + 1)); NONPASS_COUNT=$((NONPASS_COUNT + 1)); DEGRADED_JSON="${DEGRADED_JSON:+$DEGRADED_JSON, }\"gate${gate}\"" ;;
      *) FAIL_COUNT=$((FAIL_COUNT + 1)); NONPASS_COUNT=$((NONPASS_COUNT + 1)); FAILED_JSON="${FAILED_JSON:+$FAILED_JSON, }\"gate${gate}\"" ;;
    esac
  done

  local EFFECTIVE_TOTAL=$((TOTAL_GATES - SKIP_COUNT))
  local VERDICT="PASS"
  if [ "$EFFECTIVE_TOTAL" -eq 0 ]; then
    VERDICT="SKIP-ALL"   # every gate skipped: never report a fake 10/10
  elif [ "$NONPASS_COUNT" -gt 0 ]; then
    if [ "$((NONPASS_COUNT - WARN_COUNT))" -gt 0 ]; then
      VERDICT="FAIL"     # at least one FAIL/BLOCK among the effective gates
    else
      VERDICT="WARN"     # all effective gates passed or warned; warns forbid PASS
    fi
  elif [ "$SKIP_COUNT" -gt 0 ]; then
    # #575: PARTIAL. Something passed, but not everything ran, and "PASS" reads
    # as a statement about the commit — not about the fraction of the pipeline
    # that happened to execute. A docs-only commit runs 3 of 12 gates and used
    # to report `verdict: PASS`, which is a claim the run did not support.
    # This is deliberately NOT FAIL: nothing failed. It is also not SKIP-ALL,
    # which means no gate ran at all. Naming the gap is the whole point.
    VERDICT="PARTIAL"
  fi

  local SCORE=0
  if [ "$EFFECTIVE_TOTAL" -eq 0 ]; then
    SCORE="N/A"
  else
    # Single awk path (#507 Delphi round-1 B-MAJOR-2): bc's scale=1 truncates
    # the DIVISION before multiplying (8/9 -> 0.8, *10 -> 8.0) while awk
    # rounds the final result (8.9) -- the same commit scored differently on
    # machines with and without bc. awk(1) is POSIX-guaranteed: one code path,
    # one score.
    SCORE=$(awk "BEGIN {printf \"%.1f\", ($PASSED_COUNT / $EFFECTIVE_TOTAL) * 10}")
  fi
  local EFFECTIVE_PASS_RATE="N/A"
  if [ "$EFFECTIVE_TOTAL" -gt 0 ]; then
    EFFECTIVE_PASS_RATE=$(awk "BEGIN {printf \"%.1f\", ($PASSED_COUNT / $EFFECTIVE_TOTAL) * 100}")
  fi

  # #564: `score` above divides by the EFFECTIVE total, so a SKIPped gate leaves
  # the denominator instead of counting against it. Arithmetic on that formula:
  # 1 passed / 11 skipped is 1/1 -> 10.0, identical to 10 passed / 2 skipped.
  # .quality-history.jsonl shows Gate 3 running in 7% of runs and Gate 4 in 8%,
  # every one of them recording score 10 -- skipping work raised the score.
  #
  # The effective view answers a real question ("of the gates that could run,
  # how many passed?"), so it stays. What was missing is the denominator being
  # visible, and a score that counts skips against the run. `scoreAllGates`
  # divides by TOTAL_GATES, so a skipped gate costs exactly what a failed one
  # costs in that view; `gatesRan` says how much of the suite was exercised.
  # `score` keeps its current value and meaning so dashboard/ and
  # .quality-history.jsonl consumers do not break (#507 already made it
  # number-or-null; this stays within that contract).
  local GATES_RAN=$EFFECTIVE_TOTAL
  local SCORE_ALL="N/A"
  if [ "$TOTAL_GATES" -gt 0 ]; then
    SCORE_ALL=$(awk "BEGIN {printf \"%.1f\", ($PASSED_COUNT / $TOTAL_GATES) * 10}")
  fi
  local SCORE_ALL_JSON="$SCORE_ALL"
  [ "$SCORE_ALL_JSON" = "N/A" ] && SCORE_ALL_JSON="null"
  # JSON bodies need a number or null -- a literal N/A breaks every consumer.
  local SCORE_JSON="$SCORE"
  [ "$SCORE_JSON" = "N/A" ] && SCORE_JSON="null"
  # Same for the pass rate: numeric like `score`, not a quoted string --
  # mixed types in one object broke consumers (#507 Delphi round-1 B-minor-6).
  local EFFECTIVE_PASS_RATE_JSON="$EFFECTIVE_PASS_RATE"
  [ "$EFFECTIVE_PASS_RATE_JSON" = "N/A" ] && EFFECTIVE_PASS_RATE_JSON="null"

  local BS_PASSED=0
  local BS_BLOCKED=0
  if [ -n "$BOY_SCOUT_OUTPUT" ]; then
    BS_PASSED=$(echo "$BOY_SCOUT_OUTPUT" | grep -o '"passedFiles": [0-9]*' | grep -o '[0-9]*' || echo "0")
    BS_BLOCKED=$(echo "$BOY_SCOUT_OUTPUT" | grep -o '"blockedFiles": [0-9]*' | grep -o '[0-9]*' || echo "0")
  fi

  local COV_PCT="${COVERAGE_PERCENT:-N/A}"

  # ── Build failed-tests list from TESTS_OUTPUT (Gate 5) ──────────────────────────────
  local FAILED_TESTS_JSON="[]"
  if [ -n "$TESTS_OUTPUT" ] && echo "$TESTS_OUTPUT" | grep -qi "fail\|error\|FAILED"; then
    # Extract failure lines: "FAIL src/foo.test.ts" or "  ✗ test name"
    local FAIL_LINES
    # errexit/pipefail-safe: grep returns 1 on zero matches (see #489) and this
    # function is also sourced by consumer wrappers that may enable errexit
    FAIL_LINES=$(echo "$TESTS_OUTPUT" | grep -E "^\s*(FAIL|✗|failed|AssertionError)" | sed -n '1,10p' | \
      sed 's/"/\\"/g' | awk '{ printf "%s%s%s", sep, "\"", $0; sep="," }') || true
    if [ -n "$FAIL_LINES" ]; then
      FAILED_TESTS_JSON="[$FAIL_LINES]"
    fi
  fi

  # ── Branch-level quality status file ─────────────────────────────────────────────
  local STATUS_DIR=".xp-gate/quality-status"
  local REPORT_FILE="${STATUS_DIR}/${BRANCH}.json"
  mkdir -p "$(dirname "$REPORT_FILE")"

  # ── #537: per-language coverage matrix ───────────────────────────────────────
  # Answers "was this dimension actually measured for this language?" instead of
  # letting every SKIP read as a pass. Built by whitelist splicing (the same
  # technique as DEGRADED_JSON above) rather than jq, because jq is an OPTIONAL
  # dependency here (see the `command -v jq` guard earlier in this file) and a
  # missing jq must not silently cost us the whole matrix.
  #
  # Safety: every spliced value is one of the five enum literals below — no
  # quotes, backslashes or newlines can reach the JSON. Language names are
  # whitelisted too, and a name that fails the whitelist is reported in
  # coverageWarnings instead of being silently dropped.
  local COVERAGE_MATRIX_JSON=""
  local COVERAGE_WARNINGS_JSON=""
  local _cm_lang _cm_g3 _cm_g4 _cm_g6 _cm_entry
  for _cm_lang in $PROJECT_LANGS; do
    if ! echo "$_cm_lang" | grep -qE '^[a-z][a-z0-9+]*$'; then
      COVERAGE_WARNINGS_JSON="${COVERAGE_WARNINGS_JSON:+$COVERAGE_WARNINGS_JSON, }\"unsupported_language_name\""
      continue
    fi
    _cm_g3=$(classify_coverage_reason "${GATE_3_REASON:-}" "${GATE_3_STATUS:-SKIP}")
    _cm_g4=$(classify_coverage_reason "${GATE_4_REASON:-}" "${GATE_4_STATUS:-SKIP}")
    # Gate 6 reason for this language — extracted so the rule is testable
    # rather than inlined (see coverage_g6_reason_for below).
    _cm_g6_reason=$(coverage_g6_reason_for "$_cm_lang")
    _cm_g6=$(classify_coverage_reason "$_cm_g6_reason" "${GATE_6_STATUS:-SKIP}")
    _cm_entry="\"${_cm_lang}\": {\"gate3_complexity\": \"${_cm_g3}\", \"gate4_principles\": \"${_cm_g4}\", \"gate6_architecture\": \"${_cm_g6}\"}"
    COVERAGE_MATRIX_JSON="${COVERAGE_MATRIX_JSON:+$COVERAGE_MATRIX_JSON, }${_cm_entry}"
  done
  local LANGUAGES_SOURCE
  LANGUAGES_SOURCE=$(resolve_languages_source "${_RESOLVED_LANG_OVERRIDE:-}" "${_CONFIG_LANGS:-}" "${PROJECT_LANGS:-}")

  # #798 step 1: per-gate durations, emitted from the single table that
  # record_gate_audit fills. See gate_timings_json for why an unmeasured gate is
  # absent rather than 0.
  local GATE_TIMINGS_JSON
  GATE_TIMINGS_JSON=$(gate_timings_json)

  cat > "$REPORT_FILE" << ENDJSON
{
  "reportVersion": "2.0",
  "generatedAt": "$TIMESTAMP",
  "branch": "$BRANCH",
  "commit": "$COMMIT_HASH",
  "language": "${PROJECT_LANGS:-${PROJECT_LANG:-unknown}}",
  "overall": {
    "gatesPassed": $PASSED_COUNT,
    "gatesTotal": $TOTAL_GATES,
    "gatesSkipped": $SKIP_COUNT,
    "gatesWarned": $WARN_COUNT,
    "gatesFailed": $FAIL_COUNT,
    "failedGates": [$FAILED_JSON],
    "gatesDegraded": $REPORT_DEGRADED_COUNT,
    "degradedGates": [$DEGRADED_JSON],
    "gatesEffective": $EFFECTIVE_TOTAL,
    "effectivePassRate": $EFFECTIVE_PASS_RATE_JSON,
    "gatesRan": $GATES_RAN,
    "scoreAllGates": $SCORE_ALL_JSON,
    "score": $SCORE_JSON,
    "verdict": "$VERDICT"
  },
  "languagesSource": "${LANGUAGES_SOURCE}",
  "gateTimings": {${GATE_TIMINGS_JSON}},
  "coverageMatrix": {${COVERAGE_MATRIX_JSON}},
  "coverageWarnings": [${COVERAGE_WARNINGS_JSON}],
  "gates": {
    "gate1_static_analysis": {
      "name": "Code Quality (Static + Lint + Shell)",
      "status": "${GATE_1_STATUS:-SKIP}",
      "tool": "${GATE_1_TOOL:-auto}"
    },
    "gate2_dup_code": {
      "name": "Duplicate Code",
      "status": "${GATE_2_STATUS:-SKIP}",
      "metric": "similarity <= 5%"
    },
    "gate3_complexity": {
      "name": "Cyclomatic Complexity",
      "status": "${GATE_3_STATUS:-SKIP}",
      "reason": "${GATE_3_REASON:-}",
      "threshold": "${CCN_THRESHOLD:-5}",
      "blockThreshold": "${CCN_THRESHOLD:-5}",
      "warnings": ${CC_WARNINGS:-0}
    },
    "gate4_principles": {
      "name": "Clean Code + SOLID",
      "status": "${GATE_4_STATUS:-SKIP}",
      "reason": "${GATE_4_REASON:-}",
      "warnings": ${WARNING_COUNT:-0}
    },
    "gate5_tests": {
      "name": "Tests + Coverage",
      "status": "${GATE_5_STATUS:-SKIP}",
      "reason": "${GATE_5_DETAIL:-}",
      "thresholds": { "lines": ${COVERAGE_THRESHOLD}, "functions": null, "branches": null, "statements": null },
      "threshold_source": "${COVERAGE_THRESHOLD_SOURCE}",
      "actual": { "coverage": "${COV_PCT}", "applies_to": "${GATE_5_COVERAGE_APPLIES_TO:-project}" },
      "failedTests": $FAILED_TESTS_JSON
    },
    "gate6_arch_boyscout": {
      "name": "Architecture + Boy Scout Rule",
      "status": "${GATE_6_STATUS:-SKIP}",
      "reason": "${GATE_6_REASON:-}",
      "boyScoutPassed": $BS_PASSED,
      "boyScoutBlocked": $BS_BLOCKED
    },
    "gate7_iac_security": {
      "name": "IaC Security Scanning",
      "status": "${GATE_7_STATUS:-SKIP}",
      "scanned_files": ${GATE_7_SCANNED_FILES:-0},
      "tools": "checkov, hadolint, kube-score, tflint"
    },
    "gate8_secret_scanning": {
      "name": "Secret Scanning",
      "status": "${GATE_8_STATUS:-SKIP}",
      "tool": "gitleaks"
    },
    "gate9_build_integrity": {
      "name": "Build Integrity",
      "status": "${GATE_9_STATUS:-SKIP}",
      "tool": "tsc + npm pack + import check"
    },
    "gate10_sast": {
      "name": "SAST Security Scan",
      "status": "${GATE_10_STATUS:-SKIP}",
      "reason": "${GATE_10_REASON:-}",
      "scanned_files": ${GATE_10_SCANNED_FILES:-0},
      "path": "${GATE_10_SEMGREP_PATH:-direct}",
      "degraded": ${GATE_10_SASTD_DEGRADED:-0},
      "tool": "semgrep"
    },
    "gate11_sprint_flow": {
      "name": "Sprint Flow Enforcement",
      "status": "${GATE_11_STATUS:-SKIP}",
      "tool": "sprint-gate.sh"
    },
    "gate12_file_hygiene": {
      "name": "File Hygiene Check",
      "status": "${GATE_12_STATUS:-WARN}",
      "tool": "gate-12-file-hygiene.sh"
    }
  }
}
ENDJSON

  # ── Gate 13 injection (tail append; no existing line above is modified) ────
  # The heredoc is closed deliberately before Gate 13 so this sprint ADDS lines
  # instead of editing gates 0-12's report block, keeping the two branches'
  # hunks disjoint. Scores are recomputed over 13 gates afterwards.
  if [ -n "${GATE_13_STATUS:-}" ] && [ -f "$REPORT_FILE" ]; then
    _XP_G13="$REPORT_FILE" _XP_G13S="$GATE_13_STATUS" node -e "
      const fs=require('fs'),p=process.env._XP_G13;
      try{
        const j=JSON.parse(fs.readFileSync(p,'utf8'));
        j.gates=j.gates||{};
        j.gates.gate13_compiler_strictness={name:'Compiler Strictness',status:process.env._XP_G13S,tool:'gate-13-compiler-strictness.sh'};
        fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');
      }catch(e){}
    " 2>/dev/null || true
  fi

  # ── Persistent per-run report (Issue #101) ────────────────────────────────────────
  local REPORTS_DIR=".xp-gate/reports/pre-commit"
  local REPORT_TS
  REPORT_TS=$(date -u +"%Y-%m-%d-%H%M%S")
  local PERSISTED_REPORT_FILE="${REPORTS_DIR}/${REPORT_TS}.json"
  mkdir -p "$REPORTS_DIR"
  # #640 / #798: `duration_ms` is wall-clock time from hook entry to report write.
  # Emitted only when measurable -- an absent field is honest, a 0 is not.
  #
  # #798 replaced the /proc/uptime fraction parser that produced this field: it
  # truncated the fractional seconds (`331154.04` -> `33115404`, i.e. 10x small)
  # and reported 21,754 ms for a run that measured 199,000 ms. Both ends now come
  # from now_ms, the same clock, and the subtraction stays in BASH because the
  # value is a bash-side timestamp.
  #
  # LOWER-BOUND CHECK (#798): a hook cannot have run for less time than the gates
  # inside it already consumed. When the computed duration is smaller than the
  # largest per-gate duration, the arithmetic is wrong somewhere -- publish null
  # rather than a number that would send every optimisation decision the wrong
  # way. "宁可没有数，也不要有一个会让所有优化决策跑偏的数."
  local _XP_DURATION_MS=""
  local _XP_NOW_MS=""
  _XP_NOW_MS=$(now_ms)
  case "$_XP_NOW_MS" in
    ''|*[!0-9]*) _XP_NOW_MS="" ;;
  esac
  case "$_XP_HOOK_START_MS" in
    ''|*[!0-9]*) _XP_HOOK_START_MS="" ;;
  esac
  if [ -n "$_XP_NOW_MS" ] && [ -n "$_XP_HOOK_START_MS" ] && [ "$_XP_NOW_MS" -gt "$_XP_HOOK_START_MS" ]; then
    _XP_DURATION_MS=$(( _XP_NOW_MS - _XP_HOOK_START_MS ))
  fi
  # LOWER-BOUND CHECK (#798): the hook cannot have run for less than its own
  # longest gate. This catches a clock that changed units or a poisoned start
  # before the number reaches .quality-history.jsonl, where it becomes the basis
  # for "are the gates getting slower?". Rejecting to null is deliberate: a
  # wrong number is worse than no number, because it is acted upon.
  local _XP_DURATION_FLOOR=""
  local _xp_floor_n
  for _xp_floor_n in \
    "${GATE_1_ELAPSED:-}" "${GATE_2_ELAPSED:-}" "${GATE_3_ELAPSED:-}" \
    "${GATE_4_ELAPSED:-}" "${GATE_5_ELAPSED:-}" "${GATE_6_ELAPSED:-}" \
    "${GATE_7_ELAPSED:-}" "${GATE_8_ELAPSED:-}" "${GATE_9_ELAPSED:-}" \
    "${GATE_10_ELAPSED:-}" "${GATE_11_ELAPSED:-}" "${GATE_12_ELAPSED:-}" \
    "${GATE_13_ELAPSED:-}"; do
    case "$_xp_floor_n" in
      ''|*[!0-9]*) continue ;;
    esac
    if [ "$_xp_floor_n" -gt "${_XP_DURATION_FLOOR:-0}" ]; then
      _XP_DURATION_FLOOR="$_xp_floor_n"
    fi
  done
  unset _xp_floor_n
  case "$_XP_DURATION_FLOOR" in
    ''|*[!0-9]*) _XP_DURATION_FLOOR="" ;;
  esac
  if [ -n "$_XP_DURATION_MS" ] && [ -n "$_XP_DURATION_FLOOR" ] \
     && [ "$_XP_DURATION_MS" -lt "$_XP_DURATION_FLOOR" ]; then
    # Contradiction: the whole is smaller than one of its parts. Report nothing.
    echo "   ⚠️  duration_ms rejected: measured ${_XP_DURATION_MS}ms is below the longest gate (${_XP_DURATION_FLOOR}ms) — recording null." >&2
    _XP_DURATION_MS=""
  fi
  _XP_RF="$REPORT_FILE" _XP_PRF="$PERSISTED_REPORT_FILE" _XP_TS="$TIMESTAMP" _XP_BR="$BRANCH" _XP_CH="$COMMIT_HASH" _XP_CF="${CHANGED_FILES:-}" _XP_DUR="$_XP_DURATION_MS" node -e "const fs=require('fs');const e=process.env;const br=JSON.parse(fs.readFileSync(e._XP_RF,'utf8'));const cf=(e._XP_CF||'').split('\n').filter(f=>f);const r={timestamp:e._XP_TS,trigger:'pre-commit',branch:e._XP_BR,commit:e._XP_CH,changed_files:cf,overall:br.overall||{},gates:br.gates||{},warnings:[],errors:[]};const d=Number(e._XP_DUR);if(Number.isFinite(d)&&d>0){r.duration_ms=d;}fs.writeFileSync(e._XP_PRF,JSON.stringify(r,null,2)+'\n');" 2>/dev/null || cp "$REPORT_FILE" "$PERSISTED_REPORT_FILE"

  # ── History append (unchanged — append-only for trend) ────────────────────────────
  local GATES_JSON="{"
  GATES_JSON="${GATES_JSON}\"gate1\":{\"status\":\"${GATE_1_STATUS:-SKIP}\",\"name\":\"Code Quality\"},"
  GATES_JSON="${GATES_JSON}\"gate2\":{\"status\":\"${GATE_2_STATUS:-SKIP}\",\"name\":\"Duplicate Code\"},"
  GATES_JSON="${GATES_JSON}\"gate3\":{\"status\":\"${GATE_3_STATUS:-SKIP}\",\"name\":\"Complexity\",\"warnings\":${CC_WARNINGS:-0}},"
  GATES_JSON="${GATES_JSON}\"gate4\":{\"status\":\"${GATE_4_STATUS:-SKIP}\",\"name\":\"Principles\",\"warnings\":${WARNING_COUNT:-0}},"
  GATES_JSON="${GATES_JSON}\"gate5\":{\"status\":\"${GATE_5_STATUS:-SKIP}\",\"name\":\"Tests+Coverage\",\"coverage\":\"${COV_PCT}\"},"
  GATES_JSON="${GATES_JSON}\"gate6\":{\"status\":\"${GATE_6_STATUS:-SKIP}\",\"name\":\"Architecture+BoyScout\",\"bsBlocked\":${BS_BLOCKED}},"
  GATES_JSON="${GATES_JSON}\"gate7\":{\"status\":\"${GATE_7_STATUS:-SKIP}\",\"name\":\"IaC Security\"},"
  GATES_JSON="${GATES_JSON}\"gate8\":{\"status\":\"${GATE_8_STATUS:-SKIP}\",\"name\":\"Secret Scanning\"},"
  GATES_JSON="${GATES_JSON}\"gate9\":{\"status\":\"${GATE_9_STATUS:-SKIP}\",\"name\":\"Build Integrity\"},"
  GATES_JSON="${GATES_JSON}\"gate10\":{\"status\":\"${GATE_10_STATUS:-SKIP}\",\"name\":\"SAST Security\"},"
  GATES_JSON="${GATES_JSON}\"gate11\":{\"status\":\"${GATE_11_STATUS:-SKIP}\",\"name\":\"Sprint Flow\"},"
  GATES_JSON="${GATES_JSON}\"gate12\":{\"status\":\"${GATE_12_STATUS:-WARN}\",\"name\":\"File Hygiene\"}}"

  echo "{\"timestamp\":\"$TIMESTAMP\",\"commit\":\"$COMMIT_HASH\",\"branch\":\"$BRANCH\",\"score\":$SCORE_JSON,\"passed\":$PASSED_COUNT,\"total\":$TOTAL_GATES,\"effectiveTotal\":$EFFECTIVE_TOTAL,\"effectivePassRate\":$EFFECTIVE_PASS_RATE_JSON,\"skipCount\":$SKIP_COUNT,\"verdict\":\"$VERDICT\",\"gates\":$GATES_JSON,\"coverage\":\"$COV_PCT\",\"complexityWarnings\":${CC_WARNINGS:-0},\"principleWarnings\":${WARNING_COUNT:-0},\"boyScoutBlocked\":${BS_BLOCKED}}" >> "$HISTORY_FILE"

  # ── Console output ────────────────────────────────────────────────────────
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  📊 Quality Report — $TIMESTAMP"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  printf "  %-45s %s\n" "Gate 1: Code Quality" "${GATE_1_STATUS:-SKIP}"
  printf "  %-45s %s\n" "Gate 2: Duplicate Code" "${GATE_2_STATUS:-SKIP}"
  printf "  %-45s %s (warnings: ${CC_WARNINGS:-0})\n" "Gate 3: Complexity" "${GATE_3_STATUS:-SKIP}"
  printf "  %-45s %s (warnings: ${WARNING_COUNT:-0})\n" "Gate 4: Principles" "${GATE_4_STATUS:-SKIP}"
  # #665: a subset run's percentage describes a SUBSET, not the project, and the
  # global floor was not applied. Printing the bare number next to a PASS reads as
  # "29% passed an 82% floor". Say which population the number came from.
  if [ "${GATE_5_COVERAGE_APPLIES_TO:-project}" = "subset" ]; then
    printf "  %-45s %s (coverage: ${COV_PCT}%%, subset run -- global floor not checked)\n" "Gate 5: Tests + Coverage" "${GATE_5_STATUS:-SKIP}"
  else
    printf "  %-45s %s (coverage: ${COV_PCT}%%)\n" "Gate 5: Tests + Coverage" "${GATE_5_STATUS:-SKIP}"
  fi
  printf "  %-45s %s\n" "Gate 6: Architecture + Boy Scout" "${GATE_6_STATUS:-SKIP}"
  printf "  %-45s %s\n" "Gate 7: IaC Security" "${GATE_7_STATUS:-SKIP}"
  printf "  %-45s %s\n" "Gate 8: Secret Scanning" "${GATE_8_STATUS:-SKIP}"
  printf "  %-45s %s\n" "Gate 9: Build Integrity" "${GATE_9_STATUS:-SKIP}"
  printf "  %-45s %s\n" "Gate 10: SAST Security" "${GATE_10_STATUS:-SKIP}"
  printf "  %-45s %s\n" "Gate 11: Sprint Flow" "${GATE_11_STATUS:-SKIP}"
  printf "  %-45s %s\n" "Gate 12: File Hygiene" "${GATE_12_STATUS:-WARN}"
  # #680: Gate 13 ran and could block, but had no row here -- the table is what a
  # human reads, so a gate missing from it reads as a gate that does not exist.
  printf "  %-45s %s\n" "Gate 13: Compiler Strictness" "${GATE_13_STATUS:-SKIP}"
  echo ""
  # #564: both views in one line. The effective score answers "of the gates that
  # could run, how many passed"; the all-gates score counts a skip against the
  # run. Printing only the first let a 1-of-12 run read as 10.0/10.
  echo "  Overall Score: $SCORE/10 effective | $SCORE_ALL/10 of all gates ($GATES_RAN/$TOTAL_GATES ran, $SKIP_COUNT skipped, verdict: $VERDICT)"
  echo "  Branch status: $REPORT_FILE"
  echo "  Run report: $PERSISTED_REPORT_FILE"
  echo "  History saved: $HISTORY_FILE"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  # AI-friendly common footer: tells LLM agents how to fix issues instead of bypassing
  echo "  ── AI AGENT DIRECTIVE ──"
  echo "  If any gate FAILED above:"
  echo "    - Each error includes a file path and rule identifier"
  echo "    - Fix each issue, then re-run: git commit"
  echo "    - Do NOT use --no-verify — bypassed commits block sprint progression"
  echo "  ─────────────────────────"
  echo ""
}

gate_13_run() {
GATE_13_STATUS="SKIP"
if [ "${XP_GATE_DISABLE_13:-}" = "1" ]; then
  echo "⏭️  SKIPPED - Gate 13: Compiler Strictness (XP_GATE_DISABLE_13=1)"
  GATE_13_STATUS="SKIP"
elif [ -f "$GATE_DIR/gate-13-compiler-strictness.sh" ] || [ -f "$(git rev-parse --show-toplevel 2>/dev/null)/githooks/gate-13-compiler-strictness.sh" ]; then
  echo "⚙️  Gate 13: Compiler Strictness Check..."
  GATE13_START=$(gate_start_ms)
  (
    # Each stage runs inside the subshell so its shell state cannot leak back
    # into pre-commit. Verdicts are reduced to the WORST code seen:
    # FAIL/BLOCK (1/2) always win; WARN (3) only beats PASS (0).
    _g13_script="$GATE_DIR/gate-13-compiler-strictness.sh"
    [ -f "$_g13_script" ] || _g13_script="$(git rev-parse --show-toplevel)/githooks/gate-13-compiler-strictness.sh"
    # shellcheck source=/dev/null
    . "$_g13_script"

    _g13_worst=0
    _g13_rc=0
    _g13_note() {
      case "$1" in
        1|2) _g13_worst=$1 ;;
        3) [ "$_g13_worst" -eq 0 ] && _g13_worst=3 ;;
      esac
      return 0
    }

    gate13_run_cpp_analysis;   _g13_rc=$?; _g13_note "$_g13_rc"
    gate13_run_java_analysis;  _g13_rc=$?; _g13_note "$_g13_rc"
    # #717: C# joins the same reduce-the-worst loop. Without this call the
    # function would exist but never execute -- the "silently skipped" shape
    # #717 is about, one level up.
    gate13_run_csharp_analysis; _g13_rc=$?; _g13_note "$_g13_rc"
    gate13_run_analyzer;       _g13_rc=$?; _g13_note "$_g13_rc"

    exit "$_g13_worst"
  )
  GATE_13_RC=$?
  GATE13_END=$(now_ms)
  GATE_13_DURATION=$(( (GATE13_END - GATE13_START) / 1000 ))
  case "$GATE_13_RC" in
    0) GATE_13_STATUS="PASS" ;;
    1) GATE_13_STATUS="FAIL" ;;
    2) GATE_13_STATUS="BLOCK" ;;
    *) GATE_13_STATUS="WARN" ;;
  esac
  echo "   Gate 13 ($GATE_13_STATUS) completed in ${GATE_13_DURATION}s"
  record_gate_audit "gate-13" "compiler-strictness" "$GATE_13_STATUS" "0" "$GATE13_START"
  # Every other gate blocks by exiting immediately (e.g. Gate 1's
  # "❌ BLOCKED ... exit 1"); there is no aggregate-then-exit shared with
  # gates 0-12, so Gate 13 must do the same or its FAIL would only be cosmetic
  # in the report while the commit sails through.
  if [ "$GATE_13_STATUS" = "FAIL" ] || [ "$GATE_13_STATUS" = "BLOCK" ]; then
    echo ""
    echo "❌ BLOCKED - Gate 13: Compiler Strictness (${GATE_13_STATUS})"
    echo "   Fix the compiler findings above. To record pre-existing warnings:"
    echo "     xp-gate compiler-baseline create"
    echo "   To relax strictness: XP_GATE_COMPILER_STRICTNESS=warn-only"
    echo "   Emergency only:      XP_GATE_DISABLE_13=1"
    return 1
  fi
else
  echo "⏭️  SKIPPED - Gate 13: Compiler Strictness (gate-13-compiler-strictness.sh not found)"
  GATE_13_STATUS="SKIP"
fi
echo ""
# ============================================================================

  return 0
}


# Called by pre-commit's ordered driver.

