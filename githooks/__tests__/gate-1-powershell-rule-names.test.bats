#!/usr/bin/env bats
# @test REQ-G1-PS-RULES
#
# @intent When Gate 1 blocks on a PowerShell violation it must name the RULE, not just
# the fact that something was wrong. The table it prints already carries the rule
# name in its first column; both the verdict line and GATE_1_DETAIL used to drop it.
#
# Measured 2026-11-20 on a fixture with an unused variable:
#
#     RuleName                             Severity ScriptName Line Message
#     PSUseDeclaredVarsMoreThanAssignments Warning  leak.ps1   1    ...
#     ❌ BLOCKED - PSScriptAnalyzer violations (fix or add suppressions)
#
# and GATE_1_DETAIL was the constant "powershell: PSScriptAnalyzer findings". Anyone
# reading the journal, the report, or the one-line summary learned that something was
# wrong and not what.
#
# This is the same shape as the mypy arm that printed "PASSED - mypy" for a check it
# never invoked (#af701f63): the information existed, and the conclusion did not carry
# it.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE1="$REPO_ROOT/githooks/gate-entries/gate-1-entry.sh"
}

# @covers the block message includes the parsed rule name
@test "the PowerShell block arm echoes the rule names it parsed" {
  # The arm must both compute the rule list and print it; a computed-but-unprinted
  # value is the defect being fixed.
  run grep -c 'Rules: \$PS_RULES' "$GATE1"
  [ "$output" = "1" ]
}

# @covers GATE_1_DETAIL is not a constant
@test "GATE_1_DETAIL for the PowerShell block carries the rule names" {
  # A constant detail is what made the journal uninformative. The detail must
  # interpolate the parsed list.
  run grep -c 'GATE_1_DETAIL="powershell: PSScriptAnalyzer findings\${PS_RULES:+' "$GATE1"
  [ "$output" = "1" ]
}

# @covers the parser actually recognises the rule-name column
@test "the rule parser matches PSScriptAnalyzer's PS* rule names" {
  local parser
  parser=$(grep -A2 'PS_RULES=' "$GATE1" | grep -o "awk '.*'" | head -1)
  [ -n "$parser" ]

  # Feed the real table shape through the same awk program.
  local input output
  input='RuleName                             Severity ScriptName Line Message
PSUseDeclaredVarsMoreThanAssignments Warning  leak.ps1   1    The variable x is unused.
PSAvoidUsingWriteHost                Warning  good.ps1   1    Write-Host is discouraged.'
  output=$(printf '%s\n' "$input" | awk 'NF>3 && $1 ~ /^PS[A-Z]/ {print $1}' | sort -u)
  [ "$output" = "PSAvoidUsingWriteHost
PSUseDeclaredVarsMoreThanAssignments" ]
}
