#!/usr/bin/env bats
# @test REQ-571
# @intent The unmerged branch `fix/powershell-gates-fail-closed` carries one
#         feature that main does not have: a repo-local scope file,
#         `.xp-gate-powershell-analysis-paths`, that narrows PSScriptAnalyzer to
#         PRODUCT code.
#
#         Why it matters: Pester test files legitimately trip dozens of rule
#         warnings under the Pester execution model. Without scoping, a whole-repo
#         scan either blocks every PowerShell commit or forces the rule set open —
#         both are ways to stop gating PowerShell at all, which is exactly the
#         failure #547 fixed for everything except scope.
#
#         The load-bearing half is not the narrowing, it is what happens when the
#         scope goes STALE. A path listed in the scope file but missing on disk
#         means product code escaped the gate (renamed, moved, or a new script
#         added without updating the file). That must fail CLOSED — emit
#         `XP_G1_REASON: analysis-path-missing:<path>` so the pre-commit
#         powershell arm maps it to WARN inside the scoring denominator — rather
#         than silently analysing less and reporting PASS.
#
#         Same for an empty/comment-only scope file: silently dropping to zero
#         paths would turn the gate into a no-op that still exits 0.
#
#         These assertions drive the REAL run_static_analysis with a stub engine
#         on PATH, so they measure emitted reasons, not source text.
# @covers AC-571-01, AC-571-02, AC-571-03, AC-571-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/powershell.sh"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/repo"
  cd "$WORK/repo" || return 1
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$WORK"
}

# Install a stub `pwsh` that answers the module probe with success and reports
# "no findings" for a scoped run, so the ONLY reason lines that can appear come
# from the scope logic under test.
#
# The stub is a shell script standing in for pwsh: run_static_analysis invokes
# it with -NoProfile-style args and a `-Command`-ish payload, and only inspects
# the EXIT CODE (that is the adapter's own contract: "probe by exit code, never
# by stdout"). So the stub only needs to exit 0.
install_stub_engine() {
  mkdir -p "$WORK/bin"
  cat > "$WORK/bin/pwsh" << 'STUB'
#!/bin/bash
exit 0
STUB
  chmod +x "$WORK/bin/pwsh"
  export PATH="$WORK/bin:$PATH"
}

# Source the adapter and call run_static_analysis in a subshell, echoing output.
run_adapter_analysis() {
  bash -c '
    set -u
    # shellcheck disable=SC1090
    source "$1" >/dev/null 2>&1
    run_static_analysis 2>&1
  ' _ "$ADAPTER"
}

@test "AC-571-01: a missing scope entry emits a fail-closed reason" {
  install_stub_engine
  printf 'src/present\nsrc/renamed-away\n' > .xp-gate-powershell-analysis-paths
  mkdir -p src/present

  run run_adapter_analysis
  [ -n "$output" ]

  # The present path is analysed; the missing one is reported, not skipped.
  [[ "$output" == *"XP_G1_REASON: analysis-path-missing:src/renamed-away"* ]]
}

@test "AC-571-02: a scope file with no usable entries does not analyse nothing silently" {
  install_stub_engine
  # Comments and blanks only: zero targets. Falling through to a zero-path run
  # would exit 0 and read as a clean PASS.
  printf '# only comments\n\n   \n' > .xp-gate-powershell-analysis-paths

  run run_adapter_analysis
  [ -n "$output" ]

  [[ "$output" == *"XP_G1_REASON: analysis-paths-empty"* ]]
}

@test "AC-571-03: without a scope file the whole-repo path still runs" {
  # Anti-vacuity: the scope feature must not become a reason to skip analysis
  # when no scope file exists. No reason line should be emitted, and the stub
  # engine must actually have been invoked.
  install_stub_engine
  [ ! -f .xp-gate-powershell-analysis-paths ]

  cat > "$WORK/bin/pwsh" << 'STUB'
#!/bin/bash
# Record that we were called, then report "no findings".
echo called >> "$XP_STUB_CALLS"
exit 0
STUB
  chmod +x "$WORK/bin/pwsh"
  export XP_STUB_CALLS="$WORK/calls.txt"
  : > "$XP_STUB_CALLS"

  run run_adapter_analysis
  [ -s "$XP_STUB_CALLS" ]
  [[ "$output" != *"XP_G1_REASON: analysis-paths-empty"* ]]
  [[ "$output" != *"analysis-path-missing"* ]]
}

@test "AC-571-04: an engine whose run fails emits a fail-closed reason" {
  # The fail-closed reason must survive the scope work: when the engine exists
  # but cannot produce a verdict, the adapter must emit an XP_G1_REASON line
  # (which the pre-commit arm maps to WARN in the denominator) rather than
  # returning an empty success.
  #
  # Deliberately NOT tested by stripping PATH: `_detect_pwsh` probes the real
  # absolute Windows install (`/c/Windows/System32/WindowsPowerShell/v1.0/
  # powershell.exe`), finds it, and actually runs PowerShell — measured, the
  # test then hangs past its timeout instead of exercising the branch. Faking
  # "no engine at all" on Windows means uninstalling the OS one, so the honest
  # reachable assertion is the *failed run* path: stub engine, non-zero exit.
  #
  # Asserted on the PROTOCOL, not the wording: main says "PSScriptAnalyzer run
  # failed (exit N)" and the unmerged branch says
  # "powershell-engine-unavailable"/"psscriptanalyzer-unavailable". Pinning
  # either string would fail for a cosmetic change while still missing a
  # genuinely silent pass.
  mkdir -p "$WORK/bin"
  cat > "$WORK/bin/pwsh" << 'STUB'
#!/bin/bash
echo "stub: engine blew up" >&2
exit 7
STUB
  chmod +x "$WORK/bin/pwsh"
  export PATH="$WORK/bin:$PATH"

  run run_adapter_analysis

  [[ "$output" == *"XP_G1_REASON: "* ]]
}
