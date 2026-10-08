#!/usr/bin/env bats

# @test REQ-TDD-015
# @intent Multi-language monorepo (web/ TS + backend/ Python): Gate 5a/5b/5c
#         must resolve test-pairing paths against the repo root when the hook
#         stays at the root (PROJECT_SUBDIR is set but no cd happens).
# @covers AC-TDD-015-01 through AC-TDD-015-05
#
# Regression for: Gate 5a false BLOCK in multi-language subdirectory projects.
# The hook strips the PROJECT_SUBDIR prefix from git paths when PROJECT_SUBDIR
# is set, but only cd's into the subdirectory when a SINGLE language was
# detected. With 2+ languages it stays at the repo root, so stripped paths made
# every [ -f ] pairing probe miss: paired files were BLOCKED ("without
# corresponding test"), @no-test-required annotations were silently ignored
# (grep on a non-existent stripped path), and Gate 5b mock-density scanned
# nothing. Test matrix:
#   - Multilang + paired new .ts in subdir      -> PASS (was false BLOCK)
#   - Multilang + unpaired new .ts in subdir    -> BLOCK (gate stays strict)
#   - Multilang + @no-test-required in subdir   -> PASS (was false BLOCK)
#   - Multilang + high mock density in subdir   -> advisory fires (was silent)
#   - Single-language subdir (cd path)          -> PASS (strip still happens)

# Resolve source repo — works whether BATS runs from the worktree or the main checkout
SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

setup() {
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"
  git config core.hooksPath "$TEST_DIR/.git/hooks"

  # Mock tools so unrelated gates don't decide the outcome. The npx stub logs
  # every invocation (with CWD) to $NPX_LOG so tests can assert which tools the
  # hook actually ran and from where.
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

  # Copy pre-commit hook + required infrastructure
  mkdir -p .git/hooks
  cp "$SOURCE_GITHOOKS/pre-commit" .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  cp "$SOURCE_GITHOOKS/adapter-common.sh" .git/hooks/adapter-common.sh 2>/dev/null || true
  # The hook sources lib/typecheck.sh in Gate 1 (#436): ship the whole lib/
  # directory, exactly like a real `xp-gate init` installation does.
  mkdir -p .git/hooks/lib
  cp -R "$SOURCE_GITHOOKS/lib/." .git/hooks/lib/ 2>/dev/null || true

  # Multi-language monorepo fixture: TS project under web/, Python under backend/
  mkdir -p web/src/modules/training/stores backend
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
  # Minimal archlint config so Gate 6 doesn't block on missing config
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
# AC-TDD-015-01: paired new TS files in subdir PASS in multi-language repo
# ---------------------------------------------------------------------------

@test "multilang: new .ts with sibling .test.ts staged in subdir is NOT blocked" {
  echo "export const session = () => 1;" > web/src/modules/training/session.ts
  echo "test('session', () => {});" > web/src/modules/training/session.test.ts
  echo "export const training = () => 2;" > web/src/modules/training/stores/training.ts
  echo "test('training', () => {});" > web/src/modules/training/stores/training.test.ts
  echo "def helper() -> int: return 1" > backend/helper.py
  git add -A

  run git commit -m "add paired files"
  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"MULTILANGUAGE"* ]]
  [[ "$output" != *"BLOCKED"* ]]
  # The only pairing message may be the by-design WARNING for the new non-TS file
  [[ "$output" != *"BLOCKED: web/src/modules/training/session.ts"* ]]
  [[ "$output" != *"BLOCKED: web/src/modules/training/stores/training.ts"* ]]
}

# ---------------------------------------------------------------------------
# AC-TDD-015-02: unpaired new TS file in subdir still BLOCKs (gate stays strict)
# ---------------------------------------------------------------------------

@test "multilang: new .ts without test in subdir is still BLOCKED" {
  echo "export const api = () => 3;" > web/src/modules/training/api.ts
  echo "def helper() -> int: return 2" > backend/helper.py
  git add -A

  run git commit -m "add unpaired file"
  echo "output: $output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED: web/src/modules/training/api.ts"* ]]
  [[ "$output" == *"without corresponding test"* ]]
}

# ---------------------------------------------------------------------------
# AC-TDD-015-03: @no-test-required annotation honored (was silently ignored,
# because the grep ran on the stripped, non-existent path)
# ---------------------------------------------------------------------------

@test "multilang: @no-test-required annotation in subdir PASSES" {
  echo "// @no-test-required: generated API barrel, covered by integration tests" \
    > web/src/modules/training/annotated.ts
  echo "def helper() -> int: return 3" > backend/helper.py
  git add -A

  run git commit -m "add annotated file"
  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" != *"BLOCKED: web/src/modules/training/annotated.ts"* ]]
}

# ---------------------------------------------------------------------------
# AC-TDD-015-04: Gate 5b mock-density actually scans subdir test files
# (previously the stripped path made [ -f ] miss and the scan silently no-op'd)
# ---------------------------------------------------------------------------

@test "multilang: mock density advisory fires for subdir test file" {
  {
    echo "vi.mock('a');"
    echo "vi.mock('b');"
    echo "vi.mock('c');"
  } > web/src/modules/training/session.test.ts
  echo "export const session = () => 1;" > web/src/modules/training/session.ts
  echo "def helper() -> int: return 4" > backend/helper.py
  git add -A

  run git commit -m "add mock-heavy test"
  echo "output: $output"
  [[ "$output" == *"MOCK DENSITY"* ]]
  [[ "$output" == *"web/src/modules/training/session.test.ts"* ]]
}

# ---------------------------------------------------------------------------
# AC-TDD-015-05: single-language subdirectory project keeps working
# (cd into PROJECT_SUBDIR happens; prefix strip must still apply there)
# ---------------------------------------------------------------------------

@test "single-language subdir project still passes (cd + strip intact)" {
  git rm -q --cached backend/main.py
  rm -rf backend
  echo "export const session = () => 1;" > web/src/modules/training/session.ts
  echo "test('session', () => {});" > web/src/modules/training/session.test.ts
  git add -A

  run git commit -m "add paired file in single-language subdir"
  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Working in: web/"* ]]
  [[ "$output" != *"BLOCKED"* ]]
}
