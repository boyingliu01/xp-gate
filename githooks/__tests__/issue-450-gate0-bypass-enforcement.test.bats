#!/usr/bin/env bats
# @test REQ-450
# @intent AC-450-01..03 anchor the bypass HINT text only, so the four things the
#         hint promises (first-line START, the marker, the chore:/docs:/release:
#         types, tooling-only paths) could drift away from what Gate 0 actually
#         enforces and every test would stay green while users follow a bypass
#         recipe that does not work (Round 2 architecture MA-01).
# @covers AC-450-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT_COPY="$REPO_ROOT/githooks/pre-commit"
  FIXTURE_REPO="$(mktemp -d)"
  (
    cd "$FIXTURE_REPO" || exit 1
    git init -q
    git config user.email test@test.com
    git config user.name Test
    git config core.hooksPath .git/hooks
    echo seed > README.md
    git add README.md
    git commit -q -m seed
  )
}

teardown() {
  rm -rf "$FIXTURE_REPO"
}

# The shipped enforcement block, taken out of the real hook at run time and
# evaluated against one commit message. A restructure that moves the block makes
# the extraction empty, which fails here rather than quietly testing nothing.
gate0_bypass_block() {
  awk '/# Check for bypass: commit message prefix/,/^      fi$/ {print}' "$PRE_COMMIT_COPY"
}

#   $1 message   $2 has_real_source ("true"/"false")
run_gate0_bypass() {
  (
    set -u
    cd "$FIXTURE_REPO" || exit 90
    printf '%s' "$1" > "$(git rev-parse --git-dir)/COMMIT_EDITMSG"
    has_real_source="$2"
    CURRENT_BRANCH="main"
    STAGED_FILES=$'githooks/adapters/typescript.sh\nsrc/app.ts'
    record_gate_audit() { :; }
    GATE_0_STATUS=""
    block=$(gate0_bypass_block)
    [ -n "$block" ] || { echo "EXTRACTION-EMPTY"; exit 91; }
    eval "$block"
    echo "VERDICT=PASS"
  )
}

@test "AC-450-04: a tooling-only chore: bypass is honoured by the enforcement, not only by the hint" {
  run run_gate0_bypass "[skip-version-check] chore: resync adapters" "false"
  [ "$status" -eq 0 ]
  [[ "$output" == *"bypass: chore/docs/release"* ]]
  [[ "$output" == *"VERDICT=PASS"* ]]
}

@test "AC-450-04: the same bypass still blocks production source files" {
  run run_gate0_bypass "[skip-version-check] chore: resync adapters" "true"
  [ "$status" -eq 1 ]
  [[ "$output" == *"bypass used but production source files detected"* ]]
}

@test "AC-450-04: an unlisted commit type is rejected, not ignored" {
  run run_gate0_bypass "[skip-version-check] feat: add thing" "false"
  [ "$status" -eq 1 ]
  [[ "$output" == *"bypass prefix invalid"* ]]
}

@test "AC-450-04: the marker counts only on the first line" {
  run run_gate0_bypass $"chore: resync adapters\n[skip-version-check] body line" "true"
  [ "$status" -eq 1 ]
  [[ "$output" == *"without VERSION/CHANGELOG update"* ]]
}

@test "AC-450-04 anti-vacuity: the extraction is the enforcement block itself" {
  block=$(gate0_bypass_block)
  [ "$(printf '%s\n' "$block" | wc -l)" -gt 10 ]
  printf '%s\n' "$block" | grep -q "exit 1"
  printf '%s\n' "$block" | grep -q "head -1"
  printf '%s\n' "$block" | grep -qE '\(chore:\|docs:\|release:\)'
}
