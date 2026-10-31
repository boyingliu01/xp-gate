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
  # AC-TDD-001-12 stages a .py file, which routes Gate 5's coverage section at
  # pytest; that section fail-closes on a missing required tool by design, so a
  # fixture would otherwise pass or fail according to the machine's python
  # toolchain instead of according to Gate 5a. Same reason as the jscpd stub
  # above: the tool is stubbed, not assumed (#497).
  cat > "$TEST_DIR/bin/pytest" << 'MOCK'
#!/bin/bash
echo "3 passed in 0.01s"
exit 0
MOCK
  chmod +x "$TEST_DIR/bin/pytest"
  export PATH="$TEST_DIR/bin:$PATH"

  # Copy pre-commit hook + required infrastructure
  mkdir -p .git/hooks
  cp "$SOURCE_GITHOOKS/pre-commit" .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  # adapter-common.sh is sourced by pre-commit at startup
  cp "$SOURCE_GITHOOKS/adapter-common.sh" .git/hooks/adapter-common.sh 2>/dev/null || true
  # #548 added a second startup file beside adapter-common.sh. A fixture that
  # copies only the first one dies at that FATAL and every assertion in the suite
  # then tests a crashed hook instead of Gate 5a -- #497's failure mode, one
  # file later.
  cp "$SOURCE_GITHOOKS/hook-module-resolution.sh" .git/hooks/hook-module-resolution.sh 2>/dev/null || true
  # pre-commit sources lib/*.sh at runtime (#449), so a fixture that installs
  # only the hook file dies at the source line and every assertion in this suite
  # then tests a crashed hook (#497).
  mkdir -p .git/hooks/lib
  for lib_file in "$SOURCE_GITHOOKS"/lib/*.sh; do
    [ -f "$lib_file" ] && cp "$lib_file" .git/hooks/lib/
  done

  # Create initial commit so HEAD exists (include a .ts file so hook detects TypeScript project)
  echo "init" > README.md
  mkdir -p src
  echo '// @no-test-required: test infrastructure placeholder
export const placeholder = true;' > src/placeholder.ts
  # Minimal archlint config so Gate 6 doesn't block on missing config
  echo "ignore: []" > .archlint.yaml
  # Gate 5 BLOCKS when coverage/coverage-summary.json is absent ("not found" is
  # not "clean"). Whether that file exists in the fixture used to depend on
  # whether the HOST checkout happened to have run vitest: green locally with a
  # stale coverage/ dir, red on every CI runner (#497's failure mode, one gate
  # later). The suite is about Gate 5a, so it supplies the coverage artefact it
  # needs instead of inheriting one.
  mkdir -p coverage
  cat > coverage/coverage-summary.json << 'COVERAGE'
{
  "total": {
    "lines":      { "pct": 90 },
    "statements": { "pct": 90 },
    "functions":  { "pct": 90 },
    "branches":   { "pct": 90 }
  }
}
COVERAGE
  # The Python branch of Gate 5 does not read coverage.xml: it runs
  # `coverage report --format=total` against a .coverage database, and since #570
  # an unreadable one BLOCKS instead of warning. Staging a .py file routes Gate 5
  # there, so the fixture stubs `coverage` the same way it already stubs jscpd,
  # pytest and ruff — the tool is stubbed, not assumed (#497).
  cat > "$TEST_DIR/bin/coverage" << 'MOCK'
#!/bin/bash
# Only `report --format=total` is needed: it prints a bare number (coverage.py
# 7.x), which is exactly the shape parse_coverage_total expects.
echo "90"
exit 0
MOCK
  chmod +x "$TEST_DIR/bin/coverage"
  # A present .coverage is what makes the hook consult the stub at all.
  echo "stub" > .coverage
  git add . && git commit --no-verify -q -m "init"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Run the fixture's own pre-commit hook and capture its exit status + output.
#
# Two constraints collide here:
#   - fixture-hygiene FC-04: a fixture's `git commit` must not run the HOST hook
#     chain (that is ~12 gates per commit on a machine with xp-gate installed,
#     and makes suites look hung).
#   - this suite's purpose: Gate 5a must actually execute and be observed.
# `git commit --no-verify` satisfied the first and silently broke the second: it
# disables the very hook under test, so every assertion failed no matter what
# Gate 5a did. Invoking the fixture's hook directly satisfies both -- the host
# chain is never reached, and the hook really runs.
run_fixture_hook() {
  # The hook reads `git diff --cached`, so it must run with the fixture repo as
  # cwd -- invoking it from the wrong directory makes a staging check silently
  # observe an empty index. Default arg is the main fixture, whose cwd already is
  # that repo; the $FRESH fixtures pass their hook path and repo root explicitly.
  local hook_path="${1:-.git/hooks/pre-commit}"
  local repo_root="${2:-$PWD}"
  local out
  status=0
  # Two gates in the hook reason about the commit itself rather than about Gate
  # 5a, and either one decides the outcome of every case in this suite:
  #   - Gate 0 blocks production source on a protected branch without a
  #     VERSION/CHANGELOG bump. This fixture is a throwaway repo whose only job
  #     is to exercise Gate 5a, so it takes the supported escape hatch.
  #   - Gate 5d rejects tautological assertions, so the fixture tests below must
  #     assert something that can actually fail.
  out=$(cd "$repo_root" && SKIP_VERSION_CHECK=1 "$repo_root/$hook_path" 2>&1) || status=$?
  output="$out"
}

# ── AC-TDD-001-01: New .ts file without test → BLOCK ─────────────────

@test "new .ts file without test is BLOCKED" {
  mkdir -p src
  echo "export const x = 1;" > src/foo.ts
  git add src/foo.ts
  run_fixture_hook
  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED"* ]]
}

# ── AC-TDD-001-02: New .ts file with test → PASS ─────────────────────

@test "new .ts file with corresponding test PASSES" {
  mkdir -p src
  echo "export const x = 1;" > src/foo.ts
  # vitest defaults to `globals: false` and this fixture ships no config, so a
  # bare test() is a ReferenceError at collection time. That fixture blocked on
  # Gate 5 ("Tests FAILED") instead of proving Gate 5a lets the commit through.
  printf "import { expect, test } from 'vitest';\ntest('foo', () => { expect(1 + 1).toBe(2); });\n" > src/foo.test.ts
  git add src/foo.ts src/foo.test.ts
  run_fixture_hook
  [ "$status" -eq 0 ]
}

# ── AC-TDD-001-03: Modified .ts file without test → WARNING ──────────

@test "modified .ts file without test only WARNS" {
  mkdir -p src
  echo "export const x = 1;" > src/foo.ts
  git add src/foo.ts && git commit -q -m "add foo" --no-verify
  echo "export const y = 2;" >> src/foo.ts
  git add src/foo.ts
  run_fixture_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARNING"* ]]
}

# ── AC-TDD-001-04: Exempt files (index.ts, types.ts) → PASS ──────────

@test "exempt files (index.ts, types.ts) PASS without test" {
  mkdir -p src
  echo "export {};" > src/index.ts
  echo "export type Foo = string;" > src/types.ts
  git add src/index.ts src/types.ts
  run_fixture_hook
  [ "$status" -eq 0 ]
}

# ── AC-TDD-001-05: @no-test-required with reason >= 10 chars → PASS ──

@test "@no-test-required annotation with sufficient reason PASSES" {
  mkdir -p src
  echo "// @no-test-required: This is a configuration file that does not need tests" > src/config.ts
  git add src/config.ts
  run_fixture_hook
  [ "$status" -eq 0 ]
}

# ── AC-TDD-001-06: @no-test-required with reason < 10 chars → BLOCK ──

@test "@no-test-required annotation with short reason is BLOCKED" {
  mkdir -p src
  echo "// @no-test-required: short" > src/config.ts
  git add src/config.ts
  run_fixture_hook
  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED"* ]]
}

# ── AC-TDD-001-07: @no-test (deprecated) → PASS ──────────────────────

@test "legacy @no-test annotation PASSES (backward compat)" {
  mkdir -p src
  echo "// @no-test" > src/legacy.ts
  git add src/legacy.ts
  run_fixture_hook
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
  run_fixture_hook
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
  cp "$SOURCE_GITHOOKS/hook-module-resolution.sh" "$FRESH/.git/hooks/hook-module-resolution.sh" 2>/dev/null || true
  # lib/*.sh are sourced at runtime too (#449), and this fixture's hook exits at
  # the first missing one -- so every assertion below would test a crashed hook.
  mkdir -p "$FRESH/.git/hooks/lib"
  for lib_file in "$SOURCE_GITHOOKS"/lib/*.sh; do
    [ -f "$lib_file" ] && cp "$lib_file" "$FRESH/.git/hooks/lib/"
  done
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
  run_fixture_hook .git/hooks/pre-commit "$FRESH"
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
  run_fixture_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARNING"* ]] || [[ "$output" == *"downgraded"* ]]
}

# ── AC-TDD-001-11: New .tsx file without test → BLOCK ────────────────

@test "new .tsx file without test is BLOCKED" {
  mkdir -p src
  echo "export const App = () => <div/>;" > src/App.tsx
  git add src/App.tsx
  run_fixture_hook
  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED"* ]]
}

# ── AC-TDD-001-12: Non-TS new file → WARNING only ────────────────────

@test "new Python file without test only WARNS" {
  mkdir -p src
  # Staging a .py routes Gates 1/5 at the Python toolchain, and `def foo(): pass`
  # on one line fails `ruff format --check` -- Gate 1 then blocks the commit and
  # Gate 5a is never reached, so the test asserted Gate 5a behaviour it never
  # exercised. Format-clean source plus stub formatters keep the assertion on
  # Gate 5a, which is what this test names.
  printf 'def foo():\n    pass\n' > src/foo.py
  cat > bin/ruff << 'MOCK'
#!/bin/bash
exit 0
MOCK
  chmod +x bin/ruff
  git add src/foo.py
  run_fixture_hook
  [ "$status" -eq 0 ] || {
    echo "Gate 5a/5 blocked the commit instead of warning: exit=$status"
    printf '%s\n' "$output" | grep -E 'BLOCK|❌|Gate [0-9]+:' | head -20
    return 1
  }
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
  cp "$SOURCE_GITHOOKS/hook-module-resolution.sh" "$FRESH/.git/hooks/hook-module-resolution.sh" 2>/dev/null || true
  # lib/*.sh are sourced at runtime too (#449); without them this hook exits
  # before reaching Gate 5a and the assertion below tests a crash.
  mkdir -p "$FRESH/.git/hooks/lib"
  for lib_file in "$SOURCE_GITHOOKS"/lib/*.sh; do
    [ -f "$lib_file" ] && cp "$lib_file" "$FRESH/.git/hooks/lib/"
  done
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
  # Gate 5 BLOCKS when coverage/coverage-summary.json is absent (#570: "not found"
  # is not "clean"). A $FRESH repo carries no coverage pass, so it states the
  # coverage it needs — same as the main fixture in setup().
  mkdir -p "$FRESH/coverage"
  cat > "$FRESH/coverage/coverage-summary.json" << 'COVERAGE'
{
  "total": {
    "lines":      { "pct": 90 },
    "statements": { "pct": 90 },
    "functions":  { "pct": 90 },
    "branches":   { "pct": 90 }
  }
}
COVERAGE
  git -C "$FRESH" add .
  git -C "$FRESH" commit --no-verify -q -m "init"

  # Clean up hook artifacts from initial commit
  rm -f "$FRESH/.quality-history.jsonl"
  rm -rf "$FRESH/.xp-gate"

  # Now test: .d.ts file is exempt from Gate 5a → commit should succeed
  echo "declare module 'foo' {}" > "$FRESH/src/foo.d.ts"
  git -C "$FRESH" add src/foo.d.ts
  export PATH="$FRESH/bin:$PATH"
  run_fixture_hook .git/hooks/pre-commit "$FRESH"
  [ "$status" -eq 0 ]

  rm -rf "$FRESH"
}

# ── AC-TDD-001-14: Multiple new TS files, one missing test → BLOCK ───

@test "multiple new TS files with one missing test BLOCKS" {
  mkdir -p src
  echo "export const x = 1;" > src/foo.ts
  printf "import { expect, test } from 'vitest';\ntest('foo', () => { expect(1 + 1).toBe(2); });\n" > src/foo.test.ts
  echo "export const y = 2;" > src/bar.ts
  git add src/foo.ts src/foo.test.ts src/bar.ts
  run_fixture_hook
  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED"* ]]
  [[ "$output" == *"bar.ts"* ]]
}
