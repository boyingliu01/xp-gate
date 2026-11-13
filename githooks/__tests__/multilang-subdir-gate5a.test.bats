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
# #570: the coverage gate BLOCKS when it cannot determine a percentage, so a
# silent stub models a failing gate rather than this fixture's subject (Gate 5a
# per-new-file coverage). Report a passing total so Gate 5's project-level floor
# stays out of the way.
echo 97
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

  # Biome is resolved LOCALLY first: <project>/node_modules/.bin/biome, then
  # `command -v biome`, then `npx biome` -- so a commit hook never downloads it
  # from the registry. A stub on `npx` alone is therefore UNREACHABLE on any host
  # that has biome installed globally, and this fixture would then run the REAL
  # biome against a toy project and BLOCK the commit it is trying to observe.
  # Stub the highest rung: the sub-project the gate will cd into.
  mkdir -p web/node_modules/.bin
  cat > web/node_modules/.bin/biome <<'MOCK'
#!/bin/bash
echo "Checked 2 files in 3ms. No fixes applied."
exit 0
MOCK
  chmod +x web/node_modules/.bin/biome
  export PATH="$TEST_DIR/bin:$PATH"
  export NPX_LOG="$TEST_DIR/npx.log"

  # Copy pre-commit hook + required infrastructure
  mkdir -p .git/hooks
  cp "$SOURCE_GITHOOKS/pre-commit" .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  cp "$SOURCE_GITHOOKS/adapter-common.sh" .git/hooks/adapter-common.sh 2>/dev/null || true
  cp "$SOURCE_GITHOOKS/hook-module-resolution.sh" .git/hooks/hook-module-resolution.sh 2>/dev/null || true
  # The hook sources lib/typecheck.sh in Gate 1 (#436): ship the whole lib/
  # directory, exactly like a real `xp-gate init` installation does.
  mkdir -p .git/hooks/lib
  cp -R "$SOURCE_GITHOOKS/lib/." .git/hooks/lib/ 2>/dev/null || true
  # #798: the gate bodies live in gate-entries/ and are sourced from SCRIPT_DIR,
  # one file per gate, driven by gate-driver.sh. Without them the copied
  # pre-commit runs its preamble and then has no gates to run at all -- the
  # fixture would assert against a hook that never reaches Gate 5a.
  cp "$SOURCE_GITHOOKS/gate-driver.sh" .git/hooks/gate-driver.sh 2>/dev/null || true
  cp "$SOURCE_GITHOOKS/gate-registry.sh" .git/hooks/gate-registry.sh 2>/dev/null || true
  mkdir -p .git/hooks/gate-entries
  cp -R "$SOURCE_GITHOOKS/gate-entries/." .git/hooks/gate-entries/ 2>/dev/null || true
  # Keep the gate entry points executable in the same way the installer does.
  chmod -R +x .git/hooks/gate-entries 2>/dev/null || true

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
  # #570: the coverage arms block when they cannot measure anything, so a fixture
  # that omits coverage data would fail on Gate 5's project-level floor while
  # claiming to test Gate 5a's per-new-file rule. Supply passing data for both
  # languages the fixture declares.
  mkdir -p coverage
  cat > coverage/coverage-summary.json <<'EOF'
{ "total": { "lines": { "pct": 97 } } }
EOF
  : > .coverage
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

  run git commit -m "add paired files"  # core.hooksPath pinned in setup
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

  run git commit -m "add unpaired file"  # core.hooksPath pinned in setup
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

  run git commit -m "add annotated file"  # core.hooksPath pinned in setup
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

  run git commit -m "add mock-heavy test"  # core.hooksPath pinned in setup
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
  # Removing the second language turns this into a single-project repo, so Gate 5
  # descends into web/ and looks for coverage THERE. The fixture only had
  # coverage at the repo root, which the multi-language path used; Gate 5 then
  # blocked with "coverage/coverage-summary.json not found" and the case never
  # reached the subdir assertions it exists for (#570 makes absence a BLOCK).
  mkdir -p web/coverage
  cat > web/coverage/coverage-summary.json <<'EOF'
{ "total": { "lines": { "pct": 97 } } }
EOF
  echo "export const session = () => 1;" > web/src/modules/training/session.ts
  echo "test('session', () => {});" > web/src/modules/training/session.test.ts
  git add -A

  run git commit -m "add paired file in single-language subdir"  # core.hooksPath pinned in setup
  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Working in: web/"* ]]
  [[ "$output" != *"BLOCKED"* ]]
}
