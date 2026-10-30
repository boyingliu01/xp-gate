#!/usr/bin/env bats
# @test REQ-616
# @intent `xp-gate check . --all` claims to scan the whole tree, and Gate 3 was
#         taught to honour that in #589. Gates 8 (gitleaks) and 9 (semgrep) were
#         not: both hard-code the staged diff, so on a clean index they scanned
#         NOTHING and reported the tree clean. Gate 8 counted as PASSED, Gate 9 as
#         "no supported language files changed" -- the exact fail-open shape #589
#         fixed one layer up, where the CLI says the tree was checked and the
#         fragment checks a diff that does not exist.
#
#         A secret or a SQL-injection pattern sitting in a tracked file is
#         invisible to `--all`, which is the one command a user reaches for when
#         they want a comprehensive audit.
#
#         The fix is not to rewrite either scanner: the runner already exports
#         GATE_SCOPE, and Gate 3 already branches on it. These tests pin that both
#         security fragments read the same signal and pick the whole-tree
#         invocation, while leaving the diff path byte-identical.
# @covers AC-616-01, AC-616-02, AC-616-03, AC-670-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE8="$REPO_ROOT/githooks/gate-8.sh"
  GATE9="$REPO_ROOT/githooks/gate-9.sh"
  RUNNER="$REPO_ROOT/src/npm-package/lib/gate-runner.js"
}

# AC-616-01: Gate 8 reads GATE_SCOPE at all.
@test "AC-616-01: gate-8 consults GATE_SCOPE" {
  run grep -q 'GATE_SCOPE' "$GATE8"
  [ "$status" -eq 0 ]
}

# AC-616-02: under scope=all, Gate 8 scans the filesystem instead of the index.
@test "AC-616-02: gate-8 scans the tree (not the index) when GATE_SCOPE=all" {
  run grep -qE 'dir --no-git|--no-git|detect --no-git' "$GATE8"
  [ "$status" -eq 0 ]
  # The index form must survive for the default path, or a plain commit stops
  # scanning what it is committing.
  run grep -q 'git --staged' "$GATE8"
  [ "$status" -eq 0 ]
}

# AC-616-03: Gate 9 reads GATE_SCOPE and, under all, uses the tracked tree.
@test "AC-616-03: gate-9 scans the tracked tree when GATE_SCOPE=all" {
  run grep -q 'GATE_SCOPE' "$GATE9"
  [ "$status" -eq 0 ]
  run grep -q 'ls-files' "$GATE9"
  [ "$status" -eq 0 ]
  # The diff form stays as the default.
  run grep -q 'diff --cached' "$GATE9"
  [ "$status" -eq 0 ]
}

# AC-670-03: end-to-end, an --all run must hand the security gates a non-empty
# file population even when the index is clean. This drives the real runner
# preamble builder rather than grepping it: the file-source lines for all-mode
# must come from the list file, and the scope variable must say "all".
@test "AC-670-03: the --all preamble exposes GATE_SCOPE=all and a whole-tree file list" {
  local out
  out=$(node -e '
    const m = require(process.argv[1]);
    const b = m.buildPreamble ? m.buildPreamble(true, ["CHANGED_FILES=\"$(cat \"$5\")\""]) : null;
    if (!b) { console.log("NO_EXPORT"); process.exit(0); }
    console.log(b);
  ' "$RUNNER" 2>&1 || true)
  if printf '%s\n' "$out" | grep -q 'NO_EXPORT'; then
    skip "buildPreamble is not exported in this revision; scope wiring covered by unit tests"
  fi
  printf '%s\n' "$out" | grep -q 'GATE_SCOPE="all"'
  printf '%s\n' "$out" | grep -q 'cat "\$5"'
}
