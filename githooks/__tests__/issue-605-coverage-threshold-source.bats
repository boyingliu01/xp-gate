#!/usr/bin/env bats
# @test REQ-605
# @intent The hook enforced a coverage number it never read. `_resolve_coverage_threshold`
#         only understood Python declarations (pyproject `fail_under`, `.coveragerc`), so a
#         vitest project declaring `thresholds.lines: 60` was silently judged against the
#         hardcoded default 80. `npx vitest run` went green, the commit was then rejected,
#         and the two numbers lived in different files with nothing pointing at the gap.
#
#         `gate-coverage` had been printing "COVERAGE THRESHOLD CONFLICT" as a warning, which
#         is honest but is not a fix: the report told the truth while the hook kept blocking.
#
#         Also pinned here: `COVERAGE_THRESHOLD_SOURCE` was set inside a command
#         substitution, so the subshell discarded it and the audit record's
#         `threshold_source` field was empty on every commit ever recorded.
# @covers AC-605-05, AC-605-06

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  WORK="$(mktemp -d)"
  # Load just the resolver, so the test exercises the shipped code rather than a copy.
  sed -n '/^_resolve_coverage_threshold()/,/^}/p' "$HOOK" > "$WORK/resolver.sh"
}

teardown() {
  rm -rf "$WORK"
}

# Runs the real resolver inside a throwaway repo whose only relevant file is the given
# vitest config body. Prints "<threshold>|<source>".
resolve_in() {
  local name="$1" body="$2"
  mkdir -p "$WORK/$name"
  printf '%s\n' "$body" > "$WORK/$name/vitest.config.ts"
  ( cd "$WORK/$name" && bash -c '
      source "$1/resolver.sh"
      _resolve_coverage_threshold >/dev/null
      printf "%s|%s" "$_rct_value" "$COVERAGE_THRESHOLD_SOURCE"
    ' _ "$WORK" )
}

@test "AC-605-05: a vitest thresholds block is honoured instead of the default 80" {
  result="$(resolve_in v60 'export default defineConfig({ test: { coverage: { thresholds: { lines: 60, statements: 60 } } } })')"
  [ "${result%%|*}" = "60" ]
}

@test "AC-605-05: the reported source names the file it read" {
  result="$(resolve_in v80 'thresholds: { lines: 80 }')"
  case "${result#*|}" in
    *vitest.config.ts*) ;;
    *) false ;;
  esac
}

@test "AC-605-05: a repo declaring nothing still falls back to 80" {
  mkdir -p "$WORK/empty"
  ( cd "$WORK/empty" && bash -c '
      source "$1/resolver.sh"
      _resolve_coverage_threshold >/dev/null
      printf "%s" "$_rct_value"
    ' _ "$WORK" )
  [ "$?" -eq 0 ]
  result="$(cd "$WORK/empty" && bash -c '
      source "$1/resolver.sh"
      _resolve_coverage_threshold >/dev/null
      printf "%s" "$_rct_value"
    ' _ "$WORK")"
  [ "$result" = "80" ]
}

@test "AC-605-06: the hook does not set the threshold via command substitution" {
  # The subshell form silently discarded COVERAGE_THRESHOLD_SOURCE, leaving the
  # audit field `threshold_source` empty on every commit.
  # Anchor to the start of a non-comment line: the hook still MENTIONS the old form in
  # the comment that explains why it was removed, and that mention is not the defect.
  run grep -cE '^COVERAGE_THRESHOLD="\$\(_resolve_coverage_threshold\)"' "$HOOK"
  [ "$output" = "0" ]
  run grep -q '_resolve_coverage_threshold >/dev/null' "$HOOK"
  [ "$status" -eq 0 ]
}

@test "AC-605-05: the repo's own declared number is what the hook would enforce" {
  # End-to-end against the actual repo config: whatever vitest.config.ts says after
  # this run is the number pre-commit will compare against.
  declared="$(sed -n '/thresholds[[:space:]]*:[[:space:]]*{/,/}/p' "$REPO_ROOT/vitest.config.ts" \
    | grep -oE 'lines[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | head -1)"
  [ -n "$declared" ]
  actual="$( cd "$REPO_ROOT" && bash -c '
      source "$1/resolver.sh"
      _resolve_coverage_threshold >/dev/null
      printf "%s" "$_rct_value"
    ' _ "$WORK")"
  [ "$actual" = "$declared" ]
}
