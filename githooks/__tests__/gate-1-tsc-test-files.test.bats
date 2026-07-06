#!/usr/bin/env bats

# ============================================================================
# Issue #293: Gate 1/Typescript adapter — tsc must also check test files
# 
# Verifies that run_static_analysis() in the typescript adapter detects
# type errors in test files even when tsconfig.json excludes __tests__/.
# ============================================================================

setup() {
  TEST_DIR=$(mktemp -d)
  cd "$TEST_DIR"
  
  # Init a minimal project with tsconfig that excludes test files
  mkdir -p src src/__tests__
  
  cat > package.json <<'EOF'
{"name":"test","version":"1.0.0"}
EOF
  
  # tsconfig.json that excludes test files (common pattern)
  cat > tsconfig.json <<'EOF'
{
  "compilerOptions": { "strict": true },
  "include": ["src/**/*"],
  "exclude": ["src/**/__tests__/**", "src/**/*.test.ts", "src/**/*.spec.ts"]
}
EOF
  
  # Production file (type-correct)
  cat > src/index.ts <<'EOF'
export interface State {
  name: string;
  count: number;
}
export const getState = (): State => ({ name: "test", count: 1 });
EOF

  # Test file with type error (missing 'count' field — undetectable if excluded)
  cat > src/__tests__/index.test.ts <<'EOF'
import { describe, it, expect } from "vitest";
import { getState } from "../index";

describe("State", () => {
  it("should have correct shape", () => {
    const state = getState();
    // This should be a type error: name is a string, not a number
    // @ts-expect-error — intentional type mismatch for testing
    const _check: { name: string; count: number } = { name: "ok", count: 1 };
    expect(state.count).toBe(1);
  });
});
EOF

  # Also create a test file with an actual type error: calling getState().missingField
  cat > src/__tests__/state.test.ts <<'EOF'
import { describe, it, expect } from "vitest";
import { State } from "../index";

describe("State type", () => {
  it("should have required fields", () => {
    const s: State = { name: "test", count: 42 };
    expect(s.name).toBe("test");
  });

  it("should reject missing fields at type level", () => {
    // This assignment should fail type check if tests are included
    // (State requires 'count' but this only provides 'name')
    // @ts-expect-error — deliberate type error for test detection
    const _bad: State = { name: "test" };
    // The point is: this test file SHOULD be type-checked by the hook
  });
});
EOF

  # Install typescript so npx tsc works without hitting the placeholder warning
  npm install --silent typescript vitest @types/node 2>/dev/null

  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  git add -A
}

teardown() {
  rm -rf "$TEST_DIR"
}

# ============================================================================
# Test: run_static_analysis must flag test-file type errors
#
# The typescript adapter's run_static_analysis() should:
# 1. Run tsc --noEmit on tsconfig.json (existing behavior)
# 2. ALSO run tsc --noEmit with a temp tsconfig that includes test files
# 3. OR detect tsconfig.tests.json / tsconfig.test.json and run that too
# ============================================================================

@test "tsc type-checks test files when tsconfig excludes __tests__" {
  # First verify the current behavior: tsc on tsconfig.json alone does NOT see test files
  run npx tsc --noEmit --skipLibCheck 2>&1
  echo "tsc on tsconfig.json: $output"
  [ "$status" -eq 0 ]

  # Now verify that a tsc run including test files WOULD see them
  # Simulate what our hook should do: use a temp tsconfig that includes tests
  cat > tsconfig.withtests.json <<'EOF'
{
  "compilerOptions": { "strict": true },
  "include": ["src/**/*"]
}
EOF
  
  run npx tsc --noEmit --project tsconfig.withtests.json --skipLibCheck 2>&1
  echo "tsc with tests included: $output"
  # Should fail because test files have a deliberate type error pattern
  [ "$status" -ne 0 ]
}

@test "run_static_analysis detects tsconfig excludes test files" {
  source "$BATS_TEST_DIRNAME/../adapters/typescript.sh"
  
  # Run the static analysis
  run run_static_analysis 2>&1
  echo "run_static_analysis output: $output"
  
  # Must check test files as well (should find errors and block)
  # The function should either:
  # 1. Run a second tsc for test files, OR
  # 2. Generate a temp tsconfig that includes tests
  # In either case, the exit code should be non-zero (type errors found)
  [ "$status" -ne 0 ]
  [[ "$output" =~ "test file" ]] || [[ "$output" =~ "test" ]]
}

@test "adapter checks for tsconfig.tests.json as alternative" {
  # Create a dedicated tsconfig.tests.json (some projects use this pattern)
  cat > tsconfig.tests.json <<'EOF'
{
  "compilerOptions": { "strict": true },
  "include": ["src/**/__tests__/**", "src/**/*.test.ts", "src/**/*.spec.ts"]
}
EOF
  
  source "$BATS_TEST_DIRNAME/../adapters/typescript.sh"
  run run_static_analysis 2>&1
  echo "run_static_analysis with tsconfig.tests.json: $output"
  
  # Should detect and use tsconfig.tests.json to check test files
  [ "$status" -ne 0 ]
  [[ "$output" =~ "test" ]]
}
