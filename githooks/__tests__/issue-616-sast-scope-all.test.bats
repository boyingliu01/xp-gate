#!/usr/bin/env bats
# @test REQ-616-SAST-ALL
# @intent `xp-gate check . --all` claims to scan the whole tree. Gate 8 (gitleaks)
#         was taught to honour `GATE_SCOPE` in #616; its sibling fragment in the
#         npm package was not. Gate 10 (semgrep) still hard-codes the staged diff:
#
#             SEMGREP_FILES=$(git diff --cached --name-only --diff-filter=ACM ...)
#
#         Measured on llmveto (2026-11-25, xp-gate 0.38.126, Linux/WSL2): ~60
#         tracked .ts files, semgrep 1.186.0 installed and on PATH, and:
#
#             $ xp-gate check --all
#             → Gate 10: Semgrep SAST Security Scan...
#                  ⏭️  SKIPPED - SAST (no supported language files changed)
#
#         The tree was NOT clean. Running semgrep directly over the same src/
#         returned 5 findings, two of them real (`new RegExp` built from an
#         unescaped table name). The gate reported "nothing to scan" over a
#         non-empty result set -- the fail-open shape #589 and #616 already
#         fixed one and two layers up.
#
#         This is the same defect as #616 with a different file: the fragment
#         must read the signal the runner already exports (`GATE_SCOPE`), not
#         re-derive scope from the index.
# @covers AC-616-SAST-01, AC-616-SAST-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  # The npm-package copies are what a real install runs; githooks/gate-10.sh is
  # the repo-side mirror. All three must agree or the fix ships to only one path.
  GATE10_PKG="$REPO_ROOT/src/npm-package/gate-10.sh"
  GATE10_HOOKS="$REPO_ROOT/src/npm-package/hooks/gate-10.sh"
  GATE10_REPO="$REPO_ROOT/githooks/gate-10.sh"
  GATE8="$REPO_ROOT/githooks/gate-8.sh"
}

# AC-616-SAST-01: every shipped copy of the SAST fragment reads GATE_SCOPE.
@test "AC-616-SAST-01: gate-10 reads GATE_SCOPE at all (all three copies)" {
  for f in "$GATE10_PKG" "$GATE10_HOOKS" "$GATE10_REPO"; do
    [ -f "$f" ] || { echo "missing fragment: $f"; return 1; }
    run grep -q 'GATE_SCOPE' "$f"
    [ "$status" -eq 0 ] || { echo "does not read GATE_SCOPE: $f"; return 1; }
  done
}

# AC-616-SAST-02: the whole-tree branch exists, and the index branch survives.
@test "AC-616-SAST-02: gate-10 has an ls-files arm and keeps the staged arm" {
  for f in "$GATE10_PKG" "$GATE10_HOOKS" "$GATE10_REPO"; do
    # Whole tree: enumerate tracked files, not the index.
    run grep -qE 'git ls-files' "$f"
    [ "$status" -eq 0 ] || { echo "no ls-files arm: $f"; return 1; }
    # Default path must keep scanning exactly what is being committed.
    run grep -q 'git diff --cached' "$f"
    [ "$status" -eq 0 ] || { echo "index arm was removed: $f"; return 1; }
  done
}

# AC-616-SAST-03: parity with the Gate 8 fix that already shipped.
@test "AC-616-SAST-03: gate-8 (already fixed) and gate-10 read the same signal" {
  run grep -q 'GATE_SCOPE' "$GATE8"
  [ "$status" -eq 0 ] || { echo "gate-8 lost its GATE_SCOPE read"; return 1; }
  run grep -q 'GATE_SCOPE' "$GATE10_PKG"
  [ "$status" -eq 0 ] || { echo "gate-10 diverges from gate-8"; return 1; }
}
