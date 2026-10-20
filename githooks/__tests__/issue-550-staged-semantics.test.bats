#!/usr/bin/env bats
# @test REQ-550 --staged semantics hold for the Java gate
# @intent Verify the Java adapter does not relay a verdict the tool had no basis
#         to produce. #550: wc-java-lint 0.4.1 honours --staged for checkstyle,
#         PMD, lizard and simian, but spotbugs scans all of target/classes
#         regardless. Measured with only docs/_tmp_probe.md staged: three tools
#         reported "skipped: no Java files" while spotbugs reported "checked 1
#         .class file, found 3 issues" from a class compiled earlier, and the
#         resulting exit 1 blocked a docs-only commit over a warning that
#         predated it and that its author never touched.
#         The upstream fix belongs in wc-java-lint; this pins the adapter's side
#         of the contract so consumer repos are protected either way.
# @covers AC-550-01

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  JAVA_ADAPTER="$REPO_ROOT/githooks/adapters/java.sh"
}

@test "anti-vacuity: java.sh still drives wc-java-lint --staged" {
  grep -q 'check --staged' "$JAVA_ADAPTER"
  grep -q 'run_static_analysis()' "$JAVA_ADAPTER"
}

@test "the adapter checks for staged Java files before trusting the verdict" {
  grep -q 'java_staged_files' "$JAVA_ADAPTER"
  # The guard must live inside run_wc_java_lint, before the tool is invoked.
  local fn_start guard_line tool_line
  fn_start=$(grep -n '^run_wc_java_lint() {' "$JAVA_ADAPTER" | cut -d: -f1)
  guard_line=$(grep -n 'staged_java=' "$JAVA_ADAPTER" | head -1 | cut -d: -f1)
  tool_line=$(grep -n '"\$bin" check --staged' "$JAVA_ADAPTER" | head -1 | cut -d: -f1)
  [ -n "$fn_start" ] && [ -n "$guard_line" ] && [ -n "$tool_line" ]
  [ "$guard_line" -gt "$fn_start" ]
  [ "$guard_line" -lt "$tool_line" ]
}

@test "the skip is announced, not silent" {
  # A gate that declines to judge must say so; silence is indistinguishable
  # from a pass that found nothing.
  grep -q 'SKIPPED - Java static analysis' "$JAVA_ADAPTER"
  grep -q '#550' "$JAVA_ADAPTER"
}

@test "the skip returns success so a docs commit is not blocked" {
  # Locate the guard block and assert its return value.
  local block
  block=$(awk '/staged_java=/,/^  fi$/' "$JAVA_ADAPTER")
  echo "$block" | grep -q 'return 0'
}

@test "with no staged Java the adapter exits 0 (end-to-end)" {
  local work="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$work/docs"
  git -C "$work" init -q 2>/dev/null
  git -C "$work" config user.email t@example.com
  git -C "$work" config user.name t
  printf '# r\n' > "$work/README.md"
  git -C "$work" add README.md
  echo probe > "$work/docs/_tmp_probe.md"
  git -C "$work" add docs/_tmp_probe.md

  run bash -c "cd '$work' && source '$JAVA_ADAPTER' && run_static_analysis; echo EXIT=\$?"
  # Either the tool is absent (fallback path) or the guard fires; neither may
  # block, and if the guard fired it must have said so.
  [[ "$output" != *"EXIT=1"* ]]
}
