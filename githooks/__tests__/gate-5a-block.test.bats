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
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"
  git config core.hooksPath .git/hooks

  # Create mock jscpd so Gate 2 doesn't block on missing tool
  mkdir -p "$TEST_DIR/bin"
  cat > "$TEST_DIR/bin/jscpd" << 'MOCK'
#!/bin/bash
echo '{"duplicates":[]}'
exit 0
MOCK
  chmod +x "$TEST_DIR/bin/jscpd"
  export PATH="$TEST_DIR/bin:$PATH"

  # Copy pre-commit hook + required infrastructure
  mkdir -p .git/hooks
  cp "$SOURCE_GITHOOKS/pre-commit" .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  # adapter-common.sh is sourced by pre-commit at startup
  cp "$SOURCE_GITHOOKS/adapter-common.sh" .git/hooks/adapter-common.sh 2>/dev/null || true

  # Create initial commit so HEAD exists (include a .ts file so hook detects TypeScript project)
  echo "init" > README.md
  mkdir -p src
  echo '// @no-test-required: test infrastructure placeholder
export const placeholder = true;' > src/placeholder.ts
  # Minimal archlint config so Gate 6 doesn't block on missing config
  echo "ignore: []" > .archlint.yaml
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
  # Self-contained test: create a fresh repo on "main" to avoid dirty-tree
  # branch-switch issues from hook-generated artifacts in setup().
  local FRESH
  FRESH=$(mktemp -d)
  git init -q -b main "$FRESH"
  git -C "$FRESH" config user.email "test@test.com"
  git -C "$FRESH" config user.name "Test"

  # Copy hook + adapter infrastructure
  mkdir -p "$FRESH/.git/hooks"
  cp "$SOURCE_GITHOOKS/pre-commit" "$FRESH/.git/hooks/pre-commit"
  chmod +x "$FRESH/.git/hooks/pre-commit"
  cp "$SOURCE_GITHOOKS/adapter-common.sh" "$FRESH/.git/hooks/adapter-common.sh" 2>/dev/null || true
  # Use absolute path — relative ".git/hooks" resolves relative to .git/ dir, not working tree
  git -C "$FRESH" config core.hooksPath "$FRESH/.git/hooks"

  # Mock jscpd + lizard so Gate 2/3 don't block
  mkdir -p "$FRESH/bin"
  cat > "$FRESH/bin/jscpd" << 'MOCK'
#!/bin/bash
echo '{"duplicates":[]}'
exit 0
MOCK
  cat > "$FRESH/bin/lizard" << 'MOCK'
#!/bin/bash
echo "0"
exit 0
MOCK
  chmod +x "$FRESH/bin/jscpd" "$FRESH/bin/lizard"

  # Initial commit with package.json (so PROJECT_LANG=typescript → Gate 5a activates)
  echo '{}' > "$FRESH/package.json"
  echo "0.0.1" > "$FRESH/VERSION"
  echo "# Changelog" > "$FRESH/CHANGELOG.md"
  echo "init" > "$FRESH/README.md"
  mkdir -p "$FRESH/src"
  echo '// @no-test-required: test infrastructure placeholder
export const placeholder = true;' > "$FRESH/src/placeholder.ts"
  echo "ignore: []" > "$FRESH/.archlint.yaml"
  git -C "$FRESH" add .
  git -C "$FRESH" commit --no-verify -q -m "init"

  # Clean up hook artifacts from initial commit so tree is clean
  rm -f "$FRESH/.quality-history.jsonl"
  rm -rf "$FRESH/.xp-gate"

  # Now test: new .ts file + SKIP_GATE_5A_BLOCK=1 on main → BLOCKED
  echo "export const x = 1;" > "$FRESH/src/foo.ts"
  git -C "$FRESH" add src/foo.ts
  export SKIP_GATE_5A_BLOCK=1
  export SKIP_VERSION_CHECK=1
  export PATH="$FRESH/bin:$PATH"
  run git -C "$FRESH" commit -m "add foo"
  [ "$status" -ne 0 ]
  [[ "$output" == *"ESCAPE VALVE BLOCKED"* ]]

  rm -rf "$FRESH"
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
  # Self-contained test: needs package.json so PROJECT_LANG=typescript
  # (otherwise Gate 5a is skipped entirely as "documentation-only")
  # Use non-protected branch to avoid Gate 0 blocking on VERSION/CHANGELOG
  local FRESH
  FRESH=$(mktemp -d)
  git init -q -b test-branch "$FRESH"
  git -C "$FRESH" config user.email "test@test.com"
  git -C "$FRESH" config user.name "Test"

  mkdir -p "$FRESH/.git/hooks"
  cp "$SOURCE_GITHOOKS/pre-commit" "$FRESH/.git/hooks/pre-commit"
  chmod +x "$FRESH/.git/hooks/pre-commit"
  cp "$SOURCE_GITHOOKS/adapter-common.sh" "$FRESH/.git/hooks/adapter-common.sh" 2>/dev/null || true
  # Use absolute path — relative ".git/hooks" resolves relative to .git/ dir, not working tree
  git -C "$FRESH" config core.hooksPath "$FRESH/.git/hooks"

  # Mock jscpd + lizard so Gate 2/3 don't block
  mkdir -p "$FRESH/bin"
  cat > "$FRESH/bin/jscpd" << 'MOCK'
#!/bin/bash
echo '{"duplicates":[]}'
exit 0
MOCK
  cat > "$FRESH/bin/lizard" << 'MOCK'
#!/bin/bash
echo "0"
exit 0
MOCK
  chmod +x "$FRESH/bin/jscpd" "$FRESH/bin/lizard"

  # Initial commit with package.json (so PROJECT_LANG=typescript → Gate 5a activates)
  echo '{}' > "$FRESH/package.json"
  echo "0.0.1" > "$FRESH/VERSION"
  echo "# Changelog" > "$FRESH/CHANGELOG.md"
  echo "init" > "$FRESH/README.md"
  mkdir -p "$FRESH/src"
  echo '// @no-test-required: test infrastructure placeholder
export const placeholder = true;' > "$FRESH/src/placeholder.ts"
  echo "ignore: []" > "$FRESH/.archlint.yaml"
  git -C "$FRESH" add .
  git -C "$FRESH" commit --no-verify -q -m "init"

  # Clean up hook artifacts from initial commit
  rm -f "$FRESH/.quality-history.jsonl"
  rm -rf "$FRESH/.xp-gate"

  # Now test: .d.ts file is exempt from Gate 5a → commit should succeed
  echo "declare module 'foo' {}" > "$FRESH/src/foo.d.ts"
  git -C "$FRESH" add src/foo.d.ts
  export PATH="$FRESH/bin:$PATH"
  run git -C "$FRESH" commit -m "add declaration"
  [ "$status" -eq 0 ]

  rm -rf "$FRESH"
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
