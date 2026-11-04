#!/usr/bin/env bats

# #717 AC-717-09 (positive path) + AC-717-11 (end-to-end reachability)
#
# R1 round 2 asked for proof that run_tests() can actually return BOTH verdicts,
# not just that it exists. A test that only exercises the "cannot execute" path
# proves the adapter's happy path is unverified -- which is the same false-green
# shape #717 is about, one level down.
#
# These tests build a throwaway .NET project under the OS temp directory, never
# inside the repo: `dotnet test` aborts when run from any path inside this repo
# on this host (Win32Exception (5) from the VSTest testhost; see the design doc).
# Under $TMPDIR it works, so the genuine pass and fail paths ARE verifiable here.
#
# Guarded on `dotnet` so CI without the SDK reports SKIP rather than a false red;
# the skip is explicit and named, never silent.

setup() {
  REPO_ROOT="$BATS_TEST_DIRNAME/../.."
  ADAPTER="$REPO_ROOT/githooks/adapters/csharp.sh"
  FIXTURE=$(mktemp -d)
}

teardown() {
  rm -rf "$FIXTURE"
}

_require_dotnet() {
  command -v dotnet >/dev/null 2>&1 || skip "dotnet SDK not installed"
}

# Create a one-project xunit fixture whose single test either passes or fails.
_make_fixture() {
  local body="$1"
  ( cd "$FIXTURE" && dotnet new xunit -o P --force >/dev/null 2>&1 ) || return 1
  cat > "$FIXTURE/P/UnitTest1.cs" <<EOF
namespace P;
public class UnitTest1
{
    [Fact]
    public void TheTest() { $body }
}
EOF
}

@test "#717 AC-717-09: run_tests returns 0 when the C# tests pass" {
  _require_dotnet
  _make_fixture 'Assert.True(true);'
  run bash -c "cd '$FIXTURE' && source '$ADAPTER' && run_tests"
  [ "$status" -eq 0 ]
}

@test "#717 AC-717-09: run_tests returns 1 (not 2) when a C# test genuinely fails" {
  _require_dotnet
  _make_fixture 'Assert.True(false, \"deliberate\");'
  run bash -c "cd '$FIXTURE' && source '$ADAPTER' && run_tests"
  # 1 = ran and something failed. 2 would mean "could not execute", which would
  # be a lie here: the host was fine, the test was not.
  [ "$status" -eq 1 ]
}

@test "#717 AC-717-11: run_tests returns 2 when there is no test project at all" {
  _require_dotnet
  ( cd "$FIXTURE" && dotnet new classlib -o L --force >/dev/null 2>&1 )
  run bash -c "cd '$FIXTURE' && source '$ADAPTER' && run_tests"
  # A library with no tests must not read as "all tests passed" -- dotnet test
  # exits 0 and prints nothing for that shape, which is the silent success #717
  # exists to remove.
  [ "$status" -eq 2 ]
}

@test "#717 AC-717-11: run_tests returns 2 when dotnet is absent" {
  # Shadow ONLY dotnet. Two earlier drafts of this test were wrong and both
  # produced a DIFFERENT verdict than intended:
  #   - blanking PATH entirely also removed find/sed, so project discovery
  #     failed and the adapter said "no .NET project marker found";
  #   - the shadow script was written with a mangled newline, so it was not a
  #     valid executable and dotnet was still found via the real PATH entries.
  # Prepending a shadow dir keeps every other tool working, which is what makes
  # the "SDK absent" verdict the thing under test rather than a side effect.
  mkdir -p "$FIXTURE/bin-shadow"
  printf '#!/bin/sh
exit 127
' > "$FIXTURE/bin-shadow/dotnet"
  printf '#!/bin/sh
exit 127
' > "$FIXTURE/bin-shadow/dotnet.exe"
  chmod +x "$FIXTURE/bin-shadow/dotnet" "$FIXTURE/bin-shadow/dotnet.exe"
  touch "$FIXTURE/App.csproj"

  run bash -c "
    cd '$FIXTURE'
    PATH='$FIXTURE/bin-shadow':\$PATH
    export PATH
    source '$ADAPTER'
    run_tests
  "
  [ "$status" -eq 2 ]
}

# ---------------------------------------------------------------------------
# AC-717-14: Gate 5's CONSUMPTION of the adapter, not just the adapter itself.
#
# R1 round 5 (feasibility FC-02) was right that verifying `run_tests` return
# codes proves the adapter, not the gate: pre-commit turns a non-zero exit into
# a final verdict via handle_test_failure, and if that layer maps everything to
# BLOCKED the adapter's careful 2-vs-1 distinction is worthless. These assert
# the three verdicts the gate actually emits.
# ---------------------------------------------------------------------------

_gate5_verdict() {
  # Mirrors pre-commit:3212-3224 + lib/test-failure.sh, for CURRENT_LANG=csharp.
  # Written to a temp script instead of a nested `bash -c` string: three levels
  # of quoting inside bats turned this into a test of the escaping rather than
  # of the verdict (the first version failed for exactly that reason).
  local script="$FIXTURE/gate5-verdict.sh"
  cat > "$script" <<'EOS'
source "$REPO_ROOT/githooks/lib/test-failure.sh"
out="$1"; rc="$2"
if [ "$rc" -ne 0 ]; then
  if handle_test_failure "$out" 'csharp adapter' >/dev/null 2>&1; then
    echo EXCUSED
  else
    echo BLOCKED
  fi
else
  echo PASSED
fi
EOS
  REPO_ROOT="$REPO_ROOT" bash "$script" "$1" "$2"
}

@test "#717 AC-717-14: Gate 5 verdict is BLOCKED when a C# test genuinely fails" {
  run _gate5_verdict '失败!  - 失败: 1，通过: 0，已跳过: 0，总计: 1' 1
  [ "$output" = "BLOCKED" ]
}

@test "#717 AC-717-14: Gate 5 does not BLOCK when the C# testhost could not start" {
  run _gate5_verdict 'Testhost 进程已退出，但出现错误: System.ComponentModel.Win32Exception (5): 拒绝访问。' 1
  [ "$output" = "EXCUSED" ]
}

@test "#717 AC-717-14: Gate 5 verdict is PASSED when the C# tests pass" {
  run _gate5_verdict '已通过! - 失败: 0，通过: 3，已跳过: 0，总计: 3' 0
  [ "$output" = "PASSED" ]
}

# ---------------------------------------------------------------------------
# AC-717-16: the two testhost-crash inputs have OPPOSITE verdicts.
#
# R1 round 6 (FC-C1) caught that AC-717-14 and AC-717-09b looked contradictory:
# one says "testhost crash + rc=1 -> EXCUSED", the other says "testhost crash
# WITH a real failure -> not excused". They are not contradictory -- they are
# two different inputs, and the discriminator is whether a real test failure is
# also present. Stated as separate cases here so the boundary cannot be
# implemented backwards.
# ---------------------------------------------------------------------------

@test "#717 AC-717-16: testhost crash with NO real failure is EXCUSED" {
  run _gate5_verdict 'Testhost 进程已退出: System.ComponentModel.Win32Exception (5): 拒绝访问。' 1
  [ "$output" = "EXCUSED" ]
}

@test "#717 AC-717-16: testhost crash WITH a real failure is NOT excused" {
  # The host crashed, but a test had already reported a real failure, so the
  # run carries information and must block.
  run _gate5_verdict 'Testhost 进程已退出: Win32Exception (5)
Tests  2 failed | 1 passed (3)' 1
  [ "$output" = "BLOCKED" ]
}

@test "#717 AC-717-16: testhost crash WITH an AssertionError is NOT excused" {
  run _gate5_verdict 'Win32Exception (5) 拒绝访问
AssertionError: expected 1 to be 2' 1
  [ "$output" = "BLOCKED" ]
}
