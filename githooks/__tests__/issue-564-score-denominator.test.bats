#!/usr/bin/env bats
# @test REQ-564
# @intent `score` divides by `EFFECTIVE_TOTAL = TOTAL_GATES - SKIP_COUNT`, so a
#         SKIPped gate leaves the denominator instead of counting against it.
#         Arithmetic on the shipped formula:
#
#             1 passed / 11 skipped -> effective  1 -> score 10.0
#             3 passed /  9 skipped -> effective  3 -> score 10.0
#            10 passed /  2 skipped -> effective 10 -> score 10.0
#
#         A tree running one gate out of twelve reported the same 10.0/10 as one
#         running ten. .quality-history.jsonl shows Gate 3 running in 7% of the
#         last 100 commits and Gate 4 in 8%, all of them recording score 10 —
#         skipping work raised the score.
#
#         The effective view answers a real question and stays. What this suite
#         pins is that a second, skip-counting view exists and is reported, so a
#         mostly-skipped run cannot present itself as an unqualified 10/10.
#
#         These are BEHAVIOUR assertions against the real generate_quality_report(),
#         extracted verbatim and fed gate statuses — not source-text greps, which
#         would pass on a comment.
# @covers AC-564-01, AC-564-02, AC-564-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
  TEST_DIR="$(mktemp -d)"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Extract generate_quality_report() verbatim, stopping at the ENDJSON
# terminator (the heredoc body contains a column-0 '}' that would truncate a
# naive extraction).
extract_report_fn() {
  sed -n '/^generate_quality_report()/,/^ENDJSON$/p' "$PRE_COMMIT" > "$TEST_DIR/report-fn.sh"
  printf '}\n' >> "$TEST_DIR/report-fn.sh"
  cat > "$TEST_DIR/run-report.sh" << 'RUNNER'
set -u
# The function runs inside the full hook where these are always assigned;
# supply the same defaults for the isolated harness. PROJECT_LANGS is read via
# `${PROJECT_LANGS:-...}` — set -u still rejects an UNSET variable there.
: "${BOY_SCOUT_OUTPUT:=}" "${CC_WARNINGS:=0}" "${WARNING_COUNT:=0}" \
     "${COVERAGE_PERCENT:=}" "${CHANGED_FILES:=}" "${PROJECT_LANG:=test}" \
     "${PROJECT_LANGS:=}" "${TESTS_OUTPUT:=}" "${BS_BLOCKED:=0}" \
     "${GATE_1_TOOL:=test-harness}"
# Symbols generate_quality_report() reads from elsewhere in the hook (see the
# same stub block in issue-536-degraded-report.test.bats).
resolve_languages_source() { printf '%s' "harness"; }
COVERAGE_THRESHOLD=80
COVERAGE_THRESHOLD_SOURCE="harness"
source "$1"
generate_quality_report
RUNNER
}

init_repo() {
  mkdir -p "$TEST_DIR/repo"
  cd "$TEST_DIR/repo" || return 1
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  git config core.hooksPath .git/hooks
  echo seed > README.md
  git add README.md
  git commit --no-verify -q -m seed
}

# Run the report with the given GATE_<n>_STATUS assignments.
run_report() {
  extract_report_fn
  printf '#!/bin/sh\ncd "%s/repo" || exit 1\n%s\nexec bash "%s/run-report.sh" "%s/report-fn.sh"\n' \
    "$TEST_DIR" "$(printf 'export %s\n' "$@")" "$TEST_DIR" "$TEST_DIR" > "$TEST_DIR/env-run.sh"
  run bash "$TEST_DIR/env-run.sh"
}

report_path() {
  echo ".xp-gate/quality-status/$(git rev-parse --abbrev-ref HEAD).json"
}

# Read one numeric-ish field from the report; prints "null" for JSON null.
field() {
  node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const v=r.overall[process.argv[2]];
process.stdout.write(String(v));
' "$(report_path)" "$1"
}

@test "AC-564-01: the report exposes a skip-counting score and the ran-count" {
  init_repo
  run_report GATE_1_STATUS=PASS GATE_2_STATUS=PASS
  [ "$status" -eq 0 ]
  [ -f "$(report_path)" ]

  node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const o=r.overall;
if (typeof o.scoreAllGates !== "number") { console.error("overall.scoreAllGates missing/not a number: "+JSON.stringify(o.scoreAllGates)); process.exit(1); }
if (typeof o.gatesRan !== "number") { console.error("overall.gatesRan missing/not a number: "+JSON.stringify(o.gatesRan)); process.exit(1); }
if (o.gatesRan !== o.gatesTotal - o.gatesSkipped) { console.error("gatesRan "+o.gatesRan+" != total-skipped "+(o.gatesTotal-o.gatesSkipped)); process.exit(1); }
' "$(report_path)"
}

@test "AC-564-02: skips lower the all-gates score while the effective score stays higher" {
  init_repo

  # Two gates pass; the rest take their built-in defaults (mostly SKIP, with
  # gate 12 defaulting to WARN, which is a non-pass).
  run_report GATE_1_STATUS=PASS GATE_2_STATUS=PASS
  [ "$status" -eq 0 ]
  local low_all low_eff low_ran
  low_all="$(field scoreAllGates)"
  low_eff="$(field score)"
  low_ran="$(field gatesRan)"

  # Now all twelve pass.
  run_report \
    GATE_1_STATUS=PASS GATE_2_STATUS=PASS GATE_3_STATUS=PASS \
    GATE_4_STATUS=PASS GATE_5_STATUS=PASS GATE_6_STATUS=PASS \
    GATE_7_STATUS=PASS GATE_8_STATUS=PASS GATE_9_STATUS=PASS \
    GATE_10_STATUS=PASS GATE_11_STATUS=PASS GATE_12_STATUS=PASS
  [ "$status" -eq 0 ]
  local high_all high_eff high_ran
  high_all="$(field scoreAllGates)"
  high_eff="$(field score)"
  high_ran="$(field gatesRan)"

  # The defect: a mostly-skipped run scored HIGHER than the fraction of gates it
  # actually exercised. With 3 of 12 gates run, the effective score is already
  # above the honest 2/12 fraction.
  [ "$low_ran" -lt 12 ]
  node -e '
const [lo,hi,ran]=[Number(process.argv[1]),Number(process.argv[2]),Number(process.argv[3])];
if (!(lo < hi)) { console.error("scoreAllGates did not rise when more gates ran: "+lo+" vs "+hi); process.exit(1); }
if (!(lo < 10)) { console.error("a mostly-skipped run still scored near-perfect on all gates: "+lo); process.exit(1); }
' "$low_all" "$high_all" "$low_ran"

  # scoreAllGates is exactly passed/total, so it cannot be inflated by skips.
  node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).overall;
const expect=(r.gatesPassed/r.gatesTotal*10).toFixed(1);
if (r.scoreAllGates.toFixed(1)!==expect) { console.error("scoreAllGates "+r.scoreAllGates+" != passed/total "+expect); process.exit(1); }
' "$(report_path)"

  # And it must sit strictly below the effective score whenever anything skipped.
  node -e '
const [eff,all]=[Number(process.argv[1]),Number(process.argv[2])];
if (!(all < eff)) { console.error("all-gates score "+all+" is not below effective "+eff+" despite skips"); process.exit(1); }
' "$low_eff" "$low_all"
}

@test "AC-564-03: SKIP-ALL yields a null effective score and a zero all-gates score" {
  # #507 made score number-or-null so a fully-skipped run cannot read as a real
  # verdict. scoreAllGates is a plain fraction, so 0.0 is the honest value there
  # — but the effective score must stay null, never a fabricated 10.0.
  init_repo
  run_report \
    GATE_1_STATUS=SKIP GATE_2_STATUS=SKIP GATE_3_STATUS=SKIP GATE_4_STATUS=SKIP \
    GATE_5_STATUS=SKIP GATE_6_STATUS=SKIP GATE_7_STATUS=SKIP GATE_8_STATUS=SKIP \
    GATE_9_STATUS=SKIP GATE_10_STATUS=SKIP GATE_11_STATUS=SKIP GATE_12_STATUS=SKIP
  [ "$status" -eq 0 ]

  [ "$(field verdict)" = "SKIP-ALL" ]
  [ "$(field score)" = "null" ]
  [ "$(field gatesRan)" = "0" ]
  [ "$(field scoreAllGates)" = "0" ]
}
