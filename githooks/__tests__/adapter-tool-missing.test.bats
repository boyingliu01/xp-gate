#!/usr/bin/env bats
#
# @test REQ-ADAPTER-NOTOOL a missing tool is "not verified", never "violations found"
# @intent Gate 1 maps an adapter's exit code onto a verdict:
#
#           0      -> PASS
#           1 or 2 -> BLOCK
#           3      -> WARN, NOT verified
#
#        Three adapters returned 1 when their toolchain was simply absent. Gate 1
#        reads 1 as "the analyzer found problems", so a machine without the tool
#        blocked every commit in that language with a message naming violations no
#        tool had looked for.
#
#        Measured 2026-11-20, language matrix, swift fixture without SwiftLint:
#
#            SwiftLint not available
#            SwiftLint not available
#            BLOCKED - swift code quality violations (fix or add suppressions)
#            chain stopped at Gate 1 -- gates 2 3 8 10 7 5 6 4 never reached
#
#        Two harms in one line: a clean project reported dirty, and eight later
#        gates never ran because the chain stopped.
#
#        This is the INVERSE of the usual defect in this series. The others reported
#        a pass nobody had earned; this reported a failure nobody had found. Same
#        root cause: an exit code chosen for its value rather than for what the
#        caller does with it.
#
#        PHP is deliberately NOT changed: it returns 2, which Gate 1 has an explicit
#        fail-closed arm for ("toolchain could not execute — NOT a pass"), asserted
#        by issue-717-mirror-parity.test.bats and documented in the hook. 1 and 2
#        mean different things to the caller even though both block.
#
# @covers AC-ANT-01  swift returns 3, not 1, without SwiftLint
# @covers AC-ANT-02  dart returns 3, not 1, without the Dart SDK
# @covers AC-ANT-03  flutter returns 3, not 1, without the Flutter SDK
# @covers AC-ANT-04  the skip carries XP_G1_REASON so the WARN is not reasonless
# @covers AC-ANT-05  a piped tool still reports the TOOL's status, not sed's
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

@test "AC-ANT-01: swift returns 3 (not 1) when SwiftLint is absent" {
  local dir="$BATS_TEST_TMPDIR/noswiftlint"
  mkdir -p "$dir"
  run bash -c '
    PATH="$1"
    export PATH
    # shellcheck source=/dev/null
    . "$2" >/dev/null 2>&1 || true
    run_static_analysis >/dev/null 2>&1; echo "SA=$?"
    run_lint >/dev/null 2>&1; echo "LINT=$?"
  ' _ "$dir" "$REPO/githooks/adapters/swift.sh"
  printf '%s' "$output" | grep -q 'SA=3' || { echo "static analysis: $output"; false; }
  printf '%s' "$output" | grep -q 'LINT=3' || { echo "lint: $output"; false; }
}

@test "AC-ANT-02: dart returns 3 (not 1) when the SDK is absent" {
  # Hide the tool instead of skipping when it happens to be installed. Skipping
  # "because the tool is present here" means the assertion is never executed on
  # the machine where it matters most -- the developer's own, where everything is
  # installed and the absent-tool branch is therefore never exercised by accident.
  # A PATH with only the coreutils the adapter itself needs keeps the branch real.
  local dir="$BATS_TEST_TMPDIR/nodart"
  mkdir -p "$dir"
  run bash -c '
    PATH="$1"
    export PATH
    # shellcheck source=/dev/null
    . "$2" >/dev/null 2>&1 || true
    run_static_analysis >/dev/null 2>&1; echo "SA=$?"
  ' _ "$dir" "$REPO/githooks/adapters/dart.sh"
  printf '%s' "$output" | grep -q 'SA=3' || {
    echo "a machine without the Dart SDK reports violations instead of 'not verified':"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-ANT-03: flutter returns 3 (not 1) when the SDK is absent" {
  local dir="$BATS_TEST_TMPDIR/noflutter"
  mkdir -p "$dir"
  run bash -c '
    PATH="$1"
    export PATH
    # shellcheck source=/dev/null
    . "$2" >/dev/null 2>&1 || true
    run_static_analysis >/dev/null 2>&1; echo "SA=$?"
  ' _ "$dir" "$REPO/githooks/adapters/flutter.sh"
  printf '%s' "$output" | grep -q 'SA=3' || {
    echo "a machine without the Flutter SDK reports violations instead of 'not verified':"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-ANT-04: the absent-tool path emits XP_G1_REASON" {
  # Gate 1 lifts '^XP_G1_REASON: ' out of the adapter output and stores it as
  # GATE_1_DETAIL. Without it the WARN carries no reason, which is the same defect
  # one channel further out.
  local f
  for f in swift dart flutter; do
    local path="$REPO/githooks/adapters/$f.sh"
    grep -q 'XP_G1_REASON' "$path" || {
      echo "$f does not emit XP_G1_REASON on its absent-tool path"
      false
    }
  done
}

@test "AC-ANT-05: a piped tool reports the TOOL's status, not the pipe's" {
  # Independent defect found while fixing the above: `tool ... | sed ...; return $?`
  # returns SED's status. sed succeeds almost always, so a real finding from
  # `dart analyze` or `dart format` was reported as 0 -- a pass nobody earned.
  # PIPESTATUS[0] is the tool.
  local f path bad
  for f in dart flutter; do
    path="$REPO/githooks/adapters/$f.sh"
    # Any `return $?` immediately after a pipeline is the bug.
    bad=$(grep -nE '^\s*return \$\?' "$path" | while IFS=: read -r ln _; do
      prev=$(sed -n "$((ln-1))p" "$path")
      printf '%s' "$prev" | grep -q '|' && printf '%s\n' "$ln"
    done)
    [ -z "$bad" ] || {
      echo "$f.sh returns \$? after a pipeline at line(s): $bad"
      echo "-> that is sed's or tail's status, not the tool's"
      false
    }
  done
}
