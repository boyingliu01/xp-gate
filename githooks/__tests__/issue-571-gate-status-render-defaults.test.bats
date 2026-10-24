#!/usr/bin/env bats
# @test REQ-599
# @intent Every gate's status is rendered through a `${GATE_N_STATUS:-DEFAULT}`
#         expansion, so the DEFAULT silently decides what an unassigned gate looks
#         like in the report. Nine of those defaults were `PASS`: any code path
#         that reaches the report without assigning a gate rendered that gate as
#         "passed" — indistinguishable from a gate that actually looked and found
#         nothing. Measured: with GATE_5_STATUS unset the report still printed
#         `Gate 5: Tests + Coverage  PASS`.
#
#         "No verdict" and "verdict: pass" are different facts and must not share
#         one spelling in the report (#571). These cases pin that the rendering
#         default for a boolean gate is SKIP, and that a genuinely assigned status
#         is still rendered verbatim (so the change does not paint over real
#         verdicts).
#
#         The two behavioural cases drive the REAL generate_quality_report() and
#         read the JSON it writes, rather than re-implementing the expansion in
#         the test: a test that spells out `${VAR:-SKIP}` itself proves nothing
#         about the hook.
# @covers AC-599-03
bats_require_minimum_version 1.5.0

setup() {
  PRE_COMMIT="$BATS_TEST_DIRNAME/../pre-commit"
  TEST_DIR="$BATS_TEST_TMPDIR/work"
  mkdir -p "$TEST_DIR"
  cd "$TEST_DIR" || return 1
  git init -q .
  git config user.email test@example.com
  git config user.name Test
  git config core.hooksPath .git/hooks
  echo seed > README.md
  git add README.md
  git commit --no-verify -q -m seed
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# The gate-status rendering lines of generate_quality_report().
#
# Extracted by MATCHING THE LINES rather than by slicing a function body: that
# function's here-doc bodies contain a lone `}`, so an awk range anchored on `^}`
# would cut the block at the wrong place and quietly test a fragment.
report_lines() {
  grep -nE 'GATE_[0-9]+_STATUS:-' "$PRE_COMMIT"
}

# A runnable copy of generate_quality_report() plus the helpers it calls.
#
# generate_quality_report() reads a CHAIN of helpers defined earlier in the hook
# (classify_coverage_reason, coverage_g6_reason_for, resolve_languages_source, plus
# the COVERAGE_THRESHOLD derived at load time). Hand-picking ranges kept surfacing
# the next missing symbol, so take every top-level function from the hook — and
# nothing else, so no gate body runs.
build_report_fn() {
  {
    # Every helper ABOVE the report. generate_quality_report is skipped here
    # because its here-doc body contains a lone `}` that closes a brace-anchored
    # function early; it gets the dedicated range extraction below.
    awk '
      /^generate_quality_report\(\) *\{/ { skip = 1 }
      skip && /^ENDJSON$/ { skip = 0; next }
      !skip && /^[a-zA-Z_][a-zA-Z0-9_]*\(\) *\{/ { in_fn = 1 }
      !skip && in_fn { print }
      !skip && in_fn && /^\}$/ { in_fn = 0 }
    ' "$PRE_COMMIT"
    sed -n '/^COVERAGE_THRESHOLD=/p' "$PRE_COMMIT"
    sed -n '/^generate_quality_report()/,/^ENDJSON$/p' "$PRE_COMMIT"
    printf '}\n'
  } > "$TEST_DIR/report-fn.sh"

  grep -q '^generate_quality_report()' "$TEST_DIR/report-fn.sh" || {
    echo "extraction failed: generate_quality_report not in report-fn.sh"
    return 1
  }
  bash -n "$TEST_DIR/report-fn.sh" || {
    echo "extracted report function does not parse"
    return 1
  }
}

# Drive the real report with an explicit environment.
#   $@  NAME=VALUE assignments applied before the call (e.g. GATE_5_STATUS=PASS)
run_report() {
  bash -c '
    set -u
    REPORT_FN="$1"; shift
    : "${BOY_SCOUT_OUTPUT:=}" "${CC_WARNINGS:=0}" "${WARNING_COUNT:=0}"
    : "${COVERAGE_PERCENT:=}" "${CHANGED_FILES:=}" "${PROJECT_LANG:=typescript}"
    : "${PROJECT_LANGS:=typescript}" "${LANGUAGE_SOURCE:=detected}"
    : "${COVERAGE_THRESHOLD_SOURCE:=default}" "${TESTS_OUTPUT:=}" "${BS_BLOCKED:=0}"
    : "${GATE_1_TOOL:=eslint}" "${COV_PCT:=87}"
    for a in "$@"; do export "$a"; done
    source "$REPORT_FN"
    generate_quality_report
  ' _ "$TEST_DIR/report-fn.sh" "$@" >/dev/null 2>"$TEST_DIR/err.txt"
}

@test "AC-599-03: the renderer lines exist and are numerous (anti-vacuity)" {
  lines=$(report_lines)

  [ -n "$lines" ]
  count=$(printf '%s\n' "$lines" | wc -l | tr -d '[:space:]')
  echo "gate-status render sites: $count"
  # Eleven gates are rendered in both the JSON and the human summary, so a
  # non-trivial block is expected. A collapse to a handful means the extraction
  # stopped finding them.
  [ "$count" -ge 20 ]
}

@test "AC-599-03: no gate status renders with a PASS default" {
  run bash -c "grep -nE '\\\$\{GATE_[0-9]+_STATUS:-PASS\}' \"\$1\"" _ "$PRE_COMMIT"

  [ "$status" -ne 0 ] || {
    echo "these renderer lines still default an unassigned gate to PASS:"
    echo "$output"
    return 1
  }
}

@test "AC-599-03: every rendered gate defaults to SKIP or WARN, never PASS" {
  # The enumeration form of the rule: each render site must name a default that
  # does not claim a pass. SKIP is the honest default for a boolean gate; WARN is
  # Gate 12's warning-only default. Anything else — PASS above all — is a claim the
  # renderer cannot support.
  #
  # The pattern requires a NON-EMPTY default (`:-[A-Z]`). `${GATE_6_STATUS:-}` is a
  # different construct — an emptiness test in `[ -n ... ]` that never renders, so
  # hanging a verdict on it would be wrong, not honest.
  #
  # `grep -v` exits 1 when it filters EVERY line away — i.e. exactly when the
  # contract holds. Without `|| true` the pipeline status would invert the meaning
  # of this case.
  bad=$( { grep -E '\$\{GATE_[0-9]+_STATUS:-[A-Z]' "$PRE_COMMIT" || true; } \
        | { grep -vE '\$\{GATE_[0-9]+_STATUS:-(SKIP|WARN)\}' || true; } )

  [ -z "$bad" ] || {
    echo "these render sites use a default other than SKIP/WARN:"
    echo "$bad"
    return 1
  }
}

@test "AC-599-03: the real report renders an EXPLICITLY assigned PASS as PASS" {
  # The counterpart of the case below: honest defaults must not swallow real
  # verdicts. A green gate that got assigned PASS must still say PASS in the
  # report, otherwise this "fix" would trade one lie for another.
  build_report_fn

  run_report GATE_5_STATUS=PASS

  report=".xp-gate/quality-status/$(git rev-parse --abbrev-ref HEAD).json"
  [ -f "$report" ] || { echo "no report written; stderr:"; cat "$TEST_DIR/err.txt"; return 1; }
  run node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const g = r.gates.gate5_tests;
    // The key name is asserted, not assumed: a wrong key would make every
    // status assertion below compare against `undefined` and pass vacuously.
    if (!g) { console.error("no gates.gate5_tests in report; gates = " + Object.keys(r.gates || {}).join(", ")); process.exit(1); }
    console.log(g.status);
  ' "$report"
  [ "$status" -eq 0 ]
  [ "$output" = "PASS" ]
}

@test "AC-599-03: the real report renders an UNASSIGNED gate as SKIP, not PASS" {
  # The defect in one assertion: leave GATE_5_STATUS unset and ask the report what
  # Gate 5 did. Before the fix it answered "PASS" — a verdict nobody reached.
  build_report_fn

  run_report

  report=".xp-gate/quality-status/$(git rev-parse --abbrev-ref HEAD).json"
  [ -f "$report" ] || { echo "no report written; stderr:"; cat "$TEST_DIR/err.txt"; return 1; }
  run node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const g = r.gates.gate5_tests;
    if (!g) { console.error("no gates.gate5_tests in report; gates = " + Object.keys(r.gates || {}).join(", ")); process.exit(1); }
    if (g.status === "PASS") {
      console.error("Gate 5 was never assigned but the report says PASS: " + JSON.stringify(g));
      process.exit(1);
    }
    console.log(g.status);
  ' "$report"
  [ "$status" -eq 0 ]
  [ "$output" = "SKIP" ]
}
