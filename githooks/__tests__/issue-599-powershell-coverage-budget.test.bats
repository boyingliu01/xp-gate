#!/usr/bin/env bats
# @test REQ-599 PowerShell coverage gets its own timeout budget
# @intent run_tests and run_coverage shared ONE _pester_timeout with a default of
#         300s. That is not the same headroom for both: run_coverage enables
#         CodeCoverage, and instrumentation alone costs more than a plain run. A
#         suite that passed in 285s therefore died at 300s once instrumented, and
#         the message said
#             Pester coverage TIMED OUT after 300s (may be hanging).
#         i.e. a budget shortfall was reported as "a test is hanging", pointing
#         the reader at the wrong thing while every code commit was blocked.
#
#         A fix for 0.31.1 (a separate XP_GATE_POWERSHELL_COVERAGE_TIMEOUT_S and
#         a dedicated wrapper) was overwritten when 0.31.2 unified the two
#         helpers, so the regression is a re-introduction, not a new defect.
#         The unified helper is the right shape -- the defect was merging the
#         DEFAULTS too. This pins "one helper, two budgets".
# @covers AC-599-01 AC-599-02 AC-599-03

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
PS_ADAPTER="$REPO_ROOT/githooks/adapters/powershell.sh"

setup() {
  cd "$BATS_TEST_TMPDIR" || return 1
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
}

@test "AC-599-01: run_coverage does not use the plain-test budget variable" {
  # Structural: the coverage call site must reference its own variable.
  run grep -n '_pester_timeout' "$PS_ADAPTER"
  [ "$status" -eq 0 ]

  # The coverage invocation line must name the coverage budget.
  run bash -c "grep -n '_pester_timeout .*XP_GATE_POWERSHELL_COVERAGE_TIMEOUT_S' '$PS_ADAPTER'"
  [ "$status" -eq 0 ]

  # And the coverage default must be strictly larger than the test default:
  # instrumentation cannot be assumed to cost the same as a plain run.
  local cov_default test_default
  cov_default=$(grep -o 'XP_GATE_POWERSHELL_COVERAGE_TIMEOUT_S:-[0-9]\+' "$PS_ADAPTER" | head -1 | grep -o '[0-9]\+$')
  test_default=$(grep -o 'XP_GATE_POWERSHELL_TEST_TIMEOUT_S:-[0-9]\+' "$PS_ADAPTER" | head -1 | grep -o '[0-9]\+$')
  [ -n "$cov_default" ]
  [ -n "$test_default" ]
  [ "$cov_default" -gt "$test_default" ]
}

@test "AC-599-02: each timeout message names the variable that governs it" {
  # A reader who sees "TIMED OUT" must be told WHICH knob to turn. Before the
  # fix both messages interpolated XP_GATE_POWERSHELL_TEST_TIMEOUT_S, so raising
  # the coverage budget had no visible effect on the text.
  run grep -n 'Pester tests TIMED OUT' "$PS_ADAPTER"
  [ "$status" -eq 0 ]

  # The coverage message must name the coverage variable, not the test one.
  local cov_msg
  cov_msg=$(grep 'Pester coverage TIMED OUT' "$PS_ADAPTER")
  [ -n "$cov_msg" ]
  [[ "$cov_msg" == *"XP_GATE_POWERSHELL_COVERAGE_TIMEOUT_S"* ]]
}

@test "AC-599-03: the helper resolves two distinct budgets" {
  command -v bash >/dev/null 2>&1 || skip "no bash"

  # Exercise the real helper by sourcing its definition from the adapter and
  # shimming `timeout` to report the budget it was handed instead of sleeping.
  # The helper takes the GNU branch only when `timeout --version` mentions
  # coreutils, so the shim has to satisfy that probe too.
  cat > "$BATS_TEST_TMPDIR/probe.sh" <<EOF
set -uo pipefail
timeout() {
  if [ "\${1:-}" = "--version" ]; then echo "coreutils 2.39"; return 0; fi
  # Expected shape: timeout "<n>s" <cmd...>; report the budget, do not sleep.
  printf 'budget=%s\n' "\${1%s}"
  return 0
}

$(sed -n '/^_pester_timeout()/,/^}/p' "$PS_ADAPTER")

_pester_timeout "XP_GATE_POWERSHELL_TEST_TIMEOUT_S" "\${XP_GATE_POWERSHELL_TEST_TIMEOUT_S:-300}" true
_pester_timeout "XP_GATE_POWERSHELL_COVERAGE_TIMEOUT_S" "\${XP_GATE_POWERSHELL_COVERAGE_TIMEOUT_S:-900}" true
XP_GATE_POWERSHELL_TEST_TIMEOUT_S=450 _pester_timeout "XP_GATE_POWERSHELL_TEST_TIMEOUT_S" "\${XP_GATE_POWERSHELL_TEST_TIMEOUT_S:-300}" true
XP_GATE_POWERSHELL_COVERAGE_TIMEOUT_S=1800 _pester_timeout "XP_GATE_POWERSHELL_COVERAGE_TIMEOUT_S" "\${XP_GATE_POWERSHELL_COVERAGE_TIMEOUT_S:-900}" true
EOF

  # Clear the host's overrides: this machine sets XP_GATE_POWERSHELL_TEST_TIMEOUT_S,
  # and inheriting it would make the "default" assertions below pass for the wrong
  # reason (or fail while the code is correct).
  unset XP_GATE_POWERSHELL_TEST_TIMEOUT_S XP_GATE_POWERSHELL_COVERAGE_TIMEOUT_S

  run env -u XP_GATE_POWERSHELL_TEST_TIMEOUT_S -u XP_GATE_POWERSHELL_COVERAGE_TIMEOUT_S \
    bash "$BATS_TEST_TMPDIR/probe.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"budget=300"* ]]
  [[ "$output" == *"budget=900"* ]]
  [[ "$output" == *"budget=450"* ]]
  [[ "$output" == *"budget=1800"* ]]
}
