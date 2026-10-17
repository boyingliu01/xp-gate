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
  [[ "$output" == *"STATUS=PASS"* ]]
}

@test "gate-7 still prefers the project-local adapter when present" {
  # Project tier wins ONLY when no global install exists — matching
  # adapter-common.sh, whose first probe is the global dir (global = the
  # machine-wide single source of truth; a repo copy must not shadow it).
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
