#!/usr/bin/env bats
# @test REQ-450
# @intent AC-450-01..03 anchor the Gate 0 hint text, so the things the hint
#         promises (what clears the gate, the tooling-only carve-out, the real
#         escape hatch) cannot drift away from what Gate 0 actually enforces
#         while every test stays green (Round 2 architecture MA-01).
# @covers AC-450-04
#
# REWRITTEN for #624. The old version extracted the `# Check for bypass: commit
# message prefix` block out of pre-commit with awk and evaluated it against a
# hand-written COMMIT_EDITMSG. That fixture encoded exactly the state git never
# provides — at pre-commit time the message does not exist — so the tests passed
# while the shipped bypass was permanently dead. #624 removed the message-prefix
# bypass altogether (pre-commit runs before git builds the message, so the hook
# can never see it) and made build-tooling-only commits pass on their own.
#
# These tests therefore assert on REAL `git commit` exit codes, not on an
# extracted block. There is no longer a message prefix to drift, so the drift
# surface REQ-450 cares about is now: "does the hint describe what the code does,
# and does the code still do it?" Both halves are pinned below.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT_COPY="$REPO_ROOT/githooks/pre-commit"
  FIXTURE_REPO="$(mktemp -d)"
  (
    cd "$FIXTURE_REPO" || exit 1
    git init -q -b master
    git config user.email test@test.com
    git config user.name Test
    git config core.hooksPath .git/hooks
    mkdir -p .git/hooks
    cp "$PRE_COMMIT_COPY" .git/hooks/pre-commit
    cp "$REPO_ROOT/githooks/adapter-common.sh" .git/hooks/ 2>/dev/null || true
    cp "$REPO_ROOT/githooks/gate-"*.sh .git/hooks/ 2>/dev/null || true
    cp "$REPO_ROOT/githooks/sprint-gate.sh" .git/hooks/ 2>/dev/null || true
    cp -r "$REPO_ROOT/githooks/lib" .git/hooks/ 2>/dev/null || true
    cp -r "$REPO_ROOT/githooks/adapters" .git/hooks/ 2>/dev/null || true
    cp "${XP_GATE_MODULE_RESOLUTION:-$HOME/.config/xp-gate/hooks/hook-module-resolution.sh}" .git/hooks/ 2>/dev/null || true
    # Strip CRLF so bash can parse the copied hook (the #546 guard rejects CRLF).
    for h in .git/hooks/*.sh .git/hooks/pre-commit; do
      [ -f "$h" ] || continue
      tr -d '\r' < "$h" > "$h.lf" && mv "$h.lf" "$h" && chmod +x "$h"
    done
    chmod +x .git/hooks/pre-commit
    printf 'x = 1\n' > a.py
    echo '1.0.0' > VERSION
    echo '# changelog' > CHANGELOG.md
    git add -A
    git commit --no-verify -q -m seed
  )
}

teardown() {
  rm -rf "$FIXTURE_REPO"
}

@test "AC-450-04: build-tooling-only commit passes Gate 0 with no marker (defect 2 of #624)" {
  cd "$FIXTURE_REPO" || return 1
  mkdir -p scripts
  printf '# tool\n' > scripts/tool.py
  git add -A
  run git commit -m "chore: resync tooling"  # core.hooksPath pinned in setup
  [[ "$output" == *"build-tooling-only changes"* ]]
  [[ "$output" != *"VERSION/CHANGELOG update"* ]]
}

@test "AC-450-04: production source without a version bump is still BLOCKED" {
  cd "$FIXTURE_REPO" || return 1
  printf 'x = 2\n' > a.py
  git add -A
  run git commit -m "[skip-version-check] chore: pretend bypass"  # core.hooksPath pinned in setup
  [ "$status" -ne 0 ]
  # The message wraps across two lines ("without a" then
  # "VERSION/CHANGELOG update"), so match the stable second half.
  # stable second half rather than the cross-line phrase.
  [[ "$output" == *"VERSION/CHANGELOG update"* ]]
}

@test "AC-450-04: the hint points at the env var, not the dead message prefix" {
  # The doc contract moved: a message prefix is gone; the env var is the
  # supported escape hatch. If a future edit reintroduces the prefix promise
  # without reintroducing a mechanism, this fails.
  run grep -q 'SKIP_VERSION_CHECK=1 '"'g'"'it commit' "$PRE_COMMIT_COPY"
  [ "$status" -eq 0 ]
  # And it must NOT advertise the dead COMMIT_EDITMSG-derived prefix as working.
  run grep -q '\[skip-version-check\] chore: <description>' "$PRE_COMMIT_COPY"
  [ "$status" -ne 0 ]
}

@test "AC-450-04: SKIP_VERSION_CHECK=1 still skips Gate 0 (the real escape hatch)" {
  cd "$FIXTURE_REPO" || return 1
  printf 'x = 3\n' > a.py
  git add -A
  run env SKIP_VERSION_CHECK=1 git commit -m "feat: force through"  # core.hooksPath pinned in setup
  [[ "$output" == *"SKIPPED - Gate 0"* ]]
  [[ "$output" != *"VERSION/CHANGELOG update"* ]]
}

@test "AC-450-04 anti-vacuity: pre-commit no longer READS COMMIT_EDITMSG" {
  # The read that made the bypass impossible. Reintroducing it re-breaks #624.
  # `COMMIT_EDITMSG` may still appear in an explanatory comment, so strip comment
  # lines first and assert the executable code never mentions it.
  run bash -c "grep -v '^[[:space:]]*#' \"$PRE_COMMIT_COPY\" | grep -c 'COMMIT_EDITMSG' || true"
  [ "$output" = "0" ]
}

@test "AC-450-04 anti-vacuity: has_real_source actually drives the branch decision" {
  # Defect 2 of #624: the variable was computed and ignored. Pin both its
  # computation and its use as a branch condition.
  run grep -q 'elif \[ "$has_real_source" = "false" \]' "$PRE_COMMIT_COPY"
  [ "$status" -eq 0 ]
}
