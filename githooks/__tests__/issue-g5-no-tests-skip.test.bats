#!/usr/bin/env bats
#
# @test REQ-G5-NOTESTS "no tests to run" is SKIP, but "tests exist, report missing" still BLOCKS
# @intent Gate 5 conflated two different states and refused a commit over the wrong
#         one.
#
#         The gate's coverage branch already knew (since #570) that "could not
#         determine coverage" must be fail-closed: a language that emits no report
#         file gets BLOCK, because the absence of a report is not evidence of
#         coverage. That rule is correct and stays.
#
#         What it did not distinguish is a repository that has no tests AT ALL.
#         Measured 2026-11-23 on the csharp probe fixture -- a single A.cs with no
#         test project:
#
#             gate 5 = BLOCK   coverage_not_determined: no standard report file for csharp
#
#         A repository that has never had a test cannot produce a coverage report,
#         so the 80% floor is not applicable; blocking says "your coverage was
#         never measured" about code nobody ever asked to measure. The PowerShell
#         branch already drew this line (#806 G5a): no tests to run is SKIP with a
#         reason. The generic branch honoured only half the rule.
#
#         The asymmetry in the helper is the point. Guessing WRONG towards "no
#         tests" would SKIP the floor for a repo that does have tests -- a silent
#         pass, the failure this whole project exists to prevent. Guessing wrong
#         towards "tests exist" only costs a BLOCK that already happened. So:
#         answer "no" only on positive proof of absence, and answer "yes" for every
#         language the helper does not know.
#
# @covers AC-G5-NOTESTS-01 a project with no test sources is detected as such
# @covers AC-G5-NOTESTS-02 a project with test sources is NOT skipped
# @covers AC-G5-NOTESTS-03 an unknown language keeps the fail-closed behaviour
# @covers AC-G5-NOTESTS-04 the skip records a status and a reason, not just prose
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE5="$REPO/githooks/gate-entries/gate-5-entry.sh"
  WORK="$(mktemp -d)"
  # Pull the helper out of the gate so it can be exercised without running a gate.
  sed -n '/^_gate5_language_has_tests()/,/^}/p' "$GATE5" > "$WORK/helper.sh"
}

teardown() {
  rm -rf "$WORK"
}

# AC-G5-NOTESTS-01
@test "AC-G5-NOTESTS-01: a project with no test sources reports no tests" {
  mkdir -p "$WORK/proj"
  printf '<Project Sdk="Microsoft.NET.Sdk"/>\n' > "$WORK/proj/p.csproj"
  printf 'class A { }\n' > "$WORK/proj/A.cs"

  cd "$WORK/proj" || return 1
  # shellcheck source=/dev/null
  source "$WORK/helper.sh"
  run _gate5_language_has_tests csharp
  [ "$status" -ne 0 ] || {
    echo "a csharp project with no test project was reported as HAVING tests"
    echo "-> the coverage floor would block a repo that cannot produce a report"
    return 1
  }
}

# AC-G5-NOTESTS-02: the reverse constraint. Without this, the helper could return
# "no tests" unconditionally and every test above would still pass.
@test "AC-G5-NOTESTS-02: a project WITH test sources is not reported as testless" {
  mkdir -p "$WORK/proj"
  printf '<Project Sdk="Microsoft.NET.Sdk"/>\n' > "$WORK/proj/p.csproj"
  printf 'class A { }\n' > "$WORK/proj/A.cs"
  printf '<Project Sdk="Microsoft.NET.Sdk"/>\n' > "$WORK/proj/p.Tests.csproj"

  cd "$WORK/proj" || return 1
  # shellcheck source=/dev/null
  source "$WORK/helper.sh"
  run _gate5_language_has_tests csharp
  [ "$status" -eq 0 ] || {
    echo "a project CARRYING p.Tests.csproj was reported as having no tests"
    echo "-> coverage would be silently skipped for a repo that does have tests"
    return 1
  }
}

# AC-G5-NOTESTS-03: an unknown language must keep the old fail-closed behaviour,
# so adding this helper cannot widen the skip surface.
@test "AC-G5-NOTESTS-03: an unknown language is assumed to have tests" {
  cd "$WORK" || return 1
  # shellcheck source=/dev/null
  source "$WORK/helper.sh"
  run _gate5_language_has_tests cobol
  [ "$status" -eq 0 ] || {
    echo "an unknown language was treated as testless"
    echo "-> this helper widened the skip surface instead of narrowing it"
    return 1
  }
}

# AC-G5-NOTESTS-04: the skip must be a recorded verdict, not prose.
@test "AC-G5-NOTESTS-04: the no-tests skip sets SKIP and a reason" {
  # The branch must set both channels. A console message alone is the defect this
  # project keeps re-learning: prose says "skipped" while the journal records PASS.
  grep -q 'GATE_5_STATUS="SKIP"' "$GATE5" || {
    echo "the no-tests branch does not set GATE_5_STATUS=SKIP"
    return 1
  }
  grep -q 'GATE_5_DETAIL="${CURRENT_LANG}: no test sources' "$GATE5" || {
    echo "the no-tests branch does not record why it skipped"
    return 1
  }
  # And it must be reachable only from inside the generic coverage branch.
  grep -q '_gate5_language_has_tests "\$CURRENT_LANG"' "$GATE5" || {
    echo "the helper is never called by the gate"
    return 1
  }
}
