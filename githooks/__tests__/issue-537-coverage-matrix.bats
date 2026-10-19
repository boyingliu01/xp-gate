#!/usr/bin/env bash
# Tests for #537 — per-language coverage matrix + Gate 6 reason.
#
# @test REQ-A,REQ-A2,REQ-B,REQ-C,REQ-D,REQ-E
# @intent Prove that a mixed-language repo can no longer present a SKIPped
#         dimension as "fully covered": every gate x language cell must land on
#         exactly one honest classification, and the dynamic nature of
#         PROJECT_LANGS must be exposed rather than hidden.
# @covers AC-A-01,AC-A-02,AC-A2-01,AC-A2-02,AC-B-01,AC-B-02,AC-C-01,AC-C-02,AC-D-02,AC-E-01
#
# These tests source the helpers from githooks/pre-commit rather than
# re-implementing them, so a drift between the tested contract and the
# shipped hook fails here.

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
}

# ── REQ-A: reason -> classification mapping ───────────────────────────────────

@test "classify_coverage_reason maps every documented reason" {
  # Source just the function, not the whole hook (which runs gates on load).
  eval "$(sed -n '/^classify_coverage_reason()/,/^}/p' "$PRE_COMMIT")"
  [ "$(type -t classify_coverage_reason)" = "function" ]

  # PASS with no reason is the ONLY way to reach covered.
  [ "$(classify_coverage_reason "" PASS)" = "covered" ]
  [ "$(classify_coverage_reason "" SKIP)" = "unknown" ]
  [ "$(classify_coverage_reason "" PASS_WITH_WARNINGS)" = "covered" ]
  [ "$(classify_coverage_reason "" WARN)" = "covered" ]

  [ "$(classify_coverage_reason documentation_project SKIP)" = "not_applicable" ]
  [ "$(classify_coverage_reason no_source_files_changed SKIP)" = "no_changes" ]
  [ "$(classify_coverage_reason tool_not_installed SKIP)" = "tool_missing" ]
  [ "$(classify_coverage_reason no_powershell_tool SKIP)" = "tool_missing" ]
  [ "$(classify_coverage_reason no_archlint_detector SKIP)" = "tool_missing" ]
  [ "$(classify_coverage_reason architecture_skip_exemption SKIP)" = "not_applicable" ]
}

@test "classify_coverage_reason understands Gate 4's own reason vocabulary" {
  # Learned by running the hook for real: Gate 4 emits these three, none of
  # which were in the original mapping, so every principles cell came out
  # `unknown` on a normal commit.
  eval "$(sed -n '/^classify_coverage_reason()/,/^}/p' "$PRE_COMMIT")"
  [ "$(classify_coverage_reason no_matching_files_changed SKIP)" = "no_changes" ]
  [ "$(classify_coverage_reason checker_not_found SKIP)" = "tool_missing" ]
  # A checker that ran and crashed measured nothing — unknown, not covered.
  [ "$(classify_coverage_reason checker_execution_error SKIP)" = "unknown" ]
}

@test "classify_coverage_reason never defaults an unknown reason to covered" {
  eval "$(sed -n '/^classify_coverage_reason()/,/^}/p' "$PRE_COMMIT")"
  # The whole point: an unrecognised reason must FAIL CLOSED.
  [ "$(classify_coverage_reason some_future_reason SKIP)" = "unknown" ]
  [ "$(classify_coverage_reason some_future_reason PASS)" = "unknown" ]
  # Mixed-summary sentinel from the Gate 6 aggregate.
  [ "$(classify_coverage_reason mixed SKIP)" = "unknown" ]
}

# ── REQ-A2: languagesSource ───────────────────────────────────────────────────

@test "quality-status declares languagesSource alongside coverageMatrix" {
  run grep -q '"languagesSource"' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
  run grep -q '"coverageMatrix"' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
}

@test "languagesSource distinguishes override, config, changed_files and none" {
  eval "$(sed -n '/^resolve_languages_source()/,/^}/p' "$PRE_COMMIT")"
  [ "$(type -t resolve_languages_source)" = "function" ]
  [ "$(resolve_languages_source "override" "config" "typescript")" = "override" ]
  [ "$(resolve_languages_source "" "config" "typescript")" = "config" ]
  [ "$(resolve_languages_source "" "" "typescript")" = "changed_files" ]
  [ "$(resolve_languages_source "" "" "")" = "none" ]
}

# ── REQ-B: Gate 6 reason ──────────────────────────────────────────────────────

@test "Gate 6 sets a reason when archlint has no detector for the language" {
  # The catch-all branch used to only echo. It must now record a reason.
  run grep -q 'GATE_6_REASON_BY_LANG\["\$CURRENT_LANG"\]="no_archlint_detector"' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
}

@test "Gate 6 keeps the scalar aggregate for the existing JSON field shape" {
  run grep -q 'GATE_6_REASON=' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
  run grep -q '"reason": "\${GATE_6_REASON' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
}

@test "a language archlint really measured is not labelled tool_missing" {
  # Learned by running the hook: the TypeScript branch runs archlint, but the
  # catch-all's reason leaked into the matrix for typescript too, so a covered
  # dimension was reported as tool_missing. The TS branch must set no reason at
  # all (absent reason + PASS status => covered).
  eval "$(sed -n '/^classify_coverage_reason()/,/^}/p' "$PRE_COMMIT")"
  [ "$(classify_coverage_reason "" PASS)" = "covered" ]
  # And the ASSIGNMENT must exist exactly once (in the catch-all), never in the
  # typescript case. The mapping table legitimately mentions the token too.
  run grep -c 'GATE_6_REASON_BY_LANG\["\$CURRENT_LANG"\]="no_archlint_detector"' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

# ── REQ-C: matrix key set ─────────────────────────────────────────────────────

@test "coverage matrix is keyed by PROJECT_LANGS and covers gates 3, 4 and 6" {
  run grep -q 'for _cm_lang in \$PROJECT_LANGS' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
  for gate in gate3_complexity gate4_principles gate6_architecture; do
    run grep -q "$gate" "$PRE_COMMIT"
    [ "$status" -eq 0 ]
  done
}

# ── REQ-E: unsupported language must not block ────────────────────────────────

@test "no-tool languages still SKIP rather than BLOCK" {
  run grep -q 'SKIPPED - Architecture validation (not configured for \$CURRENT_LANG)' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
  # And the gate must not exit 1 in that branch.
  eval "$(sed -n '/^classify_coverage_reason()/,/^}/p' "$PRE_COMMIT")"
  [ "$(classify_coverage_reason no_archlint_detector SKIP)" = "tool_missing" ]
}

@test "Gate 6 per-language reasons survive into the report function" {
  # `declare -A` inside a function is function-local in bash, and the report is
  # written by generate_quality_report() — a different function. So the gate
  # must flatten its per-language reasons into a GLOBAL string. Found by
  # running the hook for real: the matrix said tool_missing for typescript
  # because the lookup inside the report saw an empty array.
  run grep -q 'GATE_6_LANG_REASONS=' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
  # The report must read the flattened string, never the assoc array.
  run grep -q 'GATE_6_REASON_BY_LANG\[\$_cm_lang\]' "$PRE_COMMIT"
  [ "$status" -ne 0 ]
  run grep -q '_cm_g6_pairs=' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
}

@test "flattened lang=reason pairs parse back to the right language" {
  # Same parsing shape the report uses, exercised directly.
  GATE_6_LANG_REASONS="powershell=no_archlint_detector,typescript=tool_missing"
  for lang in powershell typescript iac; do
    pairs=",${GATE_6_LANG_REASONS},"
    got=""
    case "$pairs" in
      *",${lang}="*) got="${pairs#*",${lang}="}"; got="${got%%,*}" ;;
    esac
    case "$lang" in
      powershell) [ "$got" = "no_archlint_detector" ] ;;
      typescript) [ "$got" = "tool_missing" ] ;;
      iac)        [ -z "$got" ] ;;
    esac
  done
}

@test "pre-commit still parses after the change" {
  run bash -n "$PRE_COMMIT"
  [ "$status" -eq 0 ]
}

# ── REQ-D: zero behaviour change for the existing fields ──────────────────────

@test "existing quality-status fields keep their shape" {
  for field in reportVersion generatedAt branch commit overall gates; do
    run grep -q "\"$field\"" "$PRE_COMMIT"
    [ "$status" -eq 0 ]
  done
}
