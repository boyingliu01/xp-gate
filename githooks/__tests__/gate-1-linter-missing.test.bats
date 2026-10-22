#!/usr/bin/env bats

# ============================================================================
# Issue #298: Gate 1/TypeScript adapter — fail when no linter configured
# 
# run_lint() should BLOCK (return non-zero) when a TypeScript project has
# NO linter configured (no biome.json, no eslint config). Currently it
# returns 0 with "ℹ️  No linter config found. Skipping lint."
# 
# A TypeScript project without ANY linter should fail the quality gate.
# ============================================================================

setup() {
  TEST_DIR=$(mktemp -d)
  cd "$TEST_DIR"

  # Minimal TypeScript project with no linter config
  mkdir -p src
  cat > package.json <<'EOF'
{"name":"test-no-linter","version":"1.0.0"}
EOF
  cat > tsconfig.json <<'EOF'
{"compilerOptions":{"strict":true,"noEmit":true},"include":["src"]}
EOF
  cat > src/index.ts <<'EOF'
export const greet = (name: string): string => `Hello, ${name}!`;
EOF

  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  git add -A
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# ============================================================================
# Test: run_lint must FAIL when no linter is configured
# ============================================================================

@test "run_lint fails when no linter config exists for TypeScript project" {
  # Verify neither biome nor eslint config exists
  [ ! -f "biome.json" ]
  [ ! -f "biome.jsonc" ]
  [ ! -f ".eslintrc.json" ]
  [ ! -f ".eslintrc.js" ]
  [ ! -f ".eslintrc.cjs" ]
  [ ! -f "eslint.config.js" ]

  source "$BATS_TEST_DIRNAME/../adapters/typescript.sh"
  run run_lint 2>&1
  echo "run_lint output: $output"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "No linter" ]] || [[ "$output" =~ "BLOCK" ]]
}

@test "run_lint passes when biome.json exists" {
  cat > biome.json <<'EOF'
{"$schema":"https://biomejs.dev/schemas/1.9.4/schema.json","vcs":{"enabled":true,"clientKind":"git","useIgnoreFile":true},"linter":{"enabled":false},"formatter":{"enabled":false},"organizeImports":{"enabled":true}}
EOF
  git add biome.json

  source "$BATS_TEST_DIRNAME/../adapters/typescript.sh"
  run run_lint 2>&1
  echo "run_lint output: $output"
  # Biome with linter disabled should still "run" and pass
  [ "$status" -eq 0 ] || [[ "$output" =~ "Biome" ]]
}

@test "run_lint passes when eslint config exists" {
  # ESLint v9 dropped .eslintrc.* as the default; v10 removed it outright. This
  # fixture wrote .eslintrc.json, so the adapter correctly detected "eslint config
  # exists" and then ESLint itself refused to run:
  #     Oops! Something went wrong!
  #     ESLint: 10.7.0
  #     ESLint couldn't find an eslint.config.(js|mjs|cjs) file.
  # The case was therefore red whenever a modern ESLint was on PATH, and passing
  # only where the installed ESLint still honoured the legacy format.
  #
  # The behaviour under test is unchanged: with an eslint config present, the
  # adapter runs ESLint and the run succeeds. Use the format ESLint actually
  # reads, and give it a TypeScript parser — the fixture repo stages src/index.ts
  # (created in setup), so a JS-only config reports
  #     1:27  error  Parsing error: Unexpected token :
  # which is a fixture problem, not an adapter problem.
  #
  # The parser import must resolve from the fixture ($BATS_TMPDIR), whose
  # node_modules is empty — a bare specifier fails with ERR_MODULE_NOT_FOUND.
  # Link the repo's node_modules into the fixture instead of rewriting the
  # specifier, so the config reads exactly like a real project's.
  [ -d "$BATS_TEST_DIRNAME/../../node_modules/@typescript-eslint/parser" ] || {
    skip "@typescript-eslint/parser not installed in the repo; cannot configure a TS-capable eslint"
  }
  ln -s "$BATS_TEST_DIRNAME/../../node_modules" node_modules 2>/dev/null || \
    cp -R "$BATS_TEST_DIRNAME/../../node_modules" node_modules 2>/dev/null || true

  cat > eslint.config.js <<'EOF'
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser },
    rules: {},
  },
];
EOF
  git add eslint.config.js

  source "$BATS_TEST_DIRNAME/../adapters/typescript.sh"
  run run_lint 2>&1
  echo "run_lint output: $output"
  [ "$status" -eq 0 ] || {
    echo "run_lint did not pass with an eslint.config.js present"
    return 1
  }
}

@test "run_lint passes when npx not available (graceful skip)" {
  # Temporarily hide npx by using a fake PATH
  local ORIG_PATH="$PATH"
  PATH="/usr/bin:/bin"  # likely no npx here
  source "$BATS_TEST_DIRNAME/../adapters/typescript.sh"
  run run_lint 2>&1
  echo "run_lint output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "npx not available" ]]
  PATH="$ORIG_PATH"
}

@test "run_lint fails when biome.jsonc is the only biome config but eslint missing" {
  cat > biome.jsonc <<'EOF'
{"$schema":"https://biomejs.dev/schemas/1.9.4/schema.json","linter":{"enabled":true,"rules":{"suspicious":{"noExplicitAny":"off"}}},"formatter":{"enabled":false}}
EOF
  git add biome.jsonc

  source "$BATS_TEST_DIRNAME/../adapters/typescript.sh"
  run run_lint 2>&1
  echo "run_lint output: $output"
  [ "$status" -eq 0 ]
}
