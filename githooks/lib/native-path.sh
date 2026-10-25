#!/usr/bin/env bash
# Convert a POSIX path into the form a NATIVE Windows binary can open.
#
# #581 / #582: on WSL and in Git-Bash, `node.exe` and `gitleaks.exe` cannot open
# `/mnt/d/projects/repo/...` or `/d/projects/repo/...`. They resolve a leading `/` to
# `<current drive>:\`, so the path silently becomes `D:\mnt\d\projects\...` and the
# module is "not found". The failure then gets reported as a verdict about the USER'S
# repository:
#
#   Gate 9  ❌ BLOCKED - Build integrity check failed
#           Fix type errors, broken imports, or package manifest issues
#
#   Gate 8  ❌ BLOCKED - Secrets detected in staged files
#
# Both are wrong, and both are expensive to debug: the message points at the code,
# the cause is the shell. #582 fixed the Gate 8 instance inline; this library exists so
# the next caller does not have to re-derive it, and so there is ONE place that knows
# the converters — not one per gate that happened to notice.
#
# Relative paths are deliberately NOT converted. node resolves `scripts/x.cjs` against
# its own cwd, which it translated correctly; converting would be pointless work and a
# chance to get it wrong.

# Does this host need POSIX -> native conversion at all?
#
# True when a native binary is on the far side of the shell: WSL, or MSYS/Git-Bash on
# Windows. On a plain Linux/macOS host neither converter exists and no conversion is
# ever wanted.
#
# @returns 0 when conversion applies
native_path_applies() {
  [ -n "${WSL_DISTRO_NAME:-}" ] && return 0
  [ -n "${MSYSTEM:-}" ] && return 0
  # Fallback: a converter being present IS the signal, and covers hosts that set
  # neither marker (some CI images strip MSYSTEM).
  command -v wslpath >/dev/null 2>&1 && return 0
  command -v cygpath >/dev/null 2>&1 && return 0
  return 1
}

# Convert a path to native Windows form, or echo it unchanged when that is not possible.
#
# Order matters. `wslpath` is WSL's converter; `cygpath` is MSYS/Git-Bash's. Asking each
# only on its own host avoids the case where both exist and the wrong one "succeeds"
# with a path the other binary cannot use.
#
# Never fails the caller: a path that cannot be converted is returned as-is, because a
# gate that aborts here would break on hosts that need no conversion at all. Callers that
# must know whether conversion happened should compare the input and output.
#
# @param {string} path path to convert
# @returns {string} native form, or the input unchanged
to_native_path() {
  local _p="${1:-}"
  [ -n "$_p" ] || return 0
  # Only absolute paths are candidates. A relative path is resolved by the child
  # process against a cwd it handles correctly.
  case "$_p" in
    /*) ;;
    *) printf '%s' "$_p"; return 0 ;;
  esac

  local _converted=""
  if [ -n "${WSL_DISTRO_NAME:-}" ] && command -v wslpath >/dev/null 2>&1; then
    _converted=$(wslpath -w "$_p" 2>/dev/null || true)
  elif command -v cygpath >/dev/null 2>&1; then
    _converted=$(cygpath -w "$_p" 2>/dev/null || true)
  elif command -v wslpath >/dev/null 2>&1; then
    # wslpath without WSL_DISTRO_NAME: still the better guess than nothing.
    _converted=$(wslpath -w "$_p" 2>/dev/null || true)
  fi

  if [ -n "$_converted" ]; then
    printf '%s' "$_converted"
  else
    printf '%s' "$_p"
  fi
}

# Convert a path only when conversion is needed, and say so when it cannot be done.
#
# The stricter sibling: use this where a wrong path produces a MISLEADING verdict rather
# than a clean failure (Gate 9's "build integrity check failed", Gate 8's "secrets
# detected"). It prints a warning to stderr when the path is absolute, the host needs
# conversion, and nothing was converted — the case that silently becomes a false verdict.
#
# @param {string} path path to convert
# @param {string} what human name for the path, used in the warning
# @returns {string} converted path, or the input unchanged
to_native_path_or_warn() {
  local _p="${1:-}"
  local _what="${2:-path}"
  local _out
  _out=$(to_native_path "$_p")
  if [ "$_out" = "$_p" ]; then
    case "$_p" in
      /*)
        if native_path_applies; then
          echo "  ⚠️  could not convert $_what to native form: $_p" >&2
          echo "      a native binary may fail to open it; the failure will look like a code defect" >&2
        fi
        ;;
    esac
  fi
  printf '%s' "$_out"
}
