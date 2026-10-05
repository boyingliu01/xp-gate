#!/usr/bin/env bats

# @test REQ-TDD-017
# @intent Gate 1 TypeScript half must run the PROJECT'S OWN typecheck script
#         (e.g. vue-tsc via `npm run typecheck`) when package.json declares
#         one, fall back to the project's LOCAL tsc otherwise, and never let a
#         bare `npx tsc` fetch a random TypeScript from the network. Type
#         errors must still BLOCK on every path.
# @covers AC-TDD-017-01 through AC-TDD-017-04
#
# Regression for #436: in a Vue 3 + TS project the real type check is
#   web/package.json -> "typecheck": "vue-tsc --noEmit"
# while the gate hardcoded `npx tsc --project web/tsconfig.json` from the repo
# root — plain tsc cannot resolve '*.vue' SFC imports (30 x false TS2307) and,
# because the root has no local TypeScript, npx fetched TypeScript 7.0.2 from
# the network instead of the project's own 5.9.3. Test matrix:
#   - package.json with a typecheck script -> THAT script runs (npm run), the
#     local tsc mock is NOT invoked (preference proven on the same fixture)
#   - plain TS project without a script -> local node_modules/.bin/tsc runs,
#     npx is never asked for tsc (no network fetch)
#   - typecheck script fails -> commit BLOCKED (gate not weakened)
#   - local tsc fails -> commit BLOCKED (gate not weakened)

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
  # npx mock: logs every invocation. Any `npx tsc` call is a NETWORK-FETCH
  # regression (#436) and fails loudly.
  cat > "$TEST_DIR/bin/npx" <<'MOCK'
#!/bin/bash
echo "npx [pwd=$(pwd)] $*" >> "${NPX_LOG:-/dev/null}"
case "$1" in
  tsc)
    echo "MOCK-NETWORK-FETCH npx tsc"
    exit 97 ;;
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
  # npm mock: logs every invocation; `npm run <script>` echoes the stub output
  # and exits with the stub status (simulates vue-tsc / tsc --noEmit results).
  cat > "$TEST_DIR/bin/npm" <<'MOCK'
#!/bin/bash
echo "npm [pwd=$(pwd)] $*" >> "${NPM_LOG:-/dev/null}"
if [ "$1" = "run" ]; then
  if [ -n "${TYPECHECK_STUB_OUTPUT:-}" ] && [ -f "$TYPECHECK_STUB_OUTPUT" ]; then
    cat "$TYPECHECK_STUB_OUTPUT"
  fi
  exit "${TYPECHECK_STUB_STATUS:-0}"
fi
exit 0
MOCK
  chmod +x "$TEST_DIR/bin/jscpd" "$TEST_DIR/bin/lizard" "$TEST_DIR/bin/gitleaks" \
           "$TEST_DIR/bin/pytest" "$TEST_DIR/bin/coverage" "$TEST_DIR/bin/ruff" \
           "$TEST_DIR/bin/mypy" "$TEST_DIR/bin/npx" "$TEST_DIR/bin/npm"
  export PATH="$TEST_DIR/bin:$PATH"
  export NPX_LOG="$TEST_DIR/npx.log"
  export NPM_LOG="$TEST_DIR/npm.log"
  export TSC_LOG="$TEST_DIR/tsc.log"
  : > "$NPX_LOG"
  : > "$NPM_LOG"
  : > "$TSC_LOG"

  mkdir -p .git/hooks
  cp "$SOURCE_GITHOOKS/pre-commit" .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  cp "$SOURCE_GITHOOKS/adapter-common.sh" .git/hooks/adapter-common.sh 2>/dev/null || true
  mkdir -p .git/hooks/lib
  cp "$SOURCE_GITHOOKS/lib/now-ms.sh" .git/hooks/lib/now-ms.sh 2>/dev/null || true

  cat > tsconfig.json <<'EOF'
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
  echo "ignore: []" > .archlint.yaml
  echo "node_modules/" > .gitignore
  mkdir -p src
  echo "export const foo = 1;" > src/foo.ts
  echo "test('foo', () => {});" > src/foo.test.ts
  git add -A
  git commit -q --no-verify -m "init"
}

teardown() {
  unset TYPECHECK_STUB_STATUS TYPECHECK_STUB_OUTPUT TSC_STUB_STATUS TSC_STUB_OUTPUT
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Install a mock local tsc at node_modules/.bin/tsc that logs to $TSC_LOG.
install_local_tsc_mock() {
  mkdir -p node_modules/.bin
  cat > node_modules/.bin/tsc <<'MOCK'
#!/bin/bash
echo "tsc [pwd=$(pwd)] $*" >> "${TSC_LOG:-/dev/null}"
if [ "$1" = "--version" ]; then
  echo "Version 5.9.3"
  exit 0
fi
if [ -n "${TSC_STUB_OUTPUT:-}" ] && [ -f "$TSC_STUB_OUTPUT" ]; then
  cat "$TSC_STUB_OUTPUT"
fi
exit "${TSC_STUB_STATUS:-0}"
MOCK
  chmod +x node_modules/.bin/tsc
}

# Commit package.json (+ optional local tsc mock) under --no-verify, then stage
# a paired .ts/.test.ts change for the real hook run.
stage_trigger() {
  git add -A
  git commit -q --no-verify -m "fixture"
  echo "export const bar = 2;" > src/bar.ts
  echo "test('bar', () => {});" > src/bar.test.ts
  git add src/bar.ts src/bar.test.ts
}

# ---------------------------------------------------------------------------
# AC-TDD-017-01: project typecheck script runs INSTEAD of any tsc pass
# ---------------------------------------------------------------------------

@test "project typecheck script runs instead of tsc (script preferred over local tsc)" {
  cat > package.json <<'EOF'
{ "name": "fixture-web", "private": true, "scripts": { "typecheck": "vue-tsc --noEmit" } }
EOF
  # Local tsc mock present: proves the project's script WINS over it (#436).
  install_local_tsc_mock
  stage_trigger

  export TYPECHECK_STUB_STATUS=0
  run git commit -m "add bar for project typecheck"
  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Running project typecheck (npm run typecheck)..."* ]]
  [[ "$output" == *"PASSED - TypeScript static analysis."* ]]
  # npm must run the project's own script from the project directory
  grep -qE 'pwd=[^]]*\] run --silent typecheck' "$NPM_LOG"
  # The local tsc mock must NOT have been invoked (preference proven)
  [ ! -s "$TSC_LOG" ]
  # and npx must never have been asked for tsc (no network fetch)
  ! grep -q "tsc" "$NPX_LOG"
}

# ---------------------------------------------------------------------------
# AC-TDD-017-02: no script -> LOCAL tsc fallback, never a network fetch
# ---------------------------------------------------------------------------

@test "plain TS project without a script falls back to local tsc (no npx fetch)" {
  cat > package.json <<'EOF'
{ "name": "fixture-root", "private": true }
EOF
  install_local_tsc_mock
  stage_trigger

  export TSC_STUB_STATUS=0
  run git commit -m "add bar for local tsc fallback"
  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Running TypeScript static analysis"* ]]
  # The LOCAL compiler did the checking (version probe + project check)
  grep -q -- "--version" "$TSC_LOG"
  grep -q -- "--noEmit --skipLibCheck --project ./tsconfig.json" "$TSC_LOG"
  # npx must never have been asked for tsc (the MOCK-NETWORK-FETCH guard)
  ! grep -q "tsc" "$NPX_LOG"
  [[ "$output" != *"MOCK-NETWORK-FETCH"* ]]
}

# ---------------------------------------------------------------------------
# AC-TDD-017-03: failing project typecheck still BLOCKS (gate not weakened)
# ---------------------------------------------------------------------------

@test "type errors from the project typecheck script BLOCK the commit" {
  cat > package.json <<'EOF'
{ "name": "fixture-web", "private": true, "scripts": { "typecheck": "vue-tsc --noEmit" } }
EOF
  install_local_tsc_mock
  stage_trigger

  export TYPECHECK_STUB_STATUS=1
  export TYPECHECK_STUB_OUTPUT="$TEST_DIR/ts-errors.txt"
  printf '%s\n' "src/bar.ts(1,1): error TS2304: Cannot find name 'broken'." > "$TYPECHECK_STUB_OUTPUT"

  run git commit -m "add bar with type errors"
  echo "output: $output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED - TYPE ERRORS detected"* ]]
  grep -qE 'pwd=[^]]*\] run --silent typecheck' "$NPM_LOG"
}

# ---------------------------------------------------------------------------
# AC-TDD-017-04: failing local tsc still BLOCKS (gate not weakened)
# ---------------------------------------------------------------------------

@test "type errors from the local tsc fallback BLOCK the commit" {
  cat > package.json <<'EOF'
{ "name": "fixture-root", "private": true }
EOF
  install_local_tsc_mock
  stage_trigger

  export TSC_STUB_STATUS=1
  export TSC_STUB_OUTPUT="$TEST_DIR/ts-errors.txt"
  printf '%s\n' "src/bar.ts(1,1): error TS2304: Cannot find name 'broken'." > "$TSC_STUB_OUTPUT"

  run git commit -m "add bar with type errors"
  echo "output: $output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED - TYPE ERRORS detected"* ]]
  grep -q -- "--noEmit --skipLibCheck --project ./tsconfig.json" "$TSC_LOG"
}
