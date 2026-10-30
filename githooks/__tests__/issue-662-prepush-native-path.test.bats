#!/usr/bin/env bats
# @test REQ-662
# @intent Every `git push` failed to write the Gate M audit journal, and printed
#         two misleading warnings while doing it:
#
#           python.exe: can't open file 'C:\tmp\tmp.NGTeNc4Xfa': [Errno 2] ...
#           ⚠️  Gate M journal: python exited 2 — the push's audit record at
#               .xp-gate/reports/pre-push/<ts>.json is missing.
#
#         Both are the SAME class (#581/#582/#661): a POSIX path handed to a
#         NATIVE binary. Under Git-Bash `mktemp` returns `/tmp/tmp.XXXX` and the
#         hook dir is `$HOME/.config/...` (`/c/Users/...`); native python.exe
#         resolves the leading `/` against the CURRENT DRIVE, so the file it looks
#         for is `C:\tmp\...` or `C:\c\Users\...` — never the one that exists.
#
#         Two separate paths had to be converted:
#           1. the temporary Python BODY written by mktemp;
#           2. the scorer MODULE `lib/prepush-score.py`, discovered relative to
#              the hook (an absolute POSIX path when the hook itself is absolute).
#
#         Fixing only the first produced the second warning. That is why this test
#         asserts on BOTH, and on their ORDER relative to the invocation.
#
#         Note the failure mode was billed as "report missing", not "path bug":
#         the audit chain looked like a missing-file problem when it was an
#         environment-boundary problem. Hence the structural assertions here —
#         a future refactor that drops a conversion will fail this file rather
#         than quietly reintroduce a broken audit trail.
# @covers AC-670-49, AC-670-50

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PREPUSH="$REPO_ROOT/githooks/pre-push"
}

# AC-670-49: the mktemp body is converted before python is invoked.
@test "AC-670-49: the temp python body is converted to a native path before use" {
  [ -f "$PREPUSH" ]
  local conv_line=''
  local call_line=''
  conv_line=$(grep -n 'py_script_native="\$(cygpath -w' "$PREPUSH" | head -1 | cut -d: -f1)
  call_line=$(grep -n '"\$py_bin" "\$py_script_native"' "$PREPUSH" | head -1 | cut -d: -f1)
  [ -n "$conv_line" ] || { echo "the mktemp path is never converted to native form"; return 1; }
  [ -n "$call_line" ] || { echo "python invocation not found"; return 1; }
  [ "$conv_line" -lt "$call_line" ] \
    || { echo "conversion at $conv_line happens after the call at $call_line"; return 1; }
  # And python must be called with the CONVERTED value, not the raw POSIX one --
  # otherwise the conversion above is dead code.
  grep -q '"\$py_bin" "\$py_script_native"' "$PREPUSH" \
    || { echo "python is still invoked with the unconverted path"; return 1; }
}

# AC-670-50: the scorer module is converted too (this was the SECOND warning).
@test "AC-670-50: the scorer module path is converted before it reaches python" {
  local conv_line=''
  local use_line=''
  conv_line=$(grep -n 'score_lib_native="' "$PREPUSH" | head -1 | cut -d: -f1)
  use_line=$(grep -n 'score_lib_native' "$PREPUSH" | sed -n '2p' | cut -d: -f1)
  [ -n "$conv_line" ] || { echo "score_lib is never converted to native form"; return 1; }
  [ -n "$use_line" ] || { echo "score_lib_native is converted but never used"; return 1; }
  [ "$conv_line" -le "$use_line" ] \
    || { echo "score_lib_native used before it is assigned"; return 1; }
  # The converted value must actually be passed to python / the script body.
  grep -qE 'score_lib_native' "$PREPUSH" \
    || { echo "score_lib_native does not reach the invocation"; return 1; }
  # A raw POSIX score_lib must not be passed through unsplit to a native binary.
  if grep -qE '"\$py_bin"[^\n]*"\$score_lib"' "$PREPUSH"; then
    echo "python is invoked with the unconverted score_lib"
    return 1
  fi
}
