#!/usr/bin/env bats
# @test REQ-555 coverage threshold has one source of truth
# @intent Verify the hook resolves the coverage threshold from the repo's own
#         declaration instead of a hardcoded 80. #555: a repo declaring
#         fail_under = 82 was judged against 80 in three independent places
#         (the quality report, lib/coverage-total.sh, and the generic block
#         branch), while CI enforced 82 -- so a commit at 81% passed the hook
#         and failed CI. Worst of the three was the report, which printed the
#         literal 80 as though it were the enforced value: a plausible wrong
#         number is harder to notice than a visible gap.
# @covers AC-555-01

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  WORK="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$WORK"
}

resolved() { # cwd = WORK; prints "threshold=NN source=..."
  ( cd "$WORK" && bash -c '
    _rct_value=""
    _rct_src="default"
    if [ -f pyproject.toml ]; then
      _rct_value=$(grep -oE "^[[:space:]]*fail_under[[:space:]]*=[[:space:]]*[0-9]+" pyproject.toml 2>/dev/null | grep -oE "[0-9]+" | head -1 || true)
      [ -n "$_rct_value" ] && _rct_src="pyproject"
    fi
    if [ -z "$_rct_value" ] && [ -f .coveragerc ]; then
      _rct_value=$(grep -oE "^[[:space:]]*fail_under[[:space:]]*=[[:space:]]*[0-9]+" .coveragerc 2>/dev/null | grep -oE "[0-9]+" | head -1 || true)
      [ -n "$_rct_value" ] && _rct_src="coveragerc"
    fi
    case "$_rct_value" in
      ""|*[!0-9]*) _rct_value="80"; _rct_src="default" ;;
    esac
    echo "$_rct_value"
  ' )
}

@test "anti-vacuity: the hook still has a coverage threshold concept" {
  grep -q 'COVERAGE_THRESHOLD' "$HOOK"
}

@test "the hook resolves the threshold from pyproject rather than hardcoding 80" {
  grep -q '_resolve_coverage_threshold' "$HOOK"
  grep -q 'fail_under' "$HOOK"
}

@test "no project-level coverage comparison uses a literal 80" {
  # The three sites the issue names. A per-new-file bar is a different
  # concept and is allowed to keep its own constant, documented as such.
  run bash -c "grep -nE 'COVERAGE_PERCENT\" -lt 80' '$HOOK'"
  [ "$status" -ne 0 ]
  run bash -c "grep -nE 'COVERAGE_ROUNDED.*-lt 80|TOTAL_COVERAGE.*-lt 80' '$HOOK'"
  [ "$status" -ne 0 ]
}

@test "the shared coverage-total helper does not hardcode 80" {
  run bash -c "grep -nE 'COVERAGE_PERCENT\" -lt 80' '$REPO_ROOT/githooks/lib/coverage-total.sh'"
  [ "$status" -ne 0 ]
}

@test "the report states the enforced threshold, not a literal" {
  # The report must interpolate the resolved value and name its source, so a
  # reader can tell "9 points of headroom" from "7 points of headroom".
  grep -q '"lines": ${COVERAGE_THRESHOLD}' "$HOOK"
  grep -q 'threshold_source' "$HOOK"
}

@test "the report does not invent values for dimensions it never measures" {
  # The old object claimed {functions: 80, branches: 70} while the hook only
  # ever checked a single line-total percentage -- numbers that look measured
  # and are not.
  grep -q '"functions": null' "$HOOK"
  grep -q '"branches": null' "$HOOK"
}

@test "a repo declaring fail_under is judged against that value" {
  printf '[tool.coverage.report]\nfail_under = 82\n' > "$WORK/pyproject.toml"
  [ "$(resolved)" = "82" ]
}

@test "a repo declaring fail_under in .coveragerc is judged against that value" {
  rm -f "$WORK/pyproject.toml"
  printf '[report]\nfail_under = 75\n' > "$WORK/.coveragerc"
  [ "$(resolved)" = "75" ]
}

@test "a repo declaring nothing keeps the historical default" {
  rm -f "$WORK/pyproject.toml" "$WORK/.coveragerc"
  [ "$(resolved)" = "80" ]
}

@test "the block message quotes the resolved threshold" {
  # A message that says 80 while the comparison uses 82 is worse than either.
  grep -q 'below ${COVERAGE_THRESHOLD}% threshold' "$HOOK"
  # Comments may quote the old wording when explaining the fix; live output
  # must not. Count only non-comment lines.
  local live
  live=$(grep -E 'below 80% threshold' "$HOOK" | grep -v '^[[:space:]]*#' | wc -l)
  [ "$live" -eq 0 ]
}
