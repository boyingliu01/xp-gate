#!/usr/bin/env bats
#
# @test REQ-GATE-12BC-REGISTRATION
# @intent Gates 12b (mirror parity) and 12c (probe discipline) have three
#         structural defects that make them look like enforcement without being
#         fully one:
#
#         1. NEITHER IS IN THE REGISTRY. Both are named in XP_GATE_ORDER and both
#            bodies run, but gate-registry.sh has rows only for 12 and 13. Every
#            tool that reads the registry therefore cannot see them:
#            `gate-list` and `gate-capability` omit them entirely, so a user has
#            no way to learn the mirror check exists, and `gate_enabled 12b`
#            resolves a number the registry never bound. The project's own rule
#            states the consequence: "an unregistered gate still runs ... the
#            registry row is what makes it real."
#
#         2. NEITHER WRITES AN AUDIT RECORD. Measured in .xp-gate/audit.jsonl:
#            gate-0/2/3/4/5/6/7/8/9/11/12/13 all appear, gate-12b and gate-12c
#            never do. They execute, they can block a commit, and they leave no
#            trace -- so "ran and passed", "was skipped", and "does not exist"
#            are the same thing to every consumer of the journal. That is the
#            exact defect family the githooks AGENTS.md says has recurred across
#            four gates.
#
#         3. GATE 12c'S FILE CARRIES GATE 13'S DESIGN COMMENT. Lines describing
#            the compiler-strictness gate (verdicts 0/1/2/3, XP_GATE_DISABLE_13,
#            XP_GATE_COMPILER_ANALYZER, the design doc link) sit inside
#            gate-12c-entry.sh and are absent from gate-13-entry.sh. It is dead
#            prose in the wrong file: the reasoning is invisible to whoever edits
#            Gate 13, which is where it belongs.
#
# @covers AC-GATE12BC-01 AC-GATE12BC-02 AC-GATE12BC-03
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  REGISTRY="$REPO_ROOT/githooks/gate-registry.sh"
  E12B="$REPO_ROOT/githooks/gate-entries/gate-12b-entry.sh"
  E12C="$REPO_ROOT/githooks/gate-entries/gate-12c-entry.sh"
  E13="$REPO_ROOT/githooks/gate-entries/gate-13-entry.sh"
}

@test "AC-GATE12BC-01: gate 12b has a registry row" {
  run grep -qE '"[a-z-]+\|12b\|' "$REGISTRY"
  [ "$status" -eq 0 ] || {
    echo "no registry row for gate 12b; gate-list and gate-capability cannot see it"
    return 1
  }
}

@test "AC-GATE12BC-01: gate 12c has a registry row" {
  run grep -qE '"[a-z-]+\|12c\|' "$REGISTRY"
  [ "$status" -eq 0 ] || {
    echo "no registry row for gate 12c; gate-list and gate-capability cannot see it"
    return 1
  }
}

@test "AC-GATE12BC-02: gate 12b records an audit line" {
  run grep -q 'record_gate_audit' "$E12B"
  [ "$status" -eq 0 ] || {
    echo "gate 12b never records its verdict; it is indistinguishable from a gate that does not exist"
    return 1
  }
}

@test "AC-GATE12BC-02: gate 12c records an audit line" {
  run grep -q 'record_gate_audit' "$E12C"
  [ "$status" -eq 0 ] || {
    echo "gate 12c never records its verdict; it is indistinguishable from a gate that does not exist"
    return 1
  }
}

@test "AC-GATE12BC-02: a gate that is skipped still records its verdict" {
  # The SKIP path is the one that historically went unrecorded -- prose says
  # "SKIPPED" while the journal keeps the previous value or nothing at all.
  run bash -c "
    cd '$REPO_ROOT' || exit 9
    # Collect every gate entry that has a gate_enabled/skip branch.
    for f in githooks/gate-entries/gate-*-entry.sh; do
      if grep -q 'not selected by XP_GATE_ONLY_GATE' \"\$f\"; then
        grep -q 'record_gate_audit' \"\$f\" || echo \"\$f\"
      fi
    done
  "
  [ -z "$output" ] || {
    echo "these gates print a skip reason but record nothing: $output"
    return 1
  }
}

@test "AC-GATE12BC-03: gate 13's design comment lives in gate 13's file" {
  # Anti-vacuity in both directions: the text must be ABSENT from 12c and
  # PRESENT in 13. Asserting only one half lets a deletion pass as a fix.
  run grep -q 'XP_GATE_COMPILER_ANALYZER' "$E12C"
  [ "$status" -ne 0 ] || {
    echo "gate 12c still carries gate 13's compiler-strictness documentation"
    return 1
  }
  run grep -q 'XP_GATE_COMPILER_ANALYZER' "$E13"
  [ "$status" -eq 0 ] || {
    echo "gate 13's own file does not document its escape hatches"
    return 1
  }
}