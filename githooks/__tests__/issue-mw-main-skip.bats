#!/usr/bin/env bats
# Gate MW (code walkthrough) must skip on main/master, exactly as Gate ML and
# Gate UI do. githooks/AGENTS.md has documented this skip for years while the
# code never implemented it, so every release commit was judged by a review that
# could not have covered it — the release commit changes no reviewed code, yet
# demanded a fresh three-model sweep bound to its own hash.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_PUSH="$REPO_ROOT/githooks/pre-push"
}

@test "pre-push has a main/master skip guard for Gate MW" {
  run grep -n 'Gate MW skipped' "$PRE_PUSH"
  [ "$status" -eq 0 ]
}

@test "the Gate MW skip tests both main and master" {
  # A guard that only knew "main" would silently stop skipping on repos that
  # still call their default branch master.
  run grep -n 'CURRENT_BRANCH" = "master"' "$PRE_PUSH"
  [ "$status" -eq 0 ]
}

@test "the Gate MW skip sits before the result-file requirement" {
  # Order matters: if the required-file check ran first, a missing evidence file
  # would still block a main-branch push before the skip was ever reached.
  local skip_line required_line
  skip_line=$(grep -n 'Gate MW skipped' "$PRE_PUSH" | cut -d: -f1)
  required_line=$(grep -n 'GATE MW: CODE WALKTHROUGH REQUIRED' "$PRE_PUSH" | cut -d: -f1)
  [ -n "$skip_line" ]
  [ -n "$required_line" ]
  [ "$skip_line" -lt "$required_line" ]
}

@test "pre-push still parses after the guard was added" {
  run bash -n "$PRE_PUSH"
  [ "$status" -eq 0 ]
}

@test "feature branches still enforce Gate MW (no accidental global skip)" {
  # The guard must be conditional. A bare top-level skip would disarm the gate
  # everywhere, which is strictly worse than the drift being fixed.
  run grep -c 'else' "$PRE_PUSH"
  [ "$status" -eq 0 ]
  run grep -n 'RESULT_FILE=".code-walkthrough-result.json"' "$PRE_PUSH"
  [ "$status" -eq 0 ]
}

@test "a skipped gate is not reported as VERIFIED" {
  # Measured on the real run: the old banner printed "GATE MW: CODE WALKTHROUGH
  # VERIFIED" and "Verdict: APPROVED" immediately after announcing the skip.
  # Claiming a check passed when it never ran is the exact dishonesty Gate MW
  # exists to prevent, so the banner is now driven by an explicit flag.
  run grep -n 'MW_SKIPPED=1' "$PRE_PUSH"
  [ "$status" -eq 0 ]
  run grep -n 'GATE MW: CODE WALKTHROUGH SKIPPED' "$PRE_PUSH"
  [ "$status" -eq 0 ]
}

@test "the verified banner is guarded by the skip flag" {
  local banner_line guard_line
  guard_line=$(grep -n 'if \[ "$MW_SKIPPED" = "1" \]' "$PRE_PUSH" | cut -d: -f1)
  banner_line=$(grep -n 'GATE MW: CODE WALKTHROUGH VERIFIED' "$PRE_PUSH" | cut -d: -f1)
  [ -n "$guard_line" ]
  [ -n "$banner_line" ]
  [ "$guard_line" -lt "$banner_line" ]
}
