#!/usr/bin/env bats
# @test REQ-HOOK-G7 intent: gate-7 must find iac.sh through the SAME 3-tier
#         resolution every other adapter uses (global ~/.config/xp-gate/adapters
#         -> project githooks/adapters -> script dir). The old cwd-only test
#         `[ -f githooks/adapters/iac.sh ]` silently SKIPped IaC security in
#         every consumer repo without an in-repo githooks/ dir, even with the
#         adapter installed globally (e2e sweep 2026-10-17).
# @covers AC-HOOK-G7-01
# (Plain-bats style, matching the rest of this suite: no bats-assert dependency.)

setup() {
  sandbox="$(mktemp -d)"
  mkdir -p "$sandbox/repo" "$sandbox/global/adapters" "$sandbox/scriptdir"
  # Fake global install carrying ONLY the iac adapter.
  cat > "$sandbox/global/adapters/iac.sh" <<'ADAPTER'
run_static_analysis() { echo "fake checkov ran"; return 0; }
ADAPTER
  # Copy of the gate under test, plus the helpers it expects.
  cp "$BATS_TEST_DIRNAME/../gate-7.sh" "$sandbox/gate-7.sh"
  git -C "$sandbox/repo" init -q
  cd "$sandbox/repo" || exit 1
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || true
  rm -rf "$sandbox"
}

drive() {
  # shellcheck disable=SC2034
  (
    HOME="$sandbox/global-home"
    export HOME
    # The global tier must EXIST as a directory for adapter-common's tier
    # probe to consider it; the iac.sh symlink is created per-test so tests
    # can remove it.
    mkdir -p "$HOME/.config/xp-gate/adapters"
    [ -f "$sandbox/global/adapters/iac.sh" ] && ln -s "$sandbox/global/adapters/iac.sh" "$HOME/.config/xp-gate/adapters/iac.sh" 2>/dev/null
    gate_start_ms() { echo "0"; }
    record_gate_audit() { :; }
    GATE_DIR="$sandbox"
    source "$sandbox/gate-7.sh"
    echo "STATUS=$GATE_7_STATUS"
  )
}

@test "gate-7 finds iac.sh via the global tier when the repo has no githooks dir" {
  printf 'resource "x" "y" {}\n' > main.tf
  git add main.tf
  run drive
  [ "$status" -eq 0 ]
  [[ "$output" == *"fake checkov ran"* ]]
  [[ "$output" != *"IaC adapter not found"* ]]
  # Resolution audit line (r14 MAJ-02): tier that won must be visible.
  [[ "$output" == *"IaC adapter resolved from: $sandbox/global-home/.config/xp-gate/adapters/iac.sh"* ]]
  [[ "$output" == *"STATUS=PASS"* ]]
}

@test "gate-7 prefers the global tier over a project copy (route_to_adapter parity)" {
  # Both tiers present: order must match route_to_adapter() in
  # adapter-common.sh — global first (machine-wide single source of truth).
  mkdir -p githooks/adapters
  cat > githooks/adapters/iac.sh <<'ADAPTER'
run_static_analysis() { echo "project adapter ran"; return 0; }
ADAPTER
  printf 'resource "x" "y" {}\n' > main.tf
  git add main.tf
  run drive
  [ "$status" -eq 0 ]
  [[ "$output" == *"fake checkov ran"* ]]
  [[ "$output" != *"project adapter ran"* ]]
}

@test "gate-7 falls back to the project adapter when no global install exists" {
  # Tier order matches route_to_adapter() in adapter-common.sh: global tier
  # first (the machine-wide single source of truth), project githooks/adapters
  # second, script dir third. A repo copy is used only when no global install
  # carries iac.sh — same semantics as every other language adapter.
  rm "$sandbox/global/adapters/iac.sh"
  mkdir -p githooks/adapters
  cat > githooks/adapters/iac.sh <<'ADAPTER'
run_static_analysis() { echo "project adapter ran"; return 0; }
ADAPTER
  printf 'resource "x" "y" {}\n' > main.tf
  git add main.tf
  run drive
  [ "$status" -eq 0 ]
  [[ "$output" == *"project adapter ran"* ]]
  [[ "$output" != *"IaC adapter not found"* ]]
  [[ "$output" == *"STATUS=PASS"* ]]
}

@test "gate-7 reports not-found only when NO tier carries iac.sh" {
  rm "$sandbox/global/adapters/iac.sh"
  printf 'resource "x" "y" {}\n' > main.tf
  git add main.tf
  run drive
  [ "$status" -eq 0 ]
  [[ "$output" == *"IaC adapter not found"* ]]
  [[ "$output" == *"STATUS=SKIP"* ]]
}
