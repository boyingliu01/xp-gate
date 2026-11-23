#!/usr/bin/env bats
#
# @test REQ-G6-MULTILANG one language having no tool must not skip every language
# @intent This repository has BOTH typescript and powershell in PROJECT_LANGS --
#         the .ps1 files are real (githooks/lib/Measure-PowerShellComplexity.ps1
#         among others), so the detection is correct.
#
#         Gate 6's architecture arm is an elif chain whose second branch is
#         "powershell has no tooling -> SKIP". Being an elif, it WINS over the
#         else-branch that actually runs archlint for TypeScript.
#
#         Measured 2026-11-23 over a week of gate-6 audit rows:
#
#             gate-6: 154 SKIP, 55 no-status, 0 PASS
#
#         NOT ONE architecture validation has ever run on this repository. The
#         TypeScript half -- the one this project is written in, with a 5.4 KB
#         .archlint.yaml configured -- has been skipped on every single commit
#         because a PowerShell file exists somewhere in the tree.
#
#         That is the "not checked recorded as skipped" defect in multi-language
#         form: each individual row is honest ("no tool for PowerShell"), and the
#         AGGREGATE is a lie -- it reads as "architecture was considered and not
#         applicable", when sixty gates' worth of TypeScript code was never looked
#         at.
#
#         Rule: the "no tool for language X" arm may only fire when no OTHER
#         detected language has an architecture checker. Otherwise a single
#         uncheckable language silently disables the gate for the whole repo.
#
# @covers AC-G6-MULTILANG-01 the PowerShell arm is conditional on no checkable language
# @covers AC-G6-MULTILANG-02 the checkable languages are named explicitly
# @covers AC-G6-MULTILANG-03 the arm still fires for a powershell-only project
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE6="$REPO/githooks/gate-entries/gate-6-entry.sh"
}

# AC-G6-MULTILANG-01
@test "AC-G6-MULTILANG-01: the PowerShell skip arm requires no other checkable language" {
  # The elif condition must deny every language that has an architecture checker.
  grep -q 'has_project_lang "typescript" 2>/dev/null' "$GATE6" || {
    echo "the PowerShell arm does not exclude typescript"
    echo "-> a repo with one .ps1 file never gets its TypeScript architecture checked"
    return 1
  }
  grep -q 'has_project_lang "python" 2>/dev/null' "$GATE6" || {
    echo "the PowerShell arm does not exclude python"; return 1; }
  grep -q 'has_project_lang "go" 2>/dev/null' "$GATE6" || {
    echo "the PowerShell arm does not exclude go"; return 1; }
}

# AC-G6-MULTILANG-02: the exclusion list must be inside the SAME elif condition,
# not somewhere else in the file. A stray `has_project_lang "typescript"` in an
# unrelated branch would satisfy case 1 and change nothing.
@test "AC-G6-MULTILANG-02: the exclusions are part of the PowerShell arm's condition" {
  local block
  block=$(awk '/has_project_lang "powershell"/,/GATE_6_DETAIL="architecture_skipped: no PowerShell/ ' "$GATE6")
  printf '%s' "$block" | grep -q 'has_project_lang "typescript"' || {
    echo "the typescript exclusion is not in the PowerShell arm"
    return 1
  }
}

# AC-G6-MULTILANG-03: the reverse constraint. A PowerShell-ONLY project must still
# skip -- otherwise this fix would have turned a silent skip into a false BLOCK.
@test "AC-G6-MULTILANG-03: the arm still fires for a powershell-only project" {
  grep -q 'GATE_6_DETAIL="architecture_skipped: no PowerShell architecture tooling"' "$GATE6" || {
    echo "the PowerShell skip arm was removed entirely"
    echo "-> a powershell-only project would now fall through to archlint"
    return 1
  }
  # And it must remain an elif of the documentation-only branch, i.e. still reachable.
  grep -q 'elif .*has_project_lang "powershell"' "$GATE6" || {
    echo "the PowerShell arm is no longer an elif branch"; return 1; }
}
