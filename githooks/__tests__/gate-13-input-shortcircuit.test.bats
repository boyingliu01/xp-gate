#!/usr/bin/env bats
#
# @test REQ-GATE13-INPUT-SHORTCIRCUIT
# @intent Gate 13's C/C++ arm does its EXPENSIVE work before its CHEAP check.
#
#         Measured on this machine, no C/C++ file staged (the normal case for a
#         TypeScript repository), one run of gate13_run_cpp_analysis:
#
#             gate13_select_cxx          192 ms
#             gate13_is_cross_compiling  501 ms
#             gate13_cpp_flags           112 ms
#             gate13_probe_flags         752 ms   <- compiles throwaway programs
#             gate13_compiler_id         397 ms
#             ------------------------------------
#             spent before asking         1954 ms
#             gate13_classify_changed    273 ms   <- the cheap question, asked LAST
#
#         gate13_classify_changed is the "is there anything to check?" step and it
#         runs after every probe has already paid for itself. The project's own
#         rule is the opposite: "Ask 'is there anything here to check?' (cheap, from
#         the change set) before 'is the tool installed?' (expensive)."
#
#         The Java and C# arms already do it correctly -- both call
#         gate13_java_sources / gate13_csharp_sources and return before touching a
#         toolchain. Only the C/C++ arm is inverted, so this is a local inversion,
#         not a house style.
#
#         The tests prove the CALL ORDER, not the wall time: a timing assertion on
#         this machine (load routinely 24-100%, and a single `git diff --cached`
#         costs 273-328 ms) cannot distinguish 1.9 s of probing from noise. A
#         marker file proves the probes ran or did not, which is the actual claim.
#
#         Both directions are asserted, per the project convention that every
#         short-circuit ships with a "must NOT be short-circuited" test beside it:
#         a predicate that silently matched everything would pass the first test
#         alone while turning "checked" into "checked nothing".
#
# @covers AC-GATE13-SHORTCIRCUIT-01 AC-GATE13-SHORTCIRCUIT-02
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  MARKER="$BATS_TEST_TMPDIR/probe_ran"
  rm -f "$MARKER"
}

# Run gate13_run_cpp_analysis with the probe stubbed to leave a fingerprint.
#
# $1 = "empty" to simulate no staged C/C++ files, or a filename to simulate one.
# Prints the function's exit status so the caller can also assert the verdict.
run_cpp_analysis() {
  local stage="$1"
  bash -c "
    cd '$REPO_ROOT' || exit 9
    export PROJECT_ROOT='$REPO_ROOT'
    export GATE_DIR='$REPO_ROOT/githooks'
    export CHANGED_FILES='' STAGED_FILES='' PROJECT_SUBDIR=''
    . githooks/gate-13-compiler-strictness.sh || exit 8
    # The change set is the cheap input; stub it so the test controls it without
    # staging anything in the real index.
    if [ '$stage' = 'empty' ]; then
      gate13_changed_cpp_files() { return 0; }
    else
      gate13_changed_cpp_files() { echo '$stage'; }
      gate13_classify_changed() { echo \"added	$stage\"; }
    fi
    # Any of the expensive probes leaves a fingerprint. Returning empty makes the
    # function take its 'no usable compiler' arm, so the rest is not reached and
    # the marker is the only observable.
    gate13_select_cxx() { : > '$MARKER'; return 0; }
    gate13_is_cross_compiling() { : > '$MARKER'; return 1; }
    gate13_probe_flags() { : > '$MARKER'; return 0; }
    gate13_compiler_id() { : > '$MARKER'; return 0; }
    gate13_run_cpp_analysis >/dev/null 2>&1
    echo \"rc=\$?\"
  " 2>/dev/null
}

@test "AC-GATE13-SHORTCIRCUIT-01: no staged C/C++ means no compiler probing" {
  # The fix under test: consult the change set before touching the toolchain.
  run run_cpp_analysis empty
  [ ! -e "$MARKER" ] || {
    echo "compiler probing ran with nothing staged: the cheap change-set check"
    echo "does not come first (measured 1954 ms wasted per commit)"
    return 1
  }
  [[ "$output" == *"rc=0"* ]] || {
    echo "expected PASS for an empty change set, got: $output"
    return 1
  }
}

@test "AC-GATE13-SHORTCIRCUIT-02: a staged C/C++ file still reaches the probes" {
  # The companion the convention requires. A short-circuit written against the
  # PROJECT instead of the CHANGE SET, or one that always fires, would pass the
  # test above while never checking anything.
  run run_cpp_analysis probe.cpp
  [ -e "$MARKER" ] || {
    echo "the short-circuit over-applied: a staged C/C++ file did not reach"
    echo "the compiler probes, so nothing would ever be checked"
    return 1
  }
}