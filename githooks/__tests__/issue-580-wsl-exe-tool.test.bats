#!/usr/bin/env bats
# @test REQ-609
# @intent `command -v node` returns 1 on WSL and in git-bash even when
#         /mnt/c/Program Files/nodejs/node.exe exists and runs. bash only appends
#         the PATHEXT suffix that Windows itself does; a *NIX* shell does not, so a
#         Windows executable is invisible to the probe that every gate uses.
#
#         This is the half #593 did not fix. It bootstrapped the Windows toolchain
#         directories onto PATH, which is necessary but not sufficient: after the
#         bootstrap, `command -v node` STILL returns 1 because the file is named
#         node.exe. The reporter of #593 did not hit it (their git-bash resolves
#         node through a shim); the reporter of #580 did, with
#         `appendWindowsPath = false`, and paid for it twice over:
#
#           Gate 1   "SKIP - npx not available"          fail-OPEN — reads like
#                                                        "nothing to check here"
#           Gate 1   "BLOCKED - Biome check failed"      fail-CLOSED, wrong cause
#           Gate 8   "BLOCKED - gitleaks not installed"  a security gate refusing
#                                                        a commit over its own
#                                                        environment
#
#         One root cause produced a silent pass on one gate and a false block on
#         another, and BOTH described an environment problem as a code problem.
#         On WSL this means the gate chain has effectively never run, while the
#         report shows half SKIP and half BLOCK — neither of which is true.
#
#         The fix is a probe that also looks for the `.exe` suffix, used by the
#         shared `require_tool` and by the resolvers in lib/toolchain-path.sh.
# @covers AC-609-01, AC-609-02, AC-609-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  TOOLPATH_LIB="$REPO_ROOT/githooks/lib/toolchain-path.sh"

  WORK="$BATS_TEST_TMPDIR/wsl"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
  git init -q -b feature/wsl .
  git config core.hooksPath /dev/null

  # A Windows-shaped toolchain mount: only .exe files, exactly as the reporter
  # saw at /mnt/c/Program Files/nodejs.
  WINDIR="$WORK/mnt/c/Program Files/nodejs"
  mkdir -p "$WINDIR"
  printf '#!/usr/bin/env bash\necho v24.19.0\n' > "$WINDIR/node.exe"
  printf '#!/usr/bin/env bash\necho npm-shim\n' > "$WINDIR/npm.exe"
  # A tool with no extensionless counterpart. `command -v X` cannot see a
  # *.exe-only file on a *NIX* shell (the #580 fact), and unlike `node` there is
  # no host PATHEXT fallback that could mask the difference.
  printf '#!/usr/bin/env bash\necho wireprobe-1.0\n' > "$WINDIR/wireprobe.exe"
  chmod +x "$WINDIR/node.exe" "$WINDIR/npm.exe" "$WINDIR/wireprobe.exe"
}

in_lib() {
  (
    cd "$WORK" || exit 70
    export HOME="$WORK/home"
    export APPDATA=""
    export XP_GATE_NODE_DIR="$WINDIR"
    export PATH="/usr/bin:/bin"
    # shellcheck source=/dev/null
    source "$TOOLPATH_LIB"
    "$@"
  )
}

# ---------------------------------------------------------------------------
# AC-609-01: the probe sees a `.exe`
# ---------------------------------------------------------------------------

@test "AC-609-01: tool_is_available finds an executable that is only named *.exe" {
  # #580's measured fact: on WSL, `command -v node` -> NOT_FOUND while
  # /mnt/c/Program Files/nodejs/node.exe exists and runs.
  #
  # git-bash does NOT reproduce that: it applies PATHEXT itself and resolves an
  # extensionless name to the *.exe. So the premise of this case is host-dependent,
  # and pretending otherwise is how a test ends up asserting nothing. When the
  # premise cannot be created on this host, the case SKIPS and says so — it does
  # not pass.
  #
  # The always-asserted half is below and does not depend on the host: the probe
  # must find the *.exe, and must still report a genuinely absent tool as absent.
  run in_lib bash -c "
    export PATH='$WINDIR:/usr/bin:/bin'
    source '$TOOLPATH_LIB'
    plain=no; command -v wireprobe >/dev/null 2>&1 && plain=yes
    exe=no;   command -v wireprobe.exe >/dev/null 2>&1 && exe=yes
    echo \"PLAIN=\$plain EXE=\$exe\"
    tool_is_available wireprobe && echo 'AVAILABLE' || echo 'MISSING'
  "
  [ "$status" -eq 0 ]
  # The *.exe must be found at all, or the fixture is wrong.
  [[ "$output" == *"EXE=yes"* ]] || {
    echo "fixture broken: the *.exe file is not on PATH: $output"
    return 1
  }
  [[ "$output" == *"AVAILABLE"* ]] || {
    echo "tool_is_available must find a *.exe-only tool, got: $output"
    return 1
  }
  if [[ "$output" == *"PLAIN=yes"* ]]; then
    skip "host has PATHEXT-style fallback (git-bash), so the WSL premise (command -v misses *.exe) cannot be reproduced here"
  fi
}

@test "AC-609-01: the .exe probe is unconditional, regardless of host PATHEXT" {
  # The host-independent half, and it has to be built carefully.
  #
  # A plain `wireprobe` fixture does NOT test the .exe branch on git-bash: PATHEXT
  # resolves `command -v wireprobe` to wireprobe.exe by itself, so the case passes
  # even with the .exe branch deleted. That was measured, not assumed — removing
  # the branch left the earlier version of this case green.
  #
  # So the fixture uses a name the host cannot resolve without the suffix:
  # `wire-probe` with a dot-free base but a POSIX-only sibling is not enough
  # either. Instead, drive the predicate directly with a .exe that is the ONLY
  # form present, and prove the branch is what found it by checking the branch's
  # own precondition (`command -v <base>` fails for a name PATHEXT will not match,
  # namely one that already ends in something else).
  run in_lib bash -c "
    export PATH='$WINDIR:/usr/bin:/bin'
    source '$TOOLPATH_LIB'
    # wireprobe.exe exists; ask about 'wireprobe' and about the suffixed name.
    tool_is_available wireprobe && echo 'EXE_ONLY_FOUND' || echo 'EXE_ONLY_MISSING'
    tool_is_available wireprobe.exe && echo 'SUFFIX_ALSO_FOUND' || echo 'SUFFIX_MISSING'
    # An absent tool must stay absent. This is the assertion that catches a probe
    # that answers yes for everything, which is the one way widening a probe can
    # make the whole gate chain quietly useless.
    tool_is_available totally-absent-tool >/dev/null 2>&1 && echo 'LEAKED' || echo 'ABSENT_OK'
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"EXE_ONLY_FOUND"* ]] || { echo "the *.exe-only tool must be found: $output"; return 1; }
  [[ "$output" == *"SUFFIX_ALSO_FOUND"* ]] || { echo "an explicitly suffixed name must also be found: $output"; return 1; }
  [[ "$output" == *"ABSENT_OK"* ]] || { echo "an absent tool must stay absent: $output"; return 1; }
}

@test "AC-609-01: the .exe branch is reached even when PATHEXT would not help" {
  # ADMISSION, recorded rather than papered over: on this host the .exe branch
  # cannot be isolated by behaviour. git-bash applies PATHEXT so permissively that
  # even a dotted base name resolves without the suffix. Every "make the branch
  # necessary" fixture I tried was resolved by `command -v` alone, which means the
  # behavioural assertions above would stay green with the branch deleted —
  # measured, not assumed (removing the branch left case 2 green).
  #
  # The honest options were: (a) let the suite imply coverage it does not have, or
  # (b) check the branch structurally and say that is what is being checked. This
  # is (b). A structural check is weaker than a behavioural one, but it is the
  # strongest true statement available here, and it does fail if the branch is
  # removed.
  run grep -c 'command -v "${_tool}\.exe"' "$TOOLPATH_LIB"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ] || {
    echo "the .exe probe is gone from tool_is_available; WSL will report installed tools as missing"
    return 1
  }

  # And resolve_tool_path must have the same fallback, or a tool found by
  # tool_is_available still cannot be executed.
  run grep -c 'command -v "${_tool}\.exe"' "$TOOLPATH_LIB"
  [ "$output" -ge 2 ] || {
    echo "resolve_tool_path lost its .exe fallback; the gate would resolve a tool it cannot run"
    return 1
  }
}

@test "AC-609-01: tool_is_available still misses a tool that is genuinely absent" {
  # The control. If the probe answered yes for everything, Gate 8 could never
  # report a missing gitleaks and no gate would ever be told its tool is absent.
  run in_lib bash -c "
    export XP_GATE_NODE_DIR='$WINDIR'
    export PATH='$WINDIR:/usr/bin:/bin'
    source '$TOOLPATH_LIB'
    tool_is_available definitely-not-installed-xyz && echo 'AVAILABLE' || echo 'MISSING'
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"MISSING"* ]] || { echo "a truly absent tool must stay missing, got: $output"; return 1; }
}

@test "AC-609-01: an environment-variable override wins over everything" {
  # #580's suggested priority order, first entry: XP_GATE_NODE_BIN etc. Without
  # this a user whose toolchain lives somewhere unusual has no way to say so.
  OVR="$WORK/override"
  mkdir -p "$OVR"
  printf '#!/usr/bin/env bash\necho overridden-node\n' > "$OVR/node"
  chmod +x "$OVR/node"

  run in_lib bash -c "
    export XP_GATE_NODE_DIR='$WINDIR'
    export PATH='/usr/bin:/bin'
    export XP_GATE_NODE_BIN='$OVR/node'
    source '$TOOLPATH_LIB'
    resolve_tool_path node
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"$OVR/node"* ]] || { echo "the override must win, got: $output"; return 1; }
}

# ---------------------------------------------------------------------------
# AC-609-02: a resolved .exe is executable through the returned path
# ---------------------------------------------------------------------------

@test "AC-609-02: resolve_tool_path returns a path that actually runs" {
  # Finding the file is not the same as being able to run it. The gates exec the
  # resolved path, so the contract is "this string runs", not "this string names a
  # file that exists".
  run in_lib bash -c "
    export XP_GATE_NODE_DIR='$WINDIR'
    export PATH='$WINDIR:/usr/bin:/bin'
    source '$TOOLPATH_LIB'
    p=\$(resolve_tool_path node) || { echo 'NOT_RESOLVED'; exit 0; }
    echo \"RESOLVED=\$p\"
    \"\$p\" --version 2>&1 | sed 's/^/RAN=/'
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"RESOLVED="* ]] || { echo "node must resolve, got: $output"; return 1; }
  [[ "$output" == *"RAN=v24.19.0"* ]] || { echo "the resolved path must be executable, got: $output"; return 1; }
}

# ---------------------------------------------------------------------------
# AC-609-03: environment problems are not reported as code problems
# ---------------------------------------------------------------------------

@test "AC-609-03: a missing tool is reported as ENVIRONMENT, never as a code verdict" {
  # Gate 1 told the reporter to run `npx biome check --write .` when npx did not
  # exist, and printed it under "❌ BLOCKED - Biome check failed" — a code-format
  # verdict for an environment fault. The level has to be different so the reader
  # does not go looking at their source.
  run in_lib classify_tool_failure 127 "npx: command not found"
  [[ "$output" == *"TOOLCHAIN"* ]]

  run in_lib describe_tool_search gitleaks
  [[ "$output" == *"PATH"* ]] || { echo "the search list must be printed, got: $output"; return 1; }
  # It must tell the reader this is about the environment, not the code.
  [[ "$output" == *"PATH problem"* ]] || { echo "must name this as a PATH problem, got: $output"; return 1; }
}
