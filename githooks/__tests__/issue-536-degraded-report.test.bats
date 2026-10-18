#!/usr/bin/env bats
# @test REQ-536
# @intent "Scanned and clean" and "never scanned at all" were indistinguishable
#         in the quality report: Gate 10 recorded PASS when no code files
#         changed, and a missing tool left no trace in the JSON. This suite
#         pins the honest accounting: reason/degraded markers on non-scanned
#         paths, scanned_files evidence where a PASS is trivially true, and a
#         top-level gatesDegraded summary that keeps degraded distinct from a
#         real PASS.
# @covers AC-536-01, AC-536-02, AC-536-03, AC-536-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
  TEST_DIR="$(mktemp -d)"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Extract generate_quality_report() verbatim into a runnable file so the test
# exercises the REAL aggregation/JSON logic without running the whole hook.
extract_report_fn() {
  # Stop at the ENDJSON terminator, not the first column-0 '}': the heredoc's
  # JSON body contains a column-0 '}' that would truncate the extraction.
  sed -n '/^generate_quality_report()/,/^ENDJSON$/p' "$PRE_COMMIT" > "$TEST_DIR/report-fn.sh"
  printf '}\n' >> "$TEST_DIR/report-fn.sh"
  cat > "$TEST_DIR/run-report.sh" << 'RUNNER'
set -u
# The function runs inside the full hook where these are always assigned;
# supply the same defaults for the isolated harness.
: "${BOY_SCOUT_OUTPUT:=}" "${CC_WARNINGS:=0}" "${WARNING_COUNT:=0}" \
     "${COVERAGE_PERCENT:=}" "${CHANGED_FILES:=}" "${PROJECT_LANG:=test}" \
     "${TESTS_OUTPUT:=}" "${BS_BLOCKED:=0}" \
     "${GATE_1_TOOL:=test-harness}"
source "$1"
generate_quality_report
RUNNER
}

# Run the report function with every gate status supplied via env-like args.
# `run` resets the environment (bats), so exports go through a wrapper script.
run_report() {
  extract_report_fn
  printf '#!/bin/sh\ncd "%s/repo" || exit 1\n%s\nexec bash "%s/run-report.sh" "%s/report-fn.sh"\n' \
    "$TEST_DIR" "$(printf 'export %s\n' "$@")" "$TEST_DIR" "$TEST_DIR" > "$TEST_DIR/env-run.sh"
  run bash "$TEST_DIR/env-run.sh"
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

@test "#536 pre-commit no-code-changed path records SKIP with a reason, not bare PASS" {
  grep -E 'No code files changed, skipping SAST scan' "$PRE_COMMIT" >/dev/null
  # The branch that prints that banner must NOT set GATE_10_STATUS="PASS";
  # it must record SKIP plus an explicit reason for the report.
  run awk '/No code files changed, skipping SAST scan/{found=NR} found && NR>=found && NR<=found+3 && /GATE_10_STATUS=/{print; exit}' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
  [[ "$output" == *SKIP* ]]
  grep -E 'GATE_10_REASON=' "$PRE_COMMIT" >/dev/null
}

@test "#536 gate-10 sets a degrade reason when semgrep is unavailable" {
  for f in githooks/gate-10.sh src/npm-package/gate-10.sh src/npm-package/hooks/gate-10.sh; do
    awk '/semgrep not installed/{found=NR} found && NR>=found && NR<=found+6 && /GATE_10_REASON=.*tool_not_installed/{ok=1} END{exit !ok}' "$REPO_ROOT/$f"
  done
}

@test "#536 report exposes gatesDegraded counting WARN gates" {
  init_repo
  run_report GATE_10_STATUS=WARN GATE_10_REASON=tool_not_installed
  [ "$status" -eq 0 ]
  REPORT=".xp-gate/quality-status/$(git rev-parse --abbrev-ref HEAD).json"
  [ -f "$REPORT" ]
  node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
if (!r.overall || typeof r.overall.gatesDegraded !== "number") { console.error("overall.gatesDegraded missing"); process.exit(1); }
if (r.overall.gatesDegraded < 1) { console.error("degraded WARN gate not counted"); process.exit(1); }
if (r.gates.gate10_sast.status !== "WARN") { console.error("gate10 status lost"); process.exit(1); }
' "$REPORT"
}

@test "#536 trivially-clean security gates carry scanned_files evidence" {
  init_repo
  # All gates default-PASS with no gate-specific evidence vars set: the
  # report must still state how many files those scans covered (0 = trivial
  # pass, auditable) instead of a bare PASS claim.
  run_report
  [ "$status" -eq 0 ]
  REPORT=".xp-gate/quality-status/$(git rev-parse --abbrev-ref HEAD).json"
  node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
for (const k of ["gate7_iac_security","gate10_sast"]) {
  if (typeof r.gates[k].scanned_files !== "number") { console.error(k+" lacks numeric scanned_files"); process.exit(1); }
}
' "$REPORT"
}
