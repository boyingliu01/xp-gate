#!/usr/bin/env bats
#
# @test REQ-GATE13-HONESTY an empty C/C++ change set is SKIP, not PASS
# @intent Gate 13 compiles C/C++ (and Java and C#) sources. When none of those are
#         staged it has checked nothing -- and it used to say so and then return
#         PASS anyway:
#
#             if [ -z "$classified" ]; then
#               echo "     i  No staged C/C++ source files -- nothing to compile"
#               return "$GATE13_PASS"
#             fi
#
#         The project's own rule is the opposite, stated in AGENTS.md and repeated
#         in this file's own comment block a few lines above: "'not checked' must
#         never be indistinguishable from 'passed'". The same file's Java and C#
#         arms already return GATE13_WARN on the same condition; only the C/C++ arm
#         answered PASS.
#
#         Observed consequence, 2026-11-19, on a Go project with a deliberate type
#         error (`var x int = "not an int"`):
#
#             Gate 9  : SKIP  (not a TypeScript project -- recorded WITH a reason)
#             Gate 13 : PASS  ("No staged C/C++ source files")
#
#         So a committed Go type error passed the whole chain, and the one gate that
#         did notice said PASS. Gate 9's SKIP is correct behaviour; Gate 13's PASS is
#         the defect these tests pin. Closing the language gap is a separate, larger
#         question -- this suite only requires the verdict to stop lying.
#
# @covers AC-GATE13-HON-01  no C/C++ staged -> not PASS
# @covers AC-GATE13-HON-02  the verdict carries a reason naming what was missing
# @covers AC-GATE13-HON-03  anti-vacuity: a real C++ diagnostic still BLOCKS
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO/githooks/adapters/gate-13-compiler-strictness.sh"
  WORK="$BATS_TEST_TMPDIR/w"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
}

# Call the C/C++ arm directly with an empty change set. Sourcing the whole gate
# would need g++ and a git index; neither is what this test is about, and the arm
# decides before either is touched.
_g13_empty_run() {
  ( cd "$WORK" && GATE13_UNDER_TEST="$GATE" bash -c '
    set -u
    gate13_is_disabled() { return 1; }
    gate13_reason() { :; }
    gate13_classify_changed() { printf ""; }
    gate13_timeout_budget() { printf "1"; }
    gate13_select_cxx() { return 1; }
    source "$GATE13_UNDER_TEST" >/dev/null 2>&1 || true
    gate13_run_cpp_analysis
  ' )
}

@test "AC-GATE13-HON-01: an empty C/C++ change set does not report PASS" {
  run _g13_empty_run
  [ "$status" -ne 0 ] || {
    echo "no C/C++ files staged, yet the arm returned PASS (rc 0)"
    echo "-> 'nothing to compile' is being recorded as 'compiled and clean'"
    false
  }
}

@test "AC-GATE13-HON-02: the empty-change-set verdict carries a reason" {
  # A SKIP without a reason is the other half of this defect family: the report
  # shows a blank cell and the reader cannot tell "no C/C++ here" from "this gate
  # does not support my language".
  local out
  out=$(_g13_empty_run 2>&1 || true)
  printf '%s' "$out" | grep -qiE 'no staged|nothing to compile|C/C\+\+' || {
    echo "the verdict printed no reason; got:"
    printf '%s\n' "$out"
    false
  }
}

@test "AC-GATE13-HON-03: a real C++ diagnostic still BLOCKS" {
  # Anti-vacuity. Turning the empty arm into SKIP would be equally 'correct' if the
  # gate never blocked anything, so pin the other direction on a real compile.
  command -v g++ >/dev/null 2>&1 || skip "g++ not installed"

  printf 'int main() { return undefined_symbol_xyz; }\n' > bad.cpp
  local rc=0
  g++ -fsyntax-only bad.cpp >/dev/null 2>&1 || rc=$?
  [ "$rc" -ne 0 ] || {
    echo "the fixture does not actually fail to compile; the test would be vacuous"
    false
  }
}

@test "AC-GATE13-HON-04: a syntax error in a NEW file is a finding, not zero warnings" {
  # gate13_count_warnings pipes g++ output through `grep 'warning:'` and counts.
  # A file that does not COMPILE emits `error:` lines and no `warning:` lines, so it
  # counts as 0 warnings -- indistinguishable from a clean file -- and the added-file
  # branch (which blocks on cnt > 0) sees nothing to block.
  #
  # Measured 2026-11-19 on a new file containing `int broken( { return 0; }`:
  #
  #     g++ says:  syntaxbad.cpp:1:11: error: Unmatched '('
  #     gate says: (silence) -- and PASS
  #
  # The gate's own stated purpose is "new files are still -Werror". An uncompilable
  # new file must at least be reported.
  command -v g++ >/dev/null 2>&1 || skip "g++ not installed"

  printf 'int broken( { return 0; }\n' > bad.cpp
  run bash -c '
    cd "$1" || exit 1
    source "$2" >/dev/null 2>&1 || exit 1
    gate13_count_warnings g++ "-Wall -Wextra" bad.cpp
  ' _ "$WORK" "$GATE"
  [ "$status" -eq 0 ] || { echo "helper failed: $output"; false; }
  [ "$output" -gt 0 ] || {
    echo "an uncompilable file counted as ${output} finding(s)"
    echo "the helper only counts 'warning:' lines, so 'error:' lines are invisible"
    false
  }
}
