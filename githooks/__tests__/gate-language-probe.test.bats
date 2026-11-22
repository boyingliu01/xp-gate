#!/usr/bin/env bats
# @test REQ-GATE-PROBE-RUNS
#
# @intent The probe script is the only thing in this repository that proves a gate
# refuses a real defect in a real language. Every other test in this directory
# asserts on source: that an arm exists, that a variable is set, that a registry
# row is present. Those tests were all green while Gate 13 loaded a copy whose
# declared-check arm did not exist, while Gate 12 could not find its own awk file,
# while Gate 4 printed "NOT ANALYSED" and recorded PASS, and while Gate 8 refused a
# commit and recorded SKIP.
#
# These cases check the probe SCRIPT itself, not the gates: that it is wired up,
# that its contract is stated, and that it does not regress into the two mistakes
# it has already made -- matching the wrong report key, and treating a gate's SKIP
# as a gate's failure.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PROBE="$REPO_ROOT/scripts/gate-language-probe.sh"
}

# @covers the probe exists and parses
@test "the probe script exists and is syntactically valid" {
  [ -f "$PROBE" ]
  run bash -n "$PROBE"
  [ "$status" -eq 0 ]
}

# @covers it can enumerate its own cases without running anything
@test "the probe lists its cases" {
  run bash "$PROBE" --list
  [ "$status" -eq 0 ]
  [[ "$output" == *"python_gate1"* ]]
  [[ "$output" == *"secret_gate8"* ]]
}

# @covers the contract is two-sided
#
# A probe that only requires "defective input is not PASS" passes a gate that
# blocks everything. One that only requires "clean input is not FAIL" passes a
# gate that blocks nothing. Both arms have to be present.
@test "every case has both a defect arm and a clean arm" {
  local n_defect n_clean
  n_defect=$(grep -c 'probe_defect ' "$PROBE" || true)
  n_clean=$(grep -c 'probe_clean ' "$PROBE" || true)
  [ "$n_defect" -ge 3 ]
  [ "$n_clean" -ge 3 ]
}

# @covers "not checked" is allowed to be SKIP but never PASS
#
# This is the repository's central invariant, and the probe encodes it: the
# forbidden outcome is PASS, not "anything but FAIL".
@test "the defect assertion forbids PASS, not merely non-FAIL" {
  run grep -n 'expect_not "$label not passed" "$st" "PASS"' "$PROBE"
  [ "$status" -eq 0 ]
  # And the clean arm must forbid FAIL rather than requiring PASS, so an honest
  # SKIP is not counted against a gate.
  run grep -n 'expect_not "clean input not refused" "$st" "FAIL"' "$PROBE"
  [ "$status" -eq 0 ]
}

# @covers report keys are matched by prefix, the mistake that made every python
# case read the console instead of the report
@test "report keys are matched on the gate-number prefix" {
  run grep -qF 'l.startsWith(want + "_")' "$PROBE"
  [ "$status" -eq 0 ]
}

# @covers a probe never writes the secret it tests with, because a literal PAT in
# this file made gate 8 block this repository's own commits twice
@test "the secret probe assembles its token at run time" {
  run grep -qE 'ghp_aB3dEfGh' "$PROBE"
  [ "$status" -ne 0 ]
  run grep -qE 'ghp_\$\(printf' "$PROBE"
  [ "$status" -eq 0 ]
}

# @covers no function is defined twice, which silently shadowed a fixed version
# for three rounds of debugging
@test "no probe function is defined more than once" {
  local name count
  for name in probe_defect probe_clean probe_secret_gate8 probe_python_gate1 probe_gate4_principles; do
    count=$(grep -c "^${name}() {" "$PROBE" || true)
    [ "$count" -eq 1 ] || { echo "$name defined $count times"; return 1; }
  done
}
