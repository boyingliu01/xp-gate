#!/usr/bin/env bats
#
# @test REQ-GATE-PROBE-SHORTCUT The static guard against npx probes must be able to fail
# @intent A guard that cannot fail when the defect is present is worse than no guard:
#         it certifies the very thing it was supposed to check. The first version of
#         scripts/check-no-npx-probe.sh did exactly that -- it filtered comments with
#         a regex that also dropped code lines, so an injected
#         `if npx vitest --version; then` was reported as clean.
#
#         These tests exercise the guard the same way it failed: plant the defect,
#         expect a non-zero exit and the offending file:line in the message. The
#         anti-vacuity case (a file with no probe must PASS) runs too, because a
#         guard that always fails would satisfy the others.
#
# @covers AC-PROBE-LOCAL-05 a real npx probe in a hook source is caught
# @covers AC-PROBE-LOCAL-06 comments and the gated opt-in are not false positives
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GUARD="$REPO_ROOT/scripts/check-no-npx-probe.sh"
  WORK="$(mktemp -d)"
  # The guard scans repo-relative paths, so run it from a sandbox that mimics the
  # layout instead of mutating the real tree (a test that edits githooks/ would
  # race every other suite).
  mkdir -p "$WORK/githooks/lib" "$WORK/githooks/adapters"
  cp "$REPO_ROOT/githooks/adapter-common.sh" "$WORK/githooks/" 2>/dev/null || printf '\n' > "$WORK/githooks/adapter-common.sh"
  printf '\n' > "$WORK/githooks/pre-commit"
  printf '\n' > "$WORK/githooks/pre-push"
  printf '\n' > "$WORK/githooks/post-commit"
  printf '\n' > "$WORK/githooks/post-merge"
  printf '\n' > "$WORK/githooks/adapters/typescript.sh"
  printf '\n' > "$WORK/githooks/lib/typecheck.sh"
  # toolchain-path.sh is required by the guard's final assertion (it owns the
  # gated opt-in), so the sandbox must carry it even in "clean" cases.
  printf '\n' > "$WORK/githooks/lib/toolchain-path.sh"
  mkdir -p "$WORK/scripts"
  cp "$GUARD" "$WORK/scripts/check-no-npx-probe.sh"
}

teardown() {
  rm -rf "$WORK"
}

run_guard() {
  run bash -c "cd '$WORK' && bash scripts/check-no-npx-probe.sh"
}

@test "AC-PROBE-LOCAL-06: a clean tree passes (anti-vacuity for the guard itself)" {
  run_guard
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASS"* ]]
}

@test "AC-PROBE-LOCAL-05: a bare npx probe in an adapter is caught" {
  cat > "$WORK/githooks/adapters/typescript.sh" <<'SH'
#!/bin/bash
if npx vitest --version >/dev/null 2>&1; then
  echo "runner available"
fi
SH
  run_guard
  [ "$status" -ne 0 ]
  [[ "$output" == *"typescript.sh"* ]]
}

@test "AC-PROBE-LOCAL-05: npx --no-install is caught too" {
  # The whole point: --no-install prevents the install, not the registry query.
  cat > "$WORK/githooks/lib/typecheck.sh" <<'SH'
#!/bin/bash
if npx --no-install stryker --version >/dev/null 2>&1; then
  return 0
fi
SH
  run_guard
  [ "$status" -ne 0 ]
  [[ "$output" == *"typecheck.sh"* ]]
}

@test "AC-PROBE-LOCAL-05: a probe in pre-commit itself is caught" {
  cat > "$WORK/githooks/pre-commit" <<'SH'
#!/bin/bash
elif (cd "$PROJECT_ROOT" && npx @archlinter/cli --version) >/dev/null 2>&1; then
  ARCHLINT_KIND="npx"
SH
  run_guard
  [ "$status" -ne 0 ]
  [[ "$output" == *"pre-commit"* ]]
}

@test "AC-PROBE-LOCAL-06: a commented-out probe is not reported" {
  # Every touched file explains WHY the old form is gone. Flagging an explanation
  # as the defect teaches the next reader to ignore the guard.
  cat > "$WORK/githooks/adapters/typescript.sh" <<'SH'
#!/bin/bash
# A previous version probed with: npx vitest --version
# which downloaded the runner. Never again.
SH
  run_guard
  [ "$status" -eq 0 ]
}

@test "AC-PROBE-LOCAL-06: deleting the opt-in guard is caught" {
  # toolchain-path.sh is the one file allowed to run an npx probe, because it owns
  # probe_npx_enabled. If that condition disappears the hole reopens while the
  # file remains allowlisted, so the gating is asserted separately.
  cat > "$WORK/githooks/lib/toolchain-path.sh" <<'SH'
#!/bin/bash
probe_archlint_available() {
  (cd "$1" && npx @archlinter/cli --version) >/dev/null 2>&1
}
SH
  run_guard
  [ "$status" -ne 0 ]
  [[ "$output" == *"probe_npx_enabled"* ]]
}

@test "AC-PROBE-LOCAL-06: the gated opt-in itself is allowed" {
  cat > "$WORK/githooks/lib/toolchain-path.sh" <<'SH'
#!/bin/bash
probe_archlint_available() {
  if probe_npx_enabled && command -v npx >/dev/null 2>&1; then
    (cd "$1" && npx @archlinter/cli --version) >/dev/null 2>&1
    return $?
  fi
  return 1
}
SH
  run_guard
  [ "$status" -eq 0 ]
}
