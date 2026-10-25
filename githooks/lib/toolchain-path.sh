#!/bin/bash
# Toolchain PATH bootstrap and tool resolution (#593).
#
# On Windows the hook runs under git-bash, which does NOT inherit the PATH entries
# the caller added on the Windows side, and none of the standard install locations
# for the toolchains these gates need are on git-bash's default PATH:
#
#   npm global CLIs      %APPDATA%\npm
#   the node binary      C:\Program Files\nodejs
#   pip --user scripts   %APPDATA%\Python\PythonNNN\Scripts
#   hand-placed tools    ~/bin, ~/.local/bin
#
# Every gate that needs one of those probed only `command -v` / `npx --no-install`
# / `~/.local/bin`, so "not on this shell's PATH" was reported as "not installed".
# Four gates did that for tools that were installed, and two of the reports were
# false GREENS (a gate that never ran, reported as a WARN that reads like an
# optional tool missing).
#
# The fix belongs here, once, rather than in each gate: one bootstrap that appends
# — never prepends — so the caller's PATH order stays authoritative.

# Directories to append, one per line. Empty when nothing applies.
#
# Globbing the Python Scripts dirs instead of guessing a version is deliberate:
# the version in the path is the interpreter's, not the tool's, and a repo may
# have several.
toolchain_path_candidates() {
  local _home="${HOME:-}"
  local _appdata="${APPDATA:-}"
  local _node="${XP_GATE_NODE_DIR:-}"
  local _d

  # npm global CLIs. APPDATA is the Windows default; the unix-shaped locations are
  # harmless on Linux/macOS because the loop below skips anything not a directory.
  [ -n "$_appdata" ] && [ -d "$_appdata/npm" ] && printf '%s\n' "$_appdata/npm"
  [ -n "$_home" ] && [ -d "$_home/.npm-global/bin" ] && printf '%s\n' "$_home/.npm-global/bin"

  # The node install dir. Needed not only to run node CLIs but to run the npm POSIX
  # shims, which exec `node` by name (#593 symptom 2).
  if [ -n "$_node" ] && [ -d "$_node" ]; then
    printf '%s\n' "$_node"
  fi
  if [ -n "$_appdata" ] && [ -d "$_appdata/npm/node_modules/.bin" ]; then
    printf '%s\n' "$_appdata/npm/node_modules/.bin"
  fi

  # pip --user Scripts dirs, one per Python version found.
  if [ -n "$_appdata" ] && [ -d "$_appdata/Python" ]; then
    for _d in "$_appdata"/Python/Python*/Scripts; do
      [ -d "$_d" ] && printf '%s\n' "$_d"
    done
  fi
  # Unix-side pip --user and hand-placed tools.
  [ -n "$_home" ] && [ -d "$_home/.local/bin" ] && printf '%s\n' "$_home/.local/bin"
  [ -n "$_home" ] && [ -d "$_home/bin" ] && printf '%s\n' "$_home/bin"

  return 0
}

# Append the toolchain locations to PATH. Idempotent: a second call is a no-op.
#
# APPENDS rather than prepends. A project that pins its own tool version must keep
# winning; putting a global CLI in front would silently override it.
bootstrap_toolchain_path() {
  local _dir _added=0
  while IFS= read -r _dir; do
    [ -n "$_dir" ] || continue
    case ":${PATH}:" in
      *":${_dir}:"*) continue ;;
    esac
    PATH="${PATH}:${_dir}"
    _added=$((_added + 1))
  done <<EOF_TOOLCHAIN
$(toolchain_path_candidates)
EOF_TOOLCHAIN

  # #596 point 2: the authoritative source is the ORIGINAL Windows PATH, not a list
  # of guessed standard locations. A hook shell can run with a shrunken PATH while
  # ORIGINAL_PATH still carries everything, and a custom prefix (D:\npm) shows up
  # only there. Appended after the standard candidates, so an explicitly pinned
  # project toolchain still wins.
  while IFS= read -r _dir; do
    [ -n "$_dir" ] || continue
    case ":${PATH}:" in
      *":${_dir}:"*) continue ;;
    esac
    [ -d "$_dir" ] || continue
    PATH="${PATH}:${_dir}"
    _added=$((_added + 1))
  done <<EOF_ORIGINAL
$(original_path_dirs)
EOF_ORIGINAL

  export PATH
  _XP_GATE_TOOLCHAIN_BOOTSTRAPPED=1
  return 0
}

# Environment variable that names a tool binary directly, in priority order.
#
# #580's first suggestion: a user whose toolchain lives somewhere unusual has no
# way to say so today, and "put it on PATH" is not available to everyone — WSL with
# appendWindowsPath=false has no Windows PATH at all.
tool_env_override() {
  case "$1" in
    node) printf '%s\n' "${XP_GATE_NODE_BIN:-}" ;;
    npx) printf '%s\n' "${XP_GATE_NPX_BIN:-}" ;;
    npm) printf '%s\n' "${XP_GATE_NPM_BIN:-}" ;;
    *) printf '%s\n' "" ;;
  esac
}

# Is a tool available, counting the Windows `.exe` suffix and an env override?
#
# `command -v node` returns 1 on WSL and in git-bash even when
# /mnt/c/Program Files/nodejs/node.exe exists and runs, because bash does not
# append a suffix the way Windows does (#580). That single fact gave one gate a
# silent SKIP and another a false BLOCK on the same machine:
#
#   Gate 1  "SKIP - npx not available"           fail-OPEN, reads like "nothing
#                                                to check here"
#   Gate 1  "BLOCKED - Biome check failed"       fail-CLOSED, wrong cause
#   Gate 8  "BLOCKED - gitleaks not installed"   a security gate blocked by its
#                                                own environment
#
# Both described an environment problem as a code problem.
#
# #596 adds the third and costliest variant: PRESENCE IS NOT EXECUTABILITY.
# `command -v checkov` succeeds on a POSIX shim whose shebang execs `python`, on a
# shell where `python` is not resolvable. The file is there, it is executable, and
# running it dies at the `exec` with 127. Gate 7 counted zero usable scanners and
# BLOCKED a commit under "no scanning tools available" — on a repo where checkov
# 3.3.30 worked. So the probe now proves it can run.
tool_is_available() {
  local _tool="$1" _override _hit
  _override=$(tool_env_override "$_tool")
  if [ -n "$_override" ] && [ -x "$_override" ]; then
    tool_can_execute "$_override"
    return $?
  fi

  _hit=$(command -v "$_tool" 2>/dev/null || true)
  if [ -z "$_hit" ]; then
    # Harmless on Linux/macOS: no such file exists there.
    _hit=$(command -v "${_tool}.exe" 2>/dev/null || true)
  fi
  if [ -z "$_hit" ]; then
    # #596: a tool reachable only through the un-shrunk PATH still counts. Callers
    # may probe before bootstrapping, so this cannot rely on the bootstrap having
    # run.
    _hit=$(find_tool_in_original_path "$_tool")
  fi
  [ -n "$_hit" ] || return 1

  # Found — now prove it is not a shim pointing at an unreachable interpreter.
  # A tool that exists but cannot run is NOT available; the caller reports it as a
  # toolchain failure, which is a different and true statement from "not installed".
  tool_can_execute "$_hit"
}

# The path of a tool found in ORIGINAL_PATH, or the empty string.
#
# @param {string} tool tool name
# @returns {string}
find_tool_in_original_path() {
  local _tool="$1" _dir
  while IFS= read -r _dir; do
    [ -n "$_dir" ] || continue
    if [ -x "$_dir/$_tool" ]; then
      printf '%s' "$_dir/$_tool"
      return 0
    fi
    if [ -x "$_dir/${_tool}.exe" ]; then
      printf '%s' "$_dir/${_tool}.exe"
      return 0
    fi
  done <<EOF_ORIGINAL_TOOL
$(original_path_dirs)
EOF_ORIGINAL_TOOL
  return 0
}

# Can this resolved tool be executed?
#
# Runs `<tool> --version` under a timeout. Exit 127 is the shell's own "interpreter
# not found" and is the precise signal for the broken-shim case. Any other non-zero
# exit still counts as executable: a tool that runs and rejects `--version` exists
# and works, and calling it missing would be the same defect in the other direction.
#
# @param {string} path resolved tool path
# @returns 0 when the tool can be executed
tool_can_execute() {
  local _path="$1" _status=0
  [ -n "$_path" ] && [ -x "$_path" ] || return 1
  if command -v timeout >/dev/null 2>&1; then
    timeout 20 "$_path" --version >/dev/null 2>&1 || _status=$?
  else
    "$_path" --version >/dev/null 2>&1 || _status=$?
  fi
  [ "$_status" -ne 127 ]
}

# Directories listed in ORIGINAL_PATH, one per line.
#
# #596 point 2: inside a hook shell $PATH can be a handful of entries (measured: 7)
# while ORIGINAL_PATH still carries the full Windows PATH (measured: 3002 chars), and
# a tool installed to a custom prefix appears only in the latter. Guessing standard
# install locations — all #593's bootstrap does — cannot find a custom prefix.
#
# Normally unset on Linux/macOS, which yields nothing and is correct: there is no
# shrunken-PATH problem there.
original_path_dirs() {
  local _raw="${ORIGINAL_PATH:-}"
  [ -n "$_raw" ] || return 0
  printf '%s' "$_raw" | tr ':' '\n' | sed -n '/./p'
}

# Resolve a tool to an absolute path, or return 1.
#
# Priority order, matching #580's suggestion:
#   1. XP_GATE_<TOOL>_BIN override
#   2. command -v <tool>
#   3. command -v <tool>.exe            (a Windows binary seen from a *NIX* shell)
#   4. npx --no-install
#   5. subproject node_modules/.bin
#
# Covers the shapes `command -v` cannot see:
#   * the `.exe` suffix (#580)
#   * subproject node_modules/.bin (monorepos: jscpd is a devDependency of ui/)
#   * the standard Windows toolchain locations, via the bootstrap
#
# Echoes the path on success.
resolve_tool_path() {
  local _tool="$1" _hit _d _override
  local _base="${PROJECT_ROOT:-$(pwd)}"

  # #580: an explicit override wins over every probe.
  _override=$(tool_env_override "$_tool")
  if [ -n "$_override" ] && [ -x "$_override" ]; then
    printf '%s\n' "$_override"
    return 0
  fi

  _hit=$(command -v "$_tool" 2>/dev/null || true)
  if [ -z "$_hit" ]; then
    # #580: the .exe suffix. bash does not append it the way Windows does, so a
    # bootstrapped Windows toolchain stays invisible without this second probe —
    # and every gate keeps reporting an installed tool as missing.
    _hit=$(command -v "${_tool}.exe" 2>/dev/null || true)
  fi
  if [ -n "$_hit" ]; then
    printf '%s\n' "$_hit"
    return 0
  fi

  # npx knows about the project's own node_modules.
  if tool_is_available npx; then
    if npx --no-install "$_tool" --version >/dev/null 2>&1; then
      printf '%s\n' "$_tool"
      return 0
    fi
  fi

  # Subproject node_modules/.bin, shallow then one level deep. A monorepo's ui/ or
  # server/ package is the normal case; deeper nesting is rare enough that a full
  # find would cost more than it returns.
  for _d in "$_base/node_modules/.bin/$_tool" "$_base"/*/node_modules/.bin/"$_tool"; do
    if [ -x "$_d" ]; then
      printf '%s\n' "$_d"
      return 0
    fi
  done

  return 1
}

# Put the directory of a resolved tool on PATH, so the tool's own siblings are
# reachable, and print that directory.
#
# semgrep(.exe) is a zipapp wrapper that execs the sibling `pysemgrep`. Resolving
# the wrapper is not enough: if its directory is not on PATH the wrapper dies with
# `executing pysemgrep failed: No such file or directory`, which Gate 10 then
# reported as "tool not installed" (#593 symptom 4).
#
# WARNING: call this directly, never as `$(resolve_tool_dir x)`. A command
# substitution runs in a subshell, so the PATH change would be discarded and the
# caller would get the directory name while the tool stayed broken — which is
# exactly how this bit its own first test. Read the directory from
# `$(resolve_tool_dir ...)` only if you do not need the PATH side effect; otherwise
# call it and capture with a plain assignment from a file or use
# `ensure_tool_dir_on_path`.
resolve_tool_dir() {
  local _tool="$1" _path _dir
  bootstrap_toolchain_path
  _path=$(resolve_tool_path "$_tool") || return 1
  if [ -f "$_path" ]; then
    _dir=$(cd "$(dirname "$_path")" && pwd)
  else
    _dir=$(pwd)
  fi
  case ":${PATH}:" in
    *":${_dir}:"*) ;;
    *) PATH="${_dir}:${PATH}"; export PATH ;;
  esac
  printf '%s\n' "$_dir"
  return 0
}

# Side-effect-only variant: put the tool's directory on PATH in the CALLER's
# shell. Returns 0 on success, 1 when the tool cannot be resolved.
#
# This is the one to call from a gate that is about to run the tool.
ensure_tool_dir_on_path() {
  local _tool="$1" _dir
  bootstrap_toolchain_path
  _dir=$(resolve_tool_path "$_tool") || return 1
  if [ -f "$_dir" ]; then
    _dir=$(cd "$(dirname "$_dir")" && pwd)
  else
    _dir=$(pwd)
  fi
  case ":${PATH}:" in
    *":${_dir}:"*) ;;
    *) PATH="${_dir}:${PATH}"; export PATH ;;
  esac
  return 0
}

# Human-readable list of everywhere a tool is looked for, for the "not available"
# message.
#
# "not installed" and "installed but not found" need different fixes, and the old
# message could only say the first (#593 point 3).
describe_tool_search() {
  local _tool="$1" _base="${PROJECT_ROOT:-$(pwd)}"
  printf '   Searched: PATH entries'
  printf ', %s' "$_base/node_modules/.bin/$_tool" "$_base"/*/node_modules/.bin/"$_tool"
  local _extra
  _extra=$(toolchain_path_candidates | tr '\n' ',' | sed 's/,$//')
  if [ -n "$_extra" ]; then
    printf ', toolchain dirs (%s)' "$_extra"
  fi
  printf '\n'
  printf '   If the tool IS installed, this is a PATH problem, not a missing install.\n'
}

# Classify a non-zero exit from a tool: TOOLCHAIN or FINDING.
#
#   $1 -- the tool's exit status
#   $2 -- everything it printed
#
# Exit 127 plus an exec/"not found" line means the shim resolved but its
# interpreter did not. Gate 6 printed
#     ❌ BLOCKED - Architecture violations detected
# for exactly that, pointing the reader at code that was fine (#593 symptom 2).
#
# The FINDING default matters as much: if everything looked like a toolchain
# problem, no gate could ever block on a real violation.
classify_tool_failure() {
  local _exit="$1" _out="$2"
  if [ "$_exit" -eq 127 ] 2>/dev/null; then
    printf 'TOOLCHAIN\n'
    return 0
  fi
  if printf '%s' "$_out" | grep -qiE 'exec: [^ ]+: not found|command not found|No such file or directory.*exec|pysemgrep failed'; then
    printf 'TOOLCHAIN\n'
    return 0
  fi
  printf 'FINDING\n'
}
