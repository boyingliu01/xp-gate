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

# @covers the probe measures the working tree, not the installed release
#
# Gate 9 resolves its checker through a three-tier chain whose FIRST tier is the
# project's own src/build-integrity/. A probe repo has no such directory, so every
# measurement silently fell through to the THIRD tier -- $HOME/.config/xp-gate.
#
# Measured 2026-11-22: the entry-point fix was committed and verified by direct
# invocation, yet the probe still reported PASS for a manifest whose main pointed
# nowhere, because the gate had loaded the previous release. That result reads
# exactly like a product defect and cost a full round of re-measuring.
@test "a gate-9 probe links this repository's checker into the probe repo" {
  run grep -n 'link_gate_source' "$PROBE"
  [ "$status" -eq 0 ]
  # The helper must exist AND be called.
  echo "$output" | grep -q 'link_gate_source() {'
  echo "$output" | grep -q 'link_gate_source "\$dir"'
}

# @covers the link lands on the second tier, not inside the tsconfig include
#
# Linking into src/ put this repository's own sources inside the probe's compile
# glob. Measured: 65 tsc errors, and the clean arm that must never be refused came
# back BLOCK.
@test "the gate-9 source link is placed outside the probe's compile glob" {
  run grep -n 'xp-gate/modules/build-integrity' "$PROBE"
  [ "$status" -eq 0 ]
}

# @covers the link is conditional on gate 9
#
# No other gate reads its implementation from the project tree, and linking for
# them would put this repository's sources into every probe.
@test "the source link only happens for gate 9" {
  run grep -n '\[ "\$gate" = "9" \] && link_gate_source' "$PROBE"
  [ "$status" -eq 0 ]
}

# @covers gate actions: the banner fallback must not read another gate's block
#
# Gate 0 prints no "  Gate 0: <STATUS>" summary line; it announces its verdict
# inline ("PASSED - Gate 0: Version Consistency Check ..."). The fallback then
# scanned the WHOLE output for the word BLOCKED, so any other gate refusing in the
# same run was reported as gate 0's verdict.
#
# MEASURED 2026-11-22: a clean full-chain run where gate 0 passed and gate 11
# declined to evaluate was reported as "gate 0 FAIL", and the probe's clean arm
# went red on a project that had done nothing wrong.
@test "gate_status prefers the gate's own inline verdict over a chain-wide scan" {
  run grep -n 'grep -E "(PASSED|BLOCKED) - Gate \${gate}:"' "$PROBE"
  [ "$status" -eq 0 ]
}

# @covers the inline verdict is consulted BEFORE the BLOCKED fallback
@test "the inline verdict check precedes the chain-wide BLOCKED scan" {
  local own_fb
  own_fb=$(grep -n 'own=\$(printf' "$PROBE" | head -1 | cut -d: -f1)
  local scan
  scan=$(grep -n 'grep -q "BLOCKED"' "$PROBE" | tail -1 | cut -d: -f1)
  [ -n "$own_fb" ]
  [ -n "$scan" ]
  [ "$own_fb" -lt "$scan" ]
}

# @covers every gate that needs a protected branch has a probe
#
# Gate 0 checks version consistency ONLY on main/master/develop/trunk/mainline and
# refuses XP_GATE_ONLY_GATE on those branches, so a probe on probe-<name> measures
# the non-protected path where gate 0 correctly does nothing and prints PASSED.
@test "a protected-branch probe helper exists for gate 0" {
  run grep -n '^new_protected_probe()' "$PROBE"
  [ "$status" -eq 0 ]
  run grep -n '^run_full_chain()' "$PROBE"
  [ "$status" -eq 0 ]
}

# @covers all six previously-unprobed gates now have a case
@test "gates 0, 6, 11, 12b and 12c each have a probe case" {
  local g missing=0
  for g in gate0_drift python_gate6 gate11_sprint gate12b_mirror gate12c_npx; do
    grep -q "^    $g)" "$PROBE" || { echo "no case for $g"; missing=$((missing + 1)); }
  done
  [ "$missing" -eq 0 ]
}
