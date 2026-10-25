#!/usr/bin/env bats
# @test REQ-607
# @intent On Windows the hook runs under git-bash, which does not see the
#         toolchains the caller installed. Four gates each reported "tool not
#         installed" for tools that were installed, and two of those reports were
#         FALSE GREENS.
#
#         The paths below are all standard and all invisible to git-bash's default
#         PATH: %APPDATA%\npm (npm global CLIs), the node install dir, pip
#         --user's %APPDATA%\Python\PythonNNN\Scripts, ~/.local/bin, ~/bin.
#
#         The two categories of damage are not the same severity:
#
#           false RED   (Gate 6 archlint, Gate 2 jscpd in a subproject) -- the
#                       natural response is to install a tool that is already
#                       there, or to touch code that is fine
#           false GREEN (Gate 10 semgrep at ~/bin, Gate 11 sprint state) -- a
#                       gate that never ran is reported as a WARN that reads like
#                       "optional tool missing". On a PowerShell repo Gate 10 is
#                       the ONLY SAST that ever looks at a .ps1, so this is the
#                       difference between scanning and not scanning.
#
#         Worst of all is the exit-127 case: the npm POSIX shim resolved and then
#         died with `exec: node: not found`, and Gate 6 printed
#             ❌ BLOCKED - Architecture violations detected
#         A broken toolchain reported as a code defect, pointing the reader at
#         code that is fine.
#
#         Two structural fixes, both in the shared layer rather than in each
#         individual gate:
#
#           1. one toolchain PATH bootstrap at hook startup, APPENDING (never
#              prepending) so the caller's PATH order is still authoritative;
#           2. probes for the shapes `command -v` cannot see -- subproject
#              node_modules/.bin, globbed Python Scripts dirs, and the wrapper's
#              own directory (semgrep execs the sibling pysemgrep).
#
#         And an honest message: when a tool cannot be resolved, say WHERE was
#         searched. "not installed" and "installed but not found" need different
#         fixes and the old message could not tell them apart.
# @covers AC-607-01, AC-607-02, AC-607-03, AC-607-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  TOOLPATH_LIB="$REPO_ROOT/githooks/lib/toolchain-path.sh"

  WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
  git init -q -b feature/tools .
  git config core.hooksPath /dev/null

  # A fake Windows-shaped filesystem. Nothing here is on the real PATH.
  APPDATA="$WORK/appdata"
  HOME_DIR="$WORK/home"
  mkdir -p "$APPDATA/npm" "$HOME_DIR/bin" "$HOME_DIR/.local/bin"
  NODE_DIR="$WORK/nodejs"
  mkdir -p "$NODE_DIR"

  # An installed tool at each standard location, each printing a marker.
  printf '#!/usr/bin/env bash\necho archlint-1.0\n' > "$APPDATA/npm/archlint"
  printf '#!/usr/bin/env bash\necho from-home-bin\n' > "$HOME_DIR/bin/semgrep"
  printf '#!/usr/bin/env bash\necho from-local-bin\n' > "$HOME_DIR/.local/bin/thing"
  mkdir -p "$APPDATA/Python/Python312/Scripts"
  printf '#!/usr/bin/env bash\necho pysemgrep-1.0\n' > "$APPDATA/Python/Python312/Scripts/pysemgrep"
  chmod +x "$APPDATA/npm/archlint" "$HOME_DIR/bin/semgrep" \
    "$HOME_DIR/.local/bin/thing" "$APPDATA/Python/Python312/Scripts/pysemgrep"
}

# Source the library with the fixture's HOME/APPDATA and a PATH that contains
# ONLY the basics, reproducing "the hook cannot see the toolchain".
in_lib() {
  (
    cd "$WORK" || exit 70
    export HOME="$HOME_DIR"
    export APPDATA
    export XP_GATE_NODE_DIR="$NODE_DIR"
    export PATH="/usr/bin:/bin"
    # shellcheck source=/dev/null
    source "$TOOLPATH_LIB"
    "$@"
  )
}

# ---------------------------------------------------------------------------
# AC-607-01: the bootstrap appends the standard locations
# ---------------------------------------------------------------------------

@test "AC-607-01: bootstrap_toolchain_path appends the standard tool locations" {
  run in_lib bash -c "
    export HOME='$HOME_DIR' APPDATA='$APPDATA' XP_GATE_NODE_DIR='$NODE_DIR'
    export PATH='/usr/bin:/bin'
    source '$TOOLPATH_LIB'
    bootstrap_toolchain_path
    printf '%s\n' \"\$PATH\"
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"$APPDATA/npm"* ]] || { echo "npm global dir missing from PATH"; return 1; }
  [[ "$output" == *"$HOME_DIR/bin"* ]] || { echo "~/bin missing from PATH"; return 1; }
  [[ "$output" == *"$HOME_DIR/.local/bin"* ]] || { echo "~/.local/bin missing from PATH"; return 1; }
  [[ "$output" == *"$NODE_DIR"* ]] || { echo "node dir missing from PATH"; return 1; }
}

@test "AC-607-01: the bootstrap APPENDS, so the caller's PATH order still wins" {
  # Prepending would silently override a project-pinned tool with a global one.
  run in_lib bash -c "
    export HOME='$HOME_DIR' APPDATA='$APPDATA' XP_GATE_NODE_DIR='$NODE_DIR'
    export PATH='/usr/bin:/bin'
    source '$TOOLPATH_LIB'
    bootstrap_toolchain_path
    printf '%s\n' \"\$PATH\"
  "
  [ "$status" -eq 0 ]
  case "$output" in
    /usr/bin:/bin:*) ;;
    *) echo "the caller's PATH must stay first, got: $output"; return 1 ;;
  esac
}

@test "AC-607-01: after the bootstrap, a tool at %APPDATA%/npm is findable" {
  run in_lib bash -c "
    export HOME='$HOME_DIR' APPDATA='$APPDATA' XP_GATE_NODE_DIR='$NODE_DIR'
    export PATH='/usr/bin:/bin'
    source '$TOOLPATH_LIB'
    bootstrap_toolchain_path
    command -v archlint && archlint
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"archlint-1.0"* ]] || { echo "archlint must now resolve and run, got: $output"; return 1; }
}

@test "AC-607-01: the Python Scripts dir is globbed, not guessed at a version" {
  run in_lib bash -c "
    export HOME='$HOME_DIR' APPDATA='$APPDATA' XP_GATE_NODE_DIR='$NODE_DIR'
    export PATH='/usr/bin:/bin'
    source '$TOOLPATH_LIB'
    bootstrap_toolchain_path
    command -v pysemgrep && pysemgrep
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"pysemgrep-1.0"* ]] || { echo "globbed Python312 Scripts dir not on PATH, got: $output"; return 1; }
}

@test "AC-607-01: the bootstrap is idempotent" {
  # The hook may source the library more than once; PATH must not grow each time.
  run in_lib bash -c "
    export HOME='$HOME_DIR' APPDATA='$APPDATA' XP_GATE_NODE_DIR='$NODE_DIR'
    export PATH='/usr/bin:/bin'
    source '$TOOLPATH_LIB'
    bootstrap_toolchain_path
    first=\"\$PATH\"
    # Guard against the vacuous pass: if the first call changed nothing, 'PATH is
    # unchanged on the second call' proves nothing at all.
    [ \"\$first\" != '/usr/bin:/bin' ] || { echo NOTHING_ADDED; exit 0; }
    bootstrap_toolchain_path
    [ \"\$PATH\" = \"\$first\" ] && echo SAME || echo DIFFERENT
  "
  [ "$status" -eq 0 ]
  [[ "$output" != *"NOTHING_ADDED"* ]] || { echo "the first bootstrap added nothing, so idempotence is untested"; return 1; }
  [[ "$output" == *"SAME"* ]] || { echo "bootstrapping twice changed PATH"; return 1; }
}

# ---------------------------------------------------------------------------
# AC-607-02: shapes command -v cannot see
# ---------------------------------------------------------------------------

@test "AC-607-02: a subproject node_modules/.bin tool is resolved" {
  # Gate 2 in a monorepo: jscpd is a devDependency of ui/, so it lives in
  # ui/node_modules/.bin and `npx` run from the repo root cannot see it.
  mkdir -p ui/node_modules/.bin
  printf '#!/usr/bin/env bash\necho jscpd-5.2.0\n' > ui/node_modules/.bin/jscpd
  chmod +x ui/node_modules/.bin/jscpd

  run in_lib bash -c "
    cd '$WORK'
    export HOME='$HOME_DIR' APPDATA='$APPDATA' XP_GATE_NODE_DIR='$NODE_DIR'
    export PATH='/usr/bin:/bin'
    source '$TOOLPATH_LIB'
    resolve_tool_path jscpd
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"ui/node_modules/.bin/jscpd"* ]] || {
    echo "a subproject node_modules/.bin tool must be found, got: $output"
    return 1
  }
}

@test "AC-607-02: resolving a wrapper puts its own directory on PATH" {
  # semgrep(.exe) execs the sibling pysemgrep. Resolving the wrapper is not
  # enough — without its directory on PATH the wrapper dies with
  # "executing pysemgrep failed".
  #
  # Called WITHOUT command substitution on purpose: $(...) runs in a subshell and
  # would discard the PATH change. That is the trap this library documents.
  run in_lib bash -c "
    export HOME='$HOME_DIR' APPDATA='$APPDATA' XP_GATE_NODE_DIR='$NODE_DIR'
    export PATH='/usr/bin:/bin'
    source '$TOOLPATH_LIB'
    ensure_tool_dir_on_path semgrep || { echo 'RESOLVE_FAILED'; exit 0; }
    case \":\$PATH:\" in
      *':$HOME_DIR/bin:'*) echo 'ON_PATH' ;;
      *) echo \"NOT_ON_PATH:\$PATH\" ;;
    esac
    command -v semgrep >/dev/null 2>&1 && echo 'FINDABLE' || echo 'NOT_FINDABLE'
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"ON_PATH"* ]] || { echo "the wrapper's directory must be on PATH, got: $output"; return 1; }
  [[ "$output" == *"FINDABLE"* ]] || { echo "after ensure_tool_dir_on_path the tool must resolve, got: $output"; return 1; }
}

# ---------------------------------------------------------------------------
# AC-607-03: an unresolvable tool says WHERE it looked
# ---------------------------------------------------------------------------

@test "AC-607-03: a missing tool reports every location searched" {
  # "not installed" and "installed but not found" need different fixes. The old
  # message said only the first.
  run in_lib bash -c "
    export HOME='$HOME_DIR' APPDATA='$APPDATA' XP_GATE_NODE_DIR='$NODE_DIR'
    export PATH='/usr/bin:/bin'
    source '$TOOLPATH_LIB'
    describe_tool_search not-a-real-tool-xyz
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"PATH"* ]] || { echo "the search list must include PATH, got: $output"; return 1; }
  [[ "$output" == *"npm"* ]] || { echo "the search list must include the npm global dir, got: $output"; return 1; }
  [[ "$output" == *"node_modules"* ]] || { echo "the search list must include subproject node_modules, got: $output"; return 1; }
}

# ---------------------------------------------------------------------------
# AC-607-04: a broken shim is a toolchain problem, never a code defect
# ---------------------------------------------------------------------------

@test "AC-607-04: exit 127 from a tool's own shim is classified as a toolchain failure" {
  # The exact Gate 6 shape: shim resolves, then `exec: node: not found`.
  run in_lib classify_tool_failure 127 "C:\Users\x\AppData\Roaming/npm/archlint: line 15: exec: node: not found"
  [ "$status" -eq 0 ]
  [[ "$output" == *"TOOLCHAIN"* ]] || {
    echo "exit 127 with an exec failure must classify as TOOLCHAIN, got: $output"
    return 1
  }
}

@test "AC-607-04: a genuine finding is NOT reclassified as a toolchain failure" {
  # The control. If everything looked like a toolchain problem, Gate 6 could never
  # block on a real architecture violation again — a far worse defect than #593.
  run in_lib classify_tool_failure 1 "archlint: 2 architecture violations detected"
  [ "$status" -eq 0 ]
  [[ "$output" == *"FINDING"* ]] || {
    echo "a real violation must stay a FINDING, got: $output"
    return 1
  }
}
