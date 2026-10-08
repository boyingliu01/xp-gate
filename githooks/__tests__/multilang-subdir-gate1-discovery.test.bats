#!/usr/bin/env bats

# @test REQ-TDD-016
# @intent Gate 1 TypeScript half must discover tsconfig.json / biome.json in
#         the language subdirectory of a multi-language monorepo instead of
#         silently SKIPping at the repo root.
# @covers AC-TDD-016-01 through AC-TDD-016-03
#
# Regression for: in a web/ (TS) + backend/ (Python) monorepo the hook stays at
# the repo root (multi-language mode) but Gate 1 probed tsconfig.json,
# eslint/biome configs and package.json at the root only. Output was
#   "ℹ️  SKIP - tsconfig.json not found (no TypeScript project config)"
#   "ℹ️  No ESLint configuration found - Skipping"
# while web/tsconfig.json and web/biome.json existed — the TS quality half of
# Gate 1 never ran. Test matrix:
#   - tsconfig in subdir -> tsc runs from web/ (cwd-relative, #436/#470)
#   - biome.json in subdir -> Biome check runs (from web/) and PASSES
#   - root project (no subdir) -> unchanged behaviour (regression guard)

# Resolve source repo — works whether BATS runs from the worktree or the main checkout
SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

setup() {
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"
  git config core.hooksPath "$TEST_DIR/.git/hooks"

  mkdir -p "$TEST_DIR/bin"
  cat > "$TEST_DIR/bin/jscpd" <<'MOCK'
#!/bin/bash
echo '{"duplicates":[]}'
exit 0
MOCK
  cat > "$TEST_DIR/bin/lizard" <<'MOCK'
#!/bin/bash
echo "0"
exit 0
MOCK
  cat > "$TEST_DIR/bin/gitleaks" <<'MOCK'
#!/bin/bash
exit 0
MOCK
  cat > "$TEST_DIR/bin/pytest" <<'MOCK'
#!/bin/bash
echo "2 passed in 0.01s"
exit 0
MOCK
  cat > "$TEST_DIR/bin/coverage" <<'MOCK'
#!/bin/bash
exit 0
MOCK
  cat > "$TEST_DIR/bin/ruff" <<'MOCK'
#!/bin/bash
if [ "$1" = "check" ]; then echo "[]"; fi
exit 0
MOCK
  cat > "$TEST_DIR/bin/mypy" <<'MOCK'
#!/bin/bash
echo "Success: no issues found"
exit 0
MOCK
  cat > "$TEST_DIR/bin/npx" <<'MOCK'
#!/bin/bash
echo "npx [pwd=$(pwd)] $*" >> "${NPX_LOG:-/dev/null}"
case "$1" in
  tsc)
    if [ "$2" = "--version" ]; then echo "Version 5.4.5"; exit 0; fi
    exit 0 ;;
  biome)
    echo "Checked 2 files in 3ms. No fixes applied."
    exit 0 ;;
  vitest)
    if [ "$2" = "--version" ]; then echo "1.6.1"; exit 0; fi
    echo "Test Files 2 passed"
    exit 0 ;;
  jest) exit 1 ;;
  *) exit 0 ;;
esac
MOCK
  chmod +x "$TEST_DIR/bin/jscpd" "$TEST_DIR/bin/lizard" "$TEST_DIR/bin/gitleaks" \
           "$TEST_DIR/bin/pytest" "$TEST_DIR/bin/coverage" "$TEST_DIR/bin/ruff" \
           "$TEST_DIR/bin/mypy" "$TEST_DIR/bin/npx"
  export PATH="$TEST_DIR/bin:$PATH"
  export NPX_LOG="$TEST_DIR/npx.log"

  mkdir -p .git/hooks
  cp "$SOURCE_GITHOOKS/pre-commit" .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  cp "$SOURCE_GITHOOKS/adapter-common.sh" .git/hooks/adapter-common.sh 2>/dev/null || true
  # The hook sources lib/typecheck.sh in Gate 1 (#436): ship the whole lib/
  # directory, exactly like a real `xp-gate init` installation does.
  mkdir -p .git/hooks/lib
  cp -R "$SOURCE_GITHOOKS/lib/." .git/hooks/lib/ 2>/dev/null || true

  mkdir -p web/src/modules/training backend
  cat > web/tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
EOF
  cat > web/biome.json <<'EOF'
{
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": true }
}
EOF
  cat > web/package.json <<'EOF'
{ "name": "fixture-web", "private": true }
EOF
  cat > backend/main.py <<'EOF'
def main() -> None:
    print("hello from backend")
EOF
  echo "ignore: []" > .archlint.yaml
  echo "ignore: []" > web/.archlint.yaml
  git add -A
  git commit -q --no-verify -m "init"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# ---------------------------------------------------------------------------
# AC-TDD-016-01: tsc runs against web/tsconfig.json instead of SKIPping
# ---------------------------------------------------------------------------

@test "multilang: Gate 1 runs tsc from the web/ project directory" {
  echo "export const session = () => 1;" > web/src/modules/training/session.ts
  echo "test('session', () => {});" > web/src/modules/training/session.test.ts
  echo "def helper() -> int: return 1" > backend/helper.py
  git add -A

  run git commit -m "add files for tsc discovery"
  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" != *"tsconfig.json not found"* ]]
  [[ "$output" == *"Running TypeScript static analysis"* ]]
  # #436 moved the type-check into lib/typecheck.sh (cwd-relative), and #470
  # discovers the TS project directory and cds into it: tsc must be invoked
  # from web/ (config auto-discovery), not with a --project path from the root.
  grep -qE 'pwd=[^]]*/web\] tsc' "$NPX_LOG"
}

# ---------------------------------------------------------------------------
# AC-TDD-016-02: Biome is discovered in web/ and its check runs
# ---------------------------------------------------------------------------

@test "multilang: Gate 1 runs Biome against web/biome.json" {
  echo "export const session = () => 1;" > web/src/modules/training/session.ts
  echo "test('session', () => {});" > web/src/modules/training/session.test.ts
  echo "def helper() -> int: return 1" > backend/helper.py
  git add -A

  run git commit -m "add files for biome discovery"
  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Running Biome lint/format check"* ]]
  [[ "$output" == *"PASSED - Biome check"* ]]
  # Biome must be executed from the web/ project directory (config auto-discovery)
  grep -qE 'pwd=[^]]*web\] biome check --staged' "$NPX_LOG"
}

# ---------------------------------------------------------------------------
# AC-TDD-016-03: plain root project unchanged (regression guard)
# ---------------------------------------------------------------------------

@test "root-level TS project still runs tsc (no subdir)" {
  local FRESH
  FRESH=$(mktemp -d)
  git init -q -b test-branch "$FRESH"
  git -C "$FRESH" config user.email "test@test.com"
  git -C "$FRESH" config user.name "Test"

  mkdir -p "$FRESH/.git/hooks"
  cp "$SOURCE_GITHOOKS/pre-commit" "$FRESH/.git/hooks/pre-commit"
  chmod +x "$FRESH/.git/hooks/pre-commit"
  cp "$SOURCE_GITHOOKS/adapter-common.sh" "$FRESH/.git/hooks/adapter-common.sh" 2>/dev/null || true
  mkdir -p "$FRESH/.git/hooks/lib"
  cp -R "$SOURCE_GITHOOKS/lib/." "$FRESH/.git/hooks/lib/" 2>/dev/null || true
  git -C "$FRESH" config core.hooksPath "$FRESH/.git/hooks"

  cat > "$FRESH/tsconfig.json" <<'EOF'
{
  "compilerOptions": { "strict": true, "noEmit": true, "skipLibCheck": true },
  "include": ["src/**/*.ts"]
}
EOF
  echo '{ "name": "root-fixture", "private": true }' > "$FRESH/package.json"
  echo "ignore: []" > "$FRESH/.archlint.yaml"
  mkdir -p "$FRESH/src"
  echo "export const x = 1;" > "$FRESH/src/foo.ts"
  echo "test('foo', () => {});" > "$FRESH/src/foo.test.ts"
  git -C "$FRESH" add .
  git -C "$FRESH" commit -q --no-verify -m "init"

  echo "export const bar = 2;" > "$FRESH/src/bar.ts"
  echo "test('bar', () => {});" > "$FRESH/src/bar.test.ts"
  git -C "$FRESH" add src/bar.ts src/bar.test.ts

  export NPX_LOG="$TEST_DIR/npx.log"
  export PATH="$TEST_DIR/bin:$PATH"
  : > "$NPX_LOG"
  run git -C "$FRESH" commit -m "add root ts file"
  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Running TypeScript static analysis"* ]]
  [[ "$output" != *"TypeScript project directory"* ]]
  # Root project (TS_PROJECT_DIR="."): tsc runs at the repo root, cwd-relative,
  # without any --project flag or directory notice.
  grep -q '] tsc --noEmit --skipLibCheck' "$NPX_LOG"

  rm -rf "$FRESH"
}
