#!/usr/bin/env bats

# install-delphi-review.sh platform argument contract (#414 R3 FC-03/FC-04).
#
# The --platform override was added for dual-install machines; its parsing is
# a small sentinel state machine whose failure modes are exactly the kind of
# thing that regresses silently:
#   - a dangling `--platform` must ERROR, not fall back to auto-detection
#   - `--platform qoder` / `--platform opencode` must reach the right
#     destination (the `qoder|opencode)` case branch precedes `*)`)
#
# Runs the real script against a sandboxed HOME so nothing touches the
# developer machine. The project-level .delphi-config.json skip keeps the
# repo root untouched when bats runs from there.

setup() {
  ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  TEST_HOME="$(mktemp -d)"
  export HOME="$TEST_HOME"
  TEST_CWD="$(mktemp -d)"
  cd "$TEST_CWD"
}

teardown() {
  cd /
  rm -rf "$TEST_HOME" "$TEST_CWD"
}

@test "--platform with a dangling value errors instead of silently detecting" {
  run bash "$ROOT/scripts/install-delphi-review.sh" --platform
  [ "$status" -eq 1 ]
  [[ "$output" == *"--platform requires a value"* ]]
}

@test "--platform followed by an unrelated flag errors instead of ignoring it" {
  run bash "$ROOT/scripts/install-delphi-review.sh" --platform --force
  [ "$status" -eq 1 ]
  [[ "$output" == *"--platform requires a value"* ]]
}

@test "--platform qoder installs the skill into HOME/.qoder/skills" {
  run bash "$ROOT/scripts/install-delphi-review.sh" --platform qoder
  [ "$status" -eq 0 ]
  [ -f "$TEST_HOME/.qoder/skills/delphi-review/SKILL.md" ]
  [ -f "$TEST_HOME/.qoder/skills/delphi-review/.delphi-config.json.example" ]
}

@test "--platform opencode installs into HOME/.config/opencode/skills" {
  run bash "$ROOT/scripts/install-delphi-review.sh" --platform opencode
  [ "$status" -eq 0 ]
  [ -f "$TEST_HOME/.config/opencode/skills/delphi-review/SKILL.md" ]
  [ ! -e "$TEST_HOME/.qoder/skills/delphi-review/SKILL.md" ]
}

@test "auto-detection still works when --platform is not given" {
  mkdir -p "$TEST_HOME/.qoder"
  run bash "$ROOT/scripts/install-delphi-review.sh"
  [ "$status" -eq 0 ]
  [ -f "$TEST_HOME/.qoder/skills/delphi-review/SKILL.md" ]
}
