#!/usr/bin/env bats

# #717 AC-717-21: the BLOCKING matrix is asserted, not just documented.
#
# R1 round 11 (arch CI-01) pointed out that "covered" had been used to mean two
# different things: a gate that can reject a commit, and a gate that only
# reports. A user told "C# is gated" and then finding Gate 1 never blocks has
# been misled. These assertions pin which gates can actually stop a commit, so
# the doc cannot drift from the code in either direction.

setup() {
  REPO_ROOT="$BATS_TEST_DIRNAME/../.."
}

@test "#717 AC-717-21: Gate 3 blocks a commit (exit 1 in its script)" {
  run grep -E '^\s*exit 1' "$REPO_ROOT/githooks/adapters/gate-3.sh"
  [ "$status" -eq 0 ]
}

# #798: Gate 5's and Gate 13's blocking messages now live in
# gate-entries/gate-5-entry.sh and gate-13-entry.sh. These assertions ask "can
# this gate reject?", so they read the whole chain rather than pre-commit alone.
_gate_chain() {
  cat "$REPO_ROOT/githooks/pre-commit"       "$REPO_ROOT/githooks/gate-driver.sh"       "$REPO_ROOT"/githooks/gate-entries/*.sh 2>/dev/null
}

@test "#717 AC-717-21: Gate 4 blocks a commit (exit 1 in its script)" {
  run grep -E '^\s*exit 1' "$REPO_ROOT/githooks/adapters/gate-4.sh"
  [ "$status" -eq 0 ]
}

@test "#717 AC-717-21: Gate 5 blocks a non-TypeScript test failure" {
  # The non-TS adapter branch exits 1 on a non-zero run_tests status.
  run bash -c "_gate_chain() { cat \"$REPO_ROOT/githooks/pre-commit\" \"$REPO_ROOT/githooks/gate-driver.sh\" \"$REPO_ROOT\"/githooks/gate-entries/*.sh 2>/dev/null; }; _gate_chain | grep -F 'BLOCKED - Tests FAILED'"
  [ "$status" -eq 0 ]
}

@test "#717 AC-717-21: Gate 13 blocks on FAIL or BLOCK status" {
  run bash -c "_gate_chain() { cat \"$REPO_ROOT/githooks/pre-commit\" \"$REPO_ROOT/githooks/gate-driver.sh\" \"$REPO_ROOT\"/githooks/gate-entries/*.sh 2>/dev/null; }; _gate_chain | grep -F 'BLOCKED - Gate 13: Compiler Strictness'"
  [ "$status" -eq 0 ]
}

@test "#717 AC-717-21: Gate 1's generic adapter branch does NOT block" {
  # This is the honest half of the matrix. If someone later makes Gate 1 block
  # on the generic branch, the doc's claim becomes wrong and this fails.
  run bash -c "
    awk '/if \[ \"\$ANALYSIS_EXIT\" -eq 0 \] && \[ \"\$LINT_EXIT\" -eq 0 \]/,/^      ;;/' \
      '$REPO_ROOT/githooks/pre-commit' | grep -cE '^\s*exit 1'
  "
  [ "$output" -eq 0 ]
}

@test "#717 AC-717-21: the design doc's blocking matrix matches those facts" {
  local doc="$REPO_ROOT/docs/plans/2026-11-03-csharp-adapter-design.md"
  run grep -F "Which gates can actually REJECT" "$doc"
  [ "$status" -eq 0 ]
  # Gate 1 documented as unable to reject; Gates 3/4/5/13 able to.
  run grep -E '^\| 1 Code Quality \| \*\*No\*\*' "$doc"
  [ "$status" -eq 0 ]
  for g in 3 4 5 13; do
    run grep -E "^\| ${g} .*\*\*Yes" "$doc"
    [ "$status" -eq 0 ]
  done
}

@test "#717 AC-717-21: the onboarding limitation is documented" {
  local doc="$REPO_ROOT/docs/plans/2026-11-03-csharp-adapter-design.md"
  run grep -F "Onboarding limitation" "$doc"
  [ "$status" -eq 0 ]
  run grep -E 'hook-level supported|CLI-level onboarded' "$doc"
  [ "$status" -eq 0 ]
}
