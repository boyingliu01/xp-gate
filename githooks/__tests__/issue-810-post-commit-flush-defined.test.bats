#!/usr/bin/env bats

# @test REQ-AUDIT-001
# @intent The post-commit audit flush must degrade quietly when no JS runtime is
#         reachable. `_flush` was defined only inside the node/npx branches while
#         the drain loop called it unconditionally, so a PATH without either gave
#         `_flush: command not found` on every commit and lost the audit rows
#         (measured in #810, first noticed while replaying commits in a rebase).
# @covers AC-810-01
# @covers AC-810-02
#
# The subtlety this pins: "no runtime available" and "nothing to flush" must look
# the same from the outside. Both are ordinary outcomes of a reflushing hook, and
# neither may print. Only a MISSING FUNCTION makes noise, which is why the fix is
# a default definition rather than a guard around the call site: a guard would
# have to be duplicated for every future call, and the next editor would miss one.

SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

setup() {
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"
  # The developer machine sets a GLOBAL core.hooksPath pointing at the installed
  # copy, so a bare `git commit` inside the fixture would run the real gate suite
  # instead of creating the fixture commit. Point it at an empty dir: the hook
  # under test is invoked explicitly below, not through git.
  mkdir -p "$TEST_DIR/empty-hooks"
  git config core.hooksPath "$TEST_DIR/empty-hooks"

  # The hook only flushes when the audit module is present, so the fixture
  # reproduces the xp-gate checkout layout rather than a consumer repo.
  mkdir -p src/npm-package/lib
  echo "// fixture" > src/npm-package/lib/gate-audit.ts

  cp "$SOURCE_GITHOOKS/post-commit" ./post-commit
  chmod +x ./post-commit

  echo "init" > README.md
  git add README.md
  git commit -q -m "init"  # core.hooksPath pinned to an empty dir in setup
}

teardown() {
  cd /
  rm -rf "$TEST_DIR"
}

# Build a PATH with every directory that does NOT provide node or npx. Stubs do
# not work here: `command -v npx` succeeds for an executable stub even when the
# stub itself exits 127, so the hook would take the npx branch and define
# `_flush` -- recreating the exact bug in the fixture and making the test pass
# vacuously. The branch under test is chosen by `command -v`, so the binary has to
# be genuinely absent. git must survive, hence filtering rather than emptying.
_runtime_free_path() {
  local out="" dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    if [ -x "$dir/node" ] || [ -x "$dir/node.exe" ] || [ -x "$dir/npx" ] || [ -x "$dir/npx.exe" ]; then
      continue
    fi
    out="$out:$dir"
  done <<< "$(printf '%s' "$PATH" | tr ':' '\n')"
  printf '%s' "${out#:}"
}

# ── AC-810-01: no runtime → the hook stays silent ────────────────────

@test "AC-810-01: the hook does not print 'command not found' without node or npx" {
  local safe_path
  safe_path="$(_runtime_free_path)"
  run env PATH="$safe_path" ./post-commit
  [ "$status" -eq 0 ]
  [[ "$output" != *"command not found"* ]]
  [[ "$output" != *"_flush"* ]]
}

# ── AC-810-02: anti-vacuity — the hook really did reach the drain loop ─

# Without this, a fix that simply exited early before the loop would also satisfy
# AC-810-01. The drain only runs when the audit module exists; deleting it must
# change the code path, and the observable proof is that the bypass detector
# (the hook's other job) still reports on a hook-less commit.
@test "AC-810-02: the same hook still performs its other job (bypass detection)" {
  local safe_path
  safe_path="$(_runtime_free_path)"
  run env PATH="$safe_path" ./post-commit
  [ "$status" -eq 0 ]
  [ -f .xp-gate/bypass-audit.jsonl ]
  grep -q 'no-verify\|bypass' .xp-gate/bypass-audit.jsonl
}
