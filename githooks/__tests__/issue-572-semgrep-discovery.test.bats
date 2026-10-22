#!/usr/bin/env bats
# @test REQ-572
# @intent `gate-10.sh` located semgrep with `command -v semgrep` plus one
#         Unix-only fallback (`$HOME/.local/bin/semgrep`), and nothing else. On
#         Windows a `pip install --user semgrep` lands in
#         `%APPDATA%\Python\<ver>\Scripts\semgrep.exe`, which git-bash does NOT
#         inherit on PATH — so a working, installed semgrep read as "not
#         installed" and Gate 10 degraded to WARN on exactly the platform this
#         project is developed on.
#
#         That matters specifically because Gate 10 is the SAST gate. WARN is
#         better than a false PASS, but it never blocks, so a SAST gate that
#         silently cannot find its tool is the #499 hole one step milder. The
#         branch `fix/powershell-gates-fail-closed` carries this probe and it
#         exists nowhere else.
#
#         Why this test reads the detection block rather than running the gate:
#         measured, running the real gate against a staged `.ps1` file invokes
#         semgrep and takes minutes (and hits the network for rules). The
#         detection decision happens in the first ~40 lines and is pure shell, so
#         the test extracts that block and runs it in isolation — measuring the
#         actual branch taken instead of grepping for source text.
#
#         The probe must be by FILE EXISTENCE / EXIT CODE, never by parsing
#         `semgrep --version` output: a broken install can still print a
#         plausible version string.
# @covers AC-572-01, AC-572-02, AC-572-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE10="$REPO_ROOT/githooks/gate-10.sh"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/repo"
  cd "$WORK/repo" || return 1
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  echo "x" > README.md
  git add README.md
  git commit --no-verify -q -m seed
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$WORK"
}

# Extract the semgrep-detection block (from "Semgrep availability check" up to
# the line before the `if [ -z "$SEMGREP_CMD" ]` verdict) into its own script so
# it can be sourced and inspected without running the scan.
write_detection_probe() {
  local out="$WORK/detect.sh"
  awk '
    /^# Semgrep availability check/ { capture = 1 }
    capture && /^if \[ -z "\$SEMGREP_CMD" \]/ { exit }
    capture { print }
  ' "$GATE10" > "$out"
  # Report the decision, don't act on it.
  printf 'echo "SEMGREP_CMD=[${SEMGREP_CMD}]"\n' >> "$out"
  [ -s "$out" ] || {
    echo "could not extract the detection block from $GATE10"
    return 1
  }
  echo "$out"
}

# Build a PATH that keeps bash/coreutils/git but contains NO semgrep.
#
# Setting PATH=/usr/bin:/bin is not enough on this machine: a real semgrep is
# installed and `command -v semgrep` hits it, so the fallback branch is never
# reached and the test would silently measure nothing. Every PATH entry that
# resolves semgrep is dropped instead, so the rest of the environment stays real.
path_without_semgrep() {
  local entry result=""
  local IFS=':'
  for entry in $PATH; do
    [ -n "$entry" ] || continue
    if [ -x "$entry/semgrep" ] || [ -x "$entry/semgrep.exe" ]; then
      continue
    fi
    result="${result:+$result:}$entry"
  done
  printf '%s' "$result"
}

@test "AC-572-01: a pip --user semgrep under APPDATA is detected" {
  local probe
  probe=$(write_detection_probe) || return 1

  export HOME="$WORK/home"
  mkdir -p "$HOME/AppData/Roaming/Python/Python311/Scripts"
  printf '#!/bin/bash\nexit 0\n' > "$HOME/AppData/Roaming/Python/Python311/Scripts/semgrep.exe"
  chmod +x "$HOME/AppData/Roaming/Python/Python311/Scripts/semgrep.exe"

  export PATH="$(path_without_semgrep)"
  ! command -v semgrep >/dev/null 2>&1 || skip "semgrep still on PATH; cannot isolate the fallback"

  run bash "$probe"
  [ -n "$output" ]
  [[ "$output" == *"SEMGREP_CMD=["*"semgrep.exe]"* ]] || {
    echo "detection did not find the APPDATA pip --user install; got: $output"
    return 1
  }
}

@test "AC-572-02: an existing candidate that cannot execute is not accepted" {
  # Anti-vacuity for AC-572-01: "found" must mean "found and runnable". A file
  # at the fallback path that exits non-zero must not be handed forward as a
  # working semgrep -- otherwise the gate reaches semgrep, fails, and reports an
  # unparseable-output verdict instead of "not installed".
  local probe
  probe=$(write_detection_probe) || return 1

  export HOME="$WORK/home"
  mkdir -p "$HOME/AppData/Roaming/Python/Python311/Scripts"
  printf '#!/bin/bash\nexit 127\n' > "$HOME/AppData/Roaming/Python/Python311/Scripts/semgrep.exe"
  chmod +x "$HOME/AppData/Roaming/Python/Python311/Scripts/semgrep.exe"

  export PATH="$(path_without_semgrep)"
  ! command -v semgrep >/dev/null 2>&1 || skip "semgrep still on PATH; cannot isolate the fallback"

  run bash "$probe"
  [[ "$output" == *"SEMGREP_CMD=[]"* ]] || {
    echo "an unusable candidate was accepted as semgrep; got: $output"
    return 1
  }
}

@test "AC-572-03: with no semgrep anywhere the decision stays empty (gate then WARNs)" {
  # The existing contract, unchanged: an undetected semgrep leaves SEMGREP_CMD
  # empty and gate-10 below turns that into WARN + tool_not_installed -- never
  # a silent PASS.
  local probe
  probe=$(write_detection_probe) || return 1

  export HOME="$WORK/emptyhome"
  mkdir -p "$HOME"

  export PATH="$(path_without_semgrep)"
  ! command -v semgrep >/dev/null 2>&1 || skip "semgrep still on PATH; cannot isolate the fallback"

  run bash "$probe"
  [[ "$output" == *"SEMGREP_CMD=[]"* ]]

  # And the verdict below the block is WARN, not PASS.
  run grep -c 'GATE_10_STATUS="WARN"' "$GATE10"
  [ "$output" -ge 1 ]
}
