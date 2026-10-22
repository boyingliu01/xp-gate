#!/usr/bin/env bats
# @test REQ-537
# @intent A PowerShell-only repo saw Gate 3/4 as bare SKIP/PASS with tool
#         "typescript": the score implied full coverage while the project's
#         MAIN language was never measured by any dimension. Every non-run of
#         a gate must carry an explicit reason (no files / tool missing /
#         language unsupported) in the quality report, so SKIP is explainable.
# @covers AC-537-01, AC-537-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
  TEST_DIR="$(mktemp -d)"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

@test "#537 gate-3 and gate-4 record a reason on every SKIP path" {
  for f in githooks/gate-3.sh githooks/gate-4.sh; do
    # Count status assignments to SKIP vs reason assignments: each SKIP site
    # must be paired with a GATE_N_REASON assignment within the same branch.
    skips=$(grep -cE '^\s*GATE_[34]_STATUS="SKIP"' "$REPO_ROOT/$f")
    reasons=$(grep -cE '^\s*GATE_[34]_REASON=' "$REPO_ROOT/$f")
    [ "$reasons" -ge "$skips" ] || { echo "$f: $skips SKIP sites but only $reasons reason assignments"; return 1; }
  done
}

@test "#537 quality report surfaces per-gate skip reasons" {
  mkdir -p "$TEST_DIR/repo"
  cd "$TEST_DIR/repo" || return 1
  git init -q
  git config user.email test@test.com
  git config user.name Test
  git config core.hooksPath .git/hooks
  echo seed > README.md
  git add README.md
  git commit --no-verify -q -m seed
  # The report function depends on a CHAIN of helpers defined earlier in the hook
  # (classify_coverage_reason, coverage_g6_reason_for, resolve_languages_source,
  # plus the COVERAGE_THRESHOLD derived at line 93). Hand-picking individual
  # ranges kept surfacing the next missing symbol, so take every top-level
  # function definition from the hook plus the coverage-threshold derivation —
  # and nothing else. The hook's gate body is NOT included, so no gate runs.
  {
    # Helper functions defined ABOVE the report (classify_coverage_reason,
    # coverage_g6_reason_for, resolve_languages_source, ...) plus the
    # load-time constants they read.
    #
    # generate_quality_report itself is NOT taken by this awk pass: it emits a
    # here-doc whose body contains a lone `}`, so brace-anchored extraction
    # closes the function early and the file no longer parses
    #     syntax error: unexpected end of file from `{' command
    # It gets its own range extraction below, terminated by its ENDJSON marker.
    awk '
      /^generate_quality_report\(\) *\{/ { skip = 1 }
      skip && /^ENDJSON$/ { skip = 0; next }
      !skip && /^[a-zA-Z_][a-zA-Z0-9_]*\(\) *\{/ { in_fn = 1 }
      !skip && in_fn { print }
      !skip && in_fn && /^\}$/ { in_fn = 0 }
    ' "$PRE_COMMIT"
    sed -n '/^COVERAGE_THRESHOLD=/p' "$PRE_COMMIT"
    # The function under test, terminated by its own here-doc marker.
    sed -n '/^generate_quality_report()/,/^ENDJSON$/p' "$PRE_COMMIT"
    printf '}\n'
  } > "$TEST_DIR/report-fn.sh"

  # The extraction must actually contain the function under test.
  if ! grep -q '^generate_quality_report()' "$TEST_DIR/report-fn.sh"; then
    echo "extraction failed: generate_quality_report not found in report-fn.sh"
    return 1
  fi
  # `PROJECT_LANGS` (space-separated language set, #537's own follow-up) and
  # `COVERAGE_THRESHOLD_SOURCE` (where the threshold came from, set at load time by
  # _resolve_coverage_threshold) are both read by the report function. Without
  # defaults the fixture dies before any assertion runs:
  #     report-fn.sh: line N: PROJECT_LANGS: unbound variable
  GATE_3_STATUS=SKIP GATE_3_REASON=no_powershell_tool \
  bash -c 'set -u; : "${BOY_SCOUT_OUTPUT:=}" "${CC_WARNINGS:=0}" "${WARNING_COUNT:=0}" "${COVERAGE_PERCENT:=}" "${CHANGED_FILES:=}" "${PROJECT_LANG:=powershell}" "${PROJECT_LANGS:=powershell}" "${LANGUAGE_SOURCE:=detected}" "${COVERAGE_THRESHOLD_SOURCE:=default}" "${TESTS_OUTPUT:=}" "${BS_BLOCKED:=0}" "${GATE_1_TOOL:=pwsh}"; source "'"$TEST_DIR"'/report-fn.sh"; generate_quality_report' >/dev/null
  REPORT=".xp-gate/quality-status/$(git rev-parse --abbrev-ref HEAD).json"
  [ -f "$REPORT" ]
  node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
if (r.gates.gate3_complexity.reason !== "no_powershell_tool") { console.error("gate3 reason not surfaced"); process.exit(1); }
' "$REPORT"
}
