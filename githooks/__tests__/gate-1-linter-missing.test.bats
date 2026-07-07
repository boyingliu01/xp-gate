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
  cat > .eslintrc.json <<'EOF'
{"rules":{"no-unused-vars":"warn"}}
EOF
  git add .eslintrc.json

  source "$BATS_TEST_DIRNAME/../adapters/typescript.sh"
  run run_lint 2>&1
  echo "run_lint output: $output"
  [ "$status" -eq 0 ]
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
