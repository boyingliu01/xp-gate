#!/usr/bin/env bats
# @test REQ-598 Gate 3 must measure PowerShell complexity, not stand down in front of it
# @intent Gate 3's PowerShell arm used to be a hard SKIP with "no PowerShell tool".
#         That was true of lizard (it cannot parse .ps1) but not of the platform:
#         PowerShell's own AST yields an exact decision-point count, the same
#         quantity lizard measures for other languages. So a PowerShell-primary
#         repo had a permanently unmeasured quality dimension while the score
#         implied full coverage (#537).
#
#         The naive way to close that gap -- pipe AST output at the SAME ratchet
#         code used for lizard -- creates the opposite defect: with `-Threshold 1`
#         every function with CCN >= 2 prints OVER, so a brand-new well-factored
#         function (CCN 2-4, below the real threshold) is diffed against a
#         baseline that can never contain it and reported as a "regression". The
#         gate then blocks exactly the shape it exists to encourage (#598).
#
#         These cases pin both halves: the measurement exists and reports a real
#         number, and the ratchet compares against the configured threshold
#         rather than against 1.
# @covers AC-537-01 AC-598-10 AC-598-11 AC-598-12

GATE3="$BATS_TEST_DIRNAME/../gate-3.sh"
MEASURE="$BATS_TEST_DIRNAME/../lib/Measure-PowerShellComplexity.ps1"

pwsh_available() {
  command -v pwsh >/dev/null 2>&1 || command -v powershell.exe >/dev/null 2>&1
}

@test "anti-vacuity: the PowerShell arm and its measuring script exist" {
  # Without these the cases below could pass by testing an arm that is still a
  # hard SKIP.
  grep -q 'powershell' "$GATE3"
  [ -f "$MEASURE" ]
  grep -q 'FunctionDefinitionAst' "$MEASURE"
}

@test "AC-537-01: the measuring script counts decision points, not lines" {
  pwsh_available || skip "no PowerShell engine on this host"

  local work="$BATS_TEST_TMPDIR/ccn-measure"
  mkdir -p "$work"
  # Alpha: 5 `if` statements plus one `-and` = CCN 7. Beta: no decisions = CCN 1.
  # A line-counting implementation would not separate these two.
  cat > "$work/sample.psm1" <<'PS1'
function Alpha {
    param($a, $b, $c, $d, $e)
    if ($a) { 1 }
    if ($b) { 2 }
    if ($c) { 3 }
    if ($d) { 4 }
    if ($e -and $a) { 5 }
    return 0
}
function Beta {
    return 42
}
PS1

  local engine
  engine=$(command -v pwsh || command -v powershell.exe)
  run "$engine" -NoProfile -NonInteractive -ExecutionPolicy Bypass \
    -File "$MEASURE" -Path "$work/sample.psm1" -Threshold 5 -List

  [ "$status" -eq 0 ]
  [[ "$output" == *"functions_measured=2"* ]]
  [[ "$output" == *"max_ccn=7"* ]]
  # Alpha (CCN 7) is above the threshold so it is emitted as OVER; Beta (CCN 1)
  # is below it and is emitted only because -List asks for the full population.
  # Both lines carry the same file:line name ccn=N shape the gate parses.
  [[ "$output" == *"OVER "*"Alpha ccn=7"* ]]
  [[ "$output" == *"FUNC "*"Beta ccn=1"* ]]
}

@test "AC-598-10: -Threshold 1 does not report a well-factored function as OVER" {
  pwsh_available || skip "no PowerShell engine on this host"

  # The defect in one assertion. A CCN-2 function is below any sane threshold
  # (default 5), so it must NOT be emitted as OVER, whatever threshold the
  # caller asks for below it. This is what makes a baseline comparison meaningful.
  local work="$BATS_TEST_TMPDIR/ccn-threshold1"
  mkdir -p "$work"
  cat > "$work/simple.psm1" <<'PS1'
function Simple {
    param($a)
    if ($a) { return 1 }
    return 0
}
PS1

  local engine
  engine=$(command -v pwsh || command -v powershell.exe)

  # Threshold 1 is the ratchet's historical value: every function with CCN >= 2
  # was OVER. With the correct wiring the ratchet asks for the RESOLVED
  # threshold, so the interesting assertion is that the gate passes the resolved
  # value through rather than a literal 1.
  run "$engine" -NoProfile -NonInteractive -ExecutionPolicy Bypass \
    -File "$MEASURE" -Path "$work/simple.psm1" -Threshold 5 -List
  [ "$status" -eq 0 ]
  [[ "$output" != *"OVER "* ]]
  [[ "$output" == *"FUNC "*"Simple"*"ccn=2"* ]]

  grep -qE 'Threshold \$\{PS_CC_THRESHOLD\}' "$GATE3" || {
    echo "the ratchet does not pass the resolved threshold to the measuring script"; return 1;
  }
  # The old -Threshold 1 form must be gone from the CALL SITES. A comment may
  # still name it -- explaining why it was wrong is the point -- so only
  # non-comment lines count.
  local live
  live=$(grep -nE -- '-Threshold[[:space:]]+1([[:space:]]|")' "$GATE3" | grep -vE ':[[:space:]]*#' || true)
  [ -z "$live" ] || {
    echo "the ratchet still invokes -Threshold 1:"; echo "$live"; return 1;
  }
}

@test "AC-598-11: the gate names its engine rather than blaming the repository" {
  # #581 recorded this shape: pwsh.exe is a NATIVE binary and cannot open the
  # POSIX path the hook holds. Handed one unchanged it resolves the leading "/"
  # to "<drive>:\", measures zero files, and the gate reports "no functions" --
  # an environment fault reported as a verdict about the repository. The arm must
  # convert the path before handing it over.
  grep -q 'to_native_path' "$GATE3" || {
    echo "the PowerShell arm does not convert the script path to native form"; return 1;
  }

  # And a missing engine must WARN, not SKIP silently: "we could not look" and
  # "there is nothing to look at" are different facts (#537).
  grep -q 'no_powershell_engine' "$GATE3"
}

@test "AC-598-12: a repo with no added PowerShell file does not claim a verdict" {
  # Baseline-absent ratchet: a modified .ps1 with no baseline has nothing to
  # compare against, and silently passing is the #584 failure mode.
  grep -q 'baseline_unreadable' "$GATE3"
  grep -q 'no_added_powershell_files' "$GATE3"
}
