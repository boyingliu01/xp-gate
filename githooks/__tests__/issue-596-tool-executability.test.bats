#!/usr/bin/env bats
# @test REQ-611
# @intent `require_tool` decided a tool was available with `command -v` alone. That
#         answers "is there a file on PATH with this name" — NOT "can this tool
#         run". The two disagree in exactly the environments gates run in:

#           * a pip/npm POSIX shim whose shebang line execs `python` / `node`, on a
#             shell where that interpreter is not resolvable. `command -v checkov`
#             succeeds; running it dies at the `exec` (#596, #536, #593 — the third
#             time this class has been reported).
#           * a .exe whose interpreter is likewise unreachable (#580).
#
#         The consequence is the worst possible one for a security gate: Gate 7
#         counted zero usable scanners and BLOCKED the commit on a repository where
#         checkov 3.3.30 was installed and worked. Reported as "no scanning tools
#         available" when the tool was there — an environment fault wearing a code
#         verdict's clothes.
#
#         `command -v` is also not reproducible across hosts (git-bash applies
#         PATHEXT itself; WSL does not), so a test cannot assert the divergence
#         directly. What it CAN pin is the contract: presence is not executability,
#         and the two outcomes must be distinguishable.
# @covers AC-611-01, AC-611-02, AC-611-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  TOOLPATH_LIB="$REPO_ROOT/githooks/lib/toolchain-path.sh"
  WORK="$BATS_TEST_TMPDIR/probe"
  mkdir -p "$WORK/bin"
  cd "$WORK" || return 1
}

in_lib() {
  (
    cd "$WORK" || exit 70
    export HOME="$WORK/home"
    export APPDATA=""
    export XP_GATE_NODE_DIR=""
    export PATH="$WORK/bin:/usr/bin:/bin"
    # shellcheck source=/dev/null
    source "$TOOLPATH_LIB"
    "$@"
  )
}

# ---------------------------------------------------------------------------
# AC-611-01: a tool that exists but cannot run is NOT available
# ---------------------------------------------------------------------------

@test "AC-611-01: a shim whose interpreter is missing is not reported available" {
  # The #596 shape: /d/npm/checkov is `#!/bin/sh` + `exec python ...`, and on that
  # machine `python` was not on the hook's PATH. The file is present, executable,
  # and `command -v` finds it — and running it exits 127.
  cat > "$WORK/bin/brokencheckov" <<'SH'
#!/bin/sh
exec definitely-no-such-interpreter-xyz "$@"
SH
  chmod +x "$WORK/bin/brokencheckov"

  # The premise, asserted so this case cannot silently stop testing anything.
  run in_lib bash -c "command -v brokencheckov >/dev/null 2>&1 && echo FOUND || echo NOTFOUND"
  [[ "$output" == *"FOUND"* ]] || { echo "premise broken: command -v does not find the shim"; return 1; }

  run in_lib tool_is_available brokencheckov
  [ "$status" -ne 0 ] || {
    echo "a shim that cannot execute must not be reported available (this is what BLOCKed a good commit)"
    return 1
  }
}

@test "AC-611-01: a tool that runs is still reported available" {
  # The control. If the probe rejected everything, every gate would degrade to
  # SKIP and the chain would pass by doing nothing.
  cat > "$WORK/bin/goodtool" <<'SH'
#!/bin/sh
echo 1.2.3
SH
  chmod +x "$WORK/bin/goodtool"

  run in_lib tool_is_available goodtool
  [ "$status" -eq 0 ] || { echo "a working tool must stay available"; return 1; }
}

@test "AC-611-01: presence and executability are reported as different states" {
  # The point of the issue, made explicit: "found but cannot run" has to be its own
  # answer. Collapsing it into "not installed" is what sent the reporter to
  # reinstall a tool that was already installed.
  cat > "$WORK/bin/shimtool" <<'SH'
#!/bin/sh
exec definitely-no-such-interpreter-xyz "$@"
SH
  chmod +x "$WORK/bin/shimtool"

  run in_lib classify_tool_failure 127 "shimtool: exec: definitely-no-such-interpreter-xyz: not found"
  [[ "$output" == *"TOOLCHAIN"* ]] || { echo "exit 127 must classify as TOOLCHAIN, got: $output"; return 1; }
}

# ---------------------------------------------------------------------------
# AC-611-02: a TOOLCHAIN failure must not be reported as a finding
# ---------------------------------------------------------------------------

@test "AC-611-02: an unusable scanner does not produce a code verdict" {
  # Gate 7's message was "❌ BLOCKED - IaC security issues detected" for a run in
  # which NO scanner executed. That sentence is false: nothing was detected. The
  # classification must separate "the scan found something" from "the scan could not
  # happen", and a gate that delegated to `require_tool` must be able to tell.
  run in_lib classify_tool_failure 127 "exec: python: not found"
  [[ "$output" == *"TOOLCHAIN"* ]] || { echo "missing-interpreter failure must be TOOLCHAIN, got: $output"; return 1; }

  # And the other direction must stay: a genuine finding is NOT excused.
  run in_lib classify_tool_failure 1 "CKV_AWS_20: S3 bucket has public ACL"
  [[ "$output" == *"FINDING"* ]] || { echo "a real finding must stay a FINDING, got: $output"; return 1; }
}

@test "AC-611-03: ORIGINAL_PATH is honoured when the hook shell shrank PATH" {
  # #596 point 2: in a hook shell $PATH had 7 entries while ORIGINAL_PATH carried the
  # full Windows PATH (3002 chars), and the tool lived only in the latter. Any
  # probe that only reads $PATH — or only guesses standard install dirs, as #593's
  # bootstrap does — misses a custom prefix.
  #
  # ORIGINAL_PATH may be unset on a *NIX host, so the assertion is conditional on it
  # being set: when it exists it must be consulted, and a tool found only through it
  # must be found.
  local custom="$WORK/customtools"
  mkdir -p "$custom"
  cat > "$custom/originalpath-tool" <<'SH'
#!/bin/sh
echo from-original-path
SH
  chmod +x "$custom/originalpath-tool"

  run in_lib bash -c "
    export PATH='$WORK/bin:/usr/bin:/bin'
    export ORIGINAL_PATH='$custom'
    source '$TOOLPATH_LIB'
    tool_is_available originalpath-tool && echo 'FOUND' || echo 'MISSING'
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"FOUND"* ]] || {
    echo "a tool reachable only through ORIGINAL_PATH must still be found, got: $output"
    return 1
  }
}
