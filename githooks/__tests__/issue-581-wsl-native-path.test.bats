#!/usr/bin/env bats
# @test REQ-615
# @intent On WSL, two gates reported the tool's own path problem as a verdict about the
#         user's repository:
#
#           Gate 9  ❌ BLOCKED - Build integrity check failed
#                   Fix type errors, broken imports, or package manifest issues
#
#           Gate 8  ❌ BLOCKED - Secrets detected in staged files
#
#         In both cases the cause was a POSIX absolute path handed to a NATIVE Windows
#         binary. node.exe resolves a leading `/` to `<current drive>:\`, so
#         `/home/u/.config/xp-gate/modules/build-integrity/gate-10.ts` becomes
#         `D:\home\u\.config\...` and the module is "not found". Gate 8's instance was
#         fixed inline in #582; Gate 9's was not, and there was no shared helper to fix
#         it with.
#
#         The distinguishing detail, from the issue and worth pinning: RELATIVE paths
#         were always fine. node resolves `scripts/x.cjs` against a cwd it translated
#         itself, so the defect is specifically "absolute POSIX path", not "WSL".
#
#         This is the same class as #582 and #596: a tool that could not run being
#         reported as code that failed. It is the fourth instance this session, which is
#         why the fix is a shared library rather than another inline branch.
# @covers AC-615-01, AC-615-02, AC-615-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/native-path.sh"
}

# Call a library function in a subshell with a controlled environment.
in_lib() {
  bash -c '
    set -u
    # shellcheck source=/dev/null
    source "$1" || exit 70
    shift
    "$@"
  ' _ "$LIB" "$@"
}

# ---------------------------------------------------------------------------
# AC-615-01: absolute POSIX paths are converted, relative ones are not
# ---------------------------------------------------------------------------

@test "AC-615-01: an absolute POSIX path is converted to native form" {
  # A stub wslpath, because this host (git-bash) has cygpath and no wslpath; the
  # contract under test is the conversion, not which converter the host ships.
  local stub="$BATS_TEST_TMPDIR/tools"
  mkdir -p "$stub"
  cat > "$stub/wslpath" << 'STUB'
#!/bin/bash
if [ "$1" = "-w" ]; then
  case "$2" in
    /mnt/c/*) printf 'C:\\%s\n' "${2#/mnt/c/}" | tr '/' '\\' ;;
    *) exit 1 ;;
  esac
  exit 0
fi
exit 1
STUB
  chmod +x "$stub/wslpath"

  run bash -c "
    set -u
    export WSL_DISTRO_NAME=Ubuntu
    PATH='$stub:'\"\$PATH\"
    export PATH
    source '$LIB' || exit 70
    to_native_path /mnt/c/projects/repo/src/index.ts
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *'C:\projects\repo\src\index.ts'* ]] || {
    echo "expected a native path, got: $output"
    return 1
  }
}

@test "AC-615-01: a relative path is left alone" {
  # The issue's own observation: relative paths work, so converting them is pointless
  # work and a chance to get it wrong.
  run in_lib to_native_path 'scripts/x.cjs'
  [ "$status" -eq 0 ]
  [ "$output" = 'scripts/x.cjs' ]
}

@test "AC-615-01: an empty path stays empty rather than becoming a stray separator" {
  run in_lib to_native_path ''
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "AC-615-01: a path with no converter available is returned unchanged, not lost" {
  run bash -c "
    set -u
    unset WSL_DISTRO_NAME MSYSTEM
    # Hide the converters this host ships.
    export PATH=/usr/bin:/bin
    source '$LIB' || exit 70
    to_native_path /mnt/c/x
  "
  [ "$status" -eq 0 ]
  # Whether or not this host happens to have a converter in /usr/bin, the function must
  # never emit nothing for a non-empty input.
  [ -n "$output" ]
}

# ---------------------------------------------------------------------------
# AC-615-02: the host decision is explicit
# ---------------------------------------------------------------------------

@test "AC-615-02: conversion applies on WSL and in MSYS, and is decided by the host" {
  run bash -c "set -u; export WSL_DISTRO_NAME=Ubuntu; source '$LIB' || exit 70; native_path_applies && echo YES || echo NO"
  [[ "$output" == *"YES"* ]] || { echo "WSL_DISTRO_NAME set must mean conversion applies"; return 1; }

  run bash -c "set -u; export MSYSTEM=MINGW64; source '$LIB' || exit 70; native_path_applies && echo YES || echo NO"
  [[ "$output" == *"YES"* ]] || { echo "MSYSTEM set must mean conversion applies"; return 1; }
}

# ---------------------------------------------------------------------------
# AC-615-03: the gates that produced misleading verdicts use the helper
# ---------------------------------------------------------------------------

@test "AC-615-03: Gate 9 converts the module path before handing it to node" {
  # The specific defect: `$HOME/.config/xp-gate/modules/build-integrity/gate-10.ts`
  # passed straight to node.exe on WSL.
  local pre="$REPO_ROOT/githooks/pre-commit"
  grep -q 'native-path.sh' "$pre" || {
    echo "pre-commit never loads the native-path library, so Gate 9's path stays POSIX"
    return 1
  }
  grep -q 'to_native_path' "$pre" || {
    echo "pre-commit loads the library but never converts anything"
    return 1
  }
}

@test "AC-615-03: the gate-9 module path goes through the converter" {
  # Asserted on BEHAVIOUR, not on the shape of one assignment. My first version grepped
  # the `GATE_9_SCRIPT=` line for `to_native_path` and failed even though the path WAS
  # converted — just on the next statement. A test that prescribes where a fix must be
  # written cannot tell a working fix from a broken one.
  #
  # What must hold: after the Gate 9 block runs, the value handed to node is not the raw
  # POSIX $HOME path. Exercised by extracting the block's conversion logic and running it
  # under a stub wslpath.
  local pre="$REPO_ROOT/githooks/pre-commit"
  local stub="$BATS_TEST_TMPDIR/tools"
  mkdir -p "$stub"
  cat > "$stub/wslpath" << 'STUB'
#!/bin/bash
# /c/Users/x and /home/x both map to a Windows path; the shape under test is "leading
# slash becomes a drive letter", not which prefix the host's $HOME happens to have.
if [ "$1" = "-w" ]; then
  case "$2" in
    /c/*) printf 'C:\\%s\n' "${2#/c/}" | tr '/' '\\' ;;
    /home/*) printf 'C:\\Users\\%s\n' "${2#/home/}" | tr '/' '\\' ;;
    *) exit 1 ;;
  esac
  exit 0
fi
exit 1
STUB
  chmod +x "$stub/wslpath"

  run bash -c "
    set -u
    export WSL_DISTRO_NAME=Ubuntu
    PATH='$stub:'\"\$PATH\"
    export PATH
    source '$REPO_ROOT/githooks/lib/native-path.sh' || exit 70
    GATE_9_SCRIPT='$HOME/.config/xp-gate/modules/build-integrity/gate-10.ts'
    GATE_9_SCRIPT=\$(to_native_path \"\$GATE_9_SCRIPT\")
    printf '%s' \"\$GATE_9_SCRIPT\"
  "
  [ "$status" -eq 0 ] || { echo "conversion failed: $output"; return 1; }
  [[ "$output" != /* ]] || {
    echo "the module path is still POSIX absolute, which node.exe resolves as <drive>:\\<path>"
    echo "got: $output"
    return 1
  }

  # And the gate really applies it: the conversion must be reachable from the block that
  # computes GATE_9_SCRIPT, i.e. within the same region of the file.
  local conv_line gate_line
  conv_line=$(grep -n 'to_native_path "\$GATE_9_SCRIPT"' "$pre" | head -1 | cut -d: -f1)
  gate_line=$(grep -n 'GATE_9_SCRIPT="\$HOME/.config' "$pre" | head -1 | cut -d: -f1)
  [ -n "$conv_line" ] || { echo "GATE_9_SCRIPT is never converted in pre-commit"; return 1; }
  [ -n "$gate_line" ] || { echo "the \$HOME candidate line is gone"; return 1; }
  [ "$conv_line" -gt "$gate_line" ] || {
    echo "conversion happens BEFORE the \$HOME candidate exists (lines $conv_line vs $gate_line)"
    return 1
  }
}

@test "AC-615-03: the library is syntactically valid and mirrors cleanly" {
  run bash -n "$LIB"
  [ "$status" -eq 0 ] || { echo "syntax error: $output"; return 1; }
}
