#!/usr/bin/env bats

# @test REQ-TDD-004
# @intent Verify Gate 5a-BLOCK behavior for new TypeScript files
# @covers AC-TDD-001-01 through AC-TDD-001-14
#
# Test matrix:
#   - New .ts file without test → BLOCK
#   - New .ts file with test → PASS
#   - Modified .ts file without test → WARNING (not blocked)
#   - Exempt files (index.ts, types.ts, etc.) → PASS
#   - @no-test-required with reason >= 10 chars → PASS
#   - @no-test-required with reason < 10 chars → BLOCK
#   - @no-test (deprecated) → PASS (backward compat)
#   - Escape valve on non-main branch → PASS + audit log
#   - Escape valve on main → BLOCK
#   - Grace period → WARNING (not blocked)
#   - New .tsx file without test → BLOCK
#   - Non-TS new file → WARNING only
#   - .d.ts file → PASS (exempt)
#   - Multiple new TS files, one without test → BLOCK

# Resolve source repo — works whether BATS runs from the worktree or the main checkout
SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

setup() {
  # Create temp git repo for testing
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"

  # Copy pre-commit hook + required infrastructure
  mkdir -p .git/hooks
  cp "$SOURCE_GITHOOKS/pre-commit" .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  # adapter-common.sh is sourced by pre-commit at startup
  cp "$SOURCE_GITHOOKS/adapter-common.sh" .git/hooks/adapter-common.sh 2>/dev/null || true

  # Create initial commit so HEAD exists
  echo "init" > README.md
  git add . && git commit -q -m "init"
}

teardown() {
  rm -rf "$TEST_DIR"
}

# ── AC-TDD-001-01: New .ts file without test → BLOCK ─────────────────

@test "new .ts file without test is BLOCKED" {
  mkdir -p src
  echo "export const x = 1;" > src/foo.ts
  git add src/foo.ts
  run git commit -m "add foo"
  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED"* ]]
}

# ── AC-TDD-001-02: New .ts file with test → PASS ─────────────────────

@test "new .ts file with corresponding test PASSES" {
  mkdir -p src
  echo "export const x = 1;" > src/foo.ts
  echo "test('foo', () => {});" > src/foo.test.ts
  git add src/foo.ts src/foo.test.ts
  run git commit -m "add foo with test"
  [ "$status" -eq 0 ]
}

# ── AC-TDD-001-03: Modified .ts file without test → WARNING ──────────

@test "modified .ts file without test only WARNS" {
  mkdir -p src
  echo "export const x = 1;" > src/foo.ts
  git add src/foo.ts && git commit -q -m "add foo" --no-verify
  echo "export const y = 2;" >> src/foo.ts
  git add src/foo.ts
  run git commit -m "modify foo"
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARNING"* ]]
}

# ── AC-TDD-001-04: Exempt files (index.ts, types.ts) → PASS ──────────

@test "exempt files (index.ts, types.ts) PASS without test" {
  mkdir -p src
  echo "export {};" > src/index.ts
  echo "export type Foo = string;" > src/types.ts
  git add src/index.ts src/types.ts
  run git commit -m "add exempt files"
  [ "$status" -eq 0 ]
}

# ── AC-TDD-001-05: @no-test-required with reason >= 10 chars → PASS ──

@test "@no-test-required annotation with sufficient reason PASSES" {
  mkdir -p src
  echo "// @no-test-required: This is a configuration file that does not need tests" > src/config.ts
  git add src/config.ts
  run git commit -m "add config"
  [ "$status" -eq 0 ]
}

# ── AC-TDD-001-06: @no-test-required with reason < 10 chars → BLOCK ──

@test "@no-test-required annotation with short reason is BLOCKED" {
  mkdir -p src
  echo "// @no-test-required: short" > src/config.ts
  git add src/config.ts
  run git commit -m "add config"
  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED"* ]]
}

# ── AC-TDD-001-07: @no-test (deprecated) → PASS ──────────────────────

@test "legacy @no-test annotation PASSES (backward compat)" {
  mkdir -p src
  echo "// @no-test" > src/legacy.ts
  git add src/legacy.ts
  run git commit -m "add legacy"
  [ "$status" -eq 0 ]
}

# ── AC-TDD-001-08: Escape valve on non-main branch → PASS + audit ────

@test "SKIP_GATE_5A_BLOCK=1 on feature branch PASSES with audit log" {
  git checkout -q -b feature/test
  mkdir -p src
  echo "export const x = 1;" > src/foo.ts
  git add src/foo.ts
  export SKIP_GATE_5A_BLOCK=1
  export SKIP_GATE_5A_BLOCK_REASON="testing escape valve"
  run git commit -m "add foo with escape"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ESCAPE VALVE"* ]]
  [ -f ".xp-gate/reports/escape-valve-log.json" ]
}

# ── AC-TDD-001-09: Escape valve on main → BLOCK ──────────────────────

@test "SKIP_GATE_5A_BLOCK=1 on main branch is BLOCKED" {
  mkdir -p src
  echo "export const x = 1;" > src/foo.ts
  git add src/foo.ts
  export SKIP_GATE_5A_BLOCK=1
  run git commit -m "add foo"
  [ "$status" -ne 0 ]
  [[ "$output" == *"ESCAPE VALVE BLOCKED"* ]]
}

# ── AC-TDD-001-10: Grace period → WARNING (not blocked) ──────────────

@test ".tdd-adoption.yaml gracePeriod downgrades BLOCK to WARNING" {
  mkdir -p src
  # gracePeriod > 0 triggers TDD_BLOCK_DOWNGRADE which downgrades BLOCK → WARNING
  printf 'enabled: true\ngracePeriod: 10\n' > .tdd-adoption.yaml
  echo "export const x = 1;" > src/foo.ts
  git add .tdd-adoption.yaml src/foo.ts
  run git commit -m "add foo with grace"
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARNING"* ]] || [[ "$output" == *"downgraded"* ]]
}

# ── AC-TDD-001-11: New .tsx file without test → BLOCK ────────────────

@test "new .tsx file without test is BLOCKED" {
  mkdir -p src
  echo "export const App = () => <div/>;" > src/App.tsx
  git add src/App.tsx
  run git commit -m "add App"
  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED"* ]]
}

# ── AC-TDD-001-12: Non-TS new file → WARNING only ────────────────────

@test "new Python file without test only WARNS" {
  mkdir -p src
  echo "def foo(): pass" > src/foo.py
  git add src/foo.py
  run git commit -m "add foo.py"
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARNING"* ]]
}

# ── AC-TDD-001-13: .d.ts file → PASS (exempt) ────────────────────────

@test ".d.ts declaration file PASSES without test" {
  mkdir -p src
  echo "declare module 'foo' {}" > src/foo.d.ts
  git add src/foo.d.ts
  run git commit -m "add declaration"
  [ "$status" -eq 0 ]
}

# ── AC-TDD-001-14: Multiple new TS files, one missing test → BLOCK ───

@test "multiple new TS files with one missing test BLOCKS" {
  mkdir -p src
  echo "export const x = 1;" > src/foo.ts
  echo "test('foo', () => {});" > src/foo.test.ts
  echo "export const y = 2;" > src/bar.ts
  git add src/foo.ts src/foo.test.ts src/bar.ts
  run git commit -m "add foo and bar"
  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED"* ]]
  [[ "$output" == *"bar.ts"* ]]
}
