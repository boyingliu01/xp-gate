#!/usr/bin/env bash

# TypeScript adapter for quality gates

run_static_analysis() {
  if ! command -v npx >/dev/null 2>&1; then
    echo "npx not available, skipping TypeScript static analysis"
    return 0
  fi

  local HAS_ERRORS=0
  local TSC_VERSION

  echo "Running TypeScript static analysis..."
  npx tsc --noEmit
  TSC_EXIT=$?
  if [ $TSC_EXIT -ne 0 ]; then
    HAS_ERRORS=1
  fi

  # Also check test files if tsconfig.json exists (see Issue #293).
  # Many projects exclude __tests__/ from tsconfig.json, so test file type
  # errors silently accumulate. We detect this and run a second tsc pass.
  local HAS_TESTS=false
  if [ -d "src/__tests__" ] || [ -d "src/tests" ] || [ -d "tests" ] || [ -d "__tests__" ]; then
    HAS_TESTS=true
  fi

  if [ "$HAS_TESTS" = true ] && [ -f "tsconfig.json" ]; then
    # Check if tsconfig.json already includes test files
    if npx tsc --noEmit --listFiles 2>/dev/null | grep -qE '__tests__/|\.test\.ts|\.spec\.ts'; then
      : # Test files already checked — no additional pass needed
    elif [ -f "tsconfig.tests.json" ]; then
      echo "Checking test files with tsconfig.tests.json..."
      npx tsc --noEmit --project tsconfig.tests.json
      TSC_TEST_EXIT=$?
      if [ $TSC_TEST_EXIT -ne 0 ]; then
        HAS_ERRORS=1
      fi
    else
      # Generate a temp tsconfig that includes test files for the additional pass
      local TSC_TEST_EXIT=0
      echo "Checking test files for type errors (generating temp tsconfig)..."
      npx tsc --noEmit 2>/dev/null
      # Create temp tsconfig extending the original but with test files included
      local TEMP_TSCONFIG=".tsconfig.withtests.json"
      if [ ! -f "$TEMP_TSCONFIG" ]; then
        node -e "
          const cfg = JSON.parse(require('fs').readFileSync('tsconfig.json','utf8'));
          delete cfg.exclude;
          cfg.include = cfg.include || ['src/**/*'];
          cfg.include.push('src/**/__tests__/**','src/**/*.test.ts','src/**/*.spec.ts');
          require('fs').writeFileSync('$TEMP_TSCONFIG', JSON.stringify(cfg, null, 2));
        " 2>/dev/null
        npx tsc --noEmit --project "$TEMP_TSCONFIG"
        TSC_TEST_EXIT=$?
        rm -f "$TEMP_TSCONFIG"
      fi
      if [ $TSC_TEST_EXIT -ne 0 ]; then
        echo ""
        echo "❌ BLOCKED - TYPE ERRORS in test files"
        echo "Your project's tsconfig.json excludes test files from type checking."
        echo "Fix the type errors above or add a tsconfig.tests.json to customise test file checking."
        HAS_ERRORS=1
      fi
    fi
  fi

  return $HAS_ERRORS
}

run_lint() {
  if ! command -v npx >/dev/null 2>&1; then
    echo "npx not available, skipping TypeScript linting"
    return 0
  fi

  # Prefer Biome if biome.json/biome.jsonc exists (covers lint + format in one pass)
  if [ -f "biome.json" ] || [ -f "biome.jsonc" ]; then
    echo "Running Biome linting..."
    npx biome check . --no-errors-on-unmatched 2>&1 | head -50
    local EXIT_CODE=$?
    if [ $EXIT_CODE -ne 0 ]; then
      echo ""
      echo "❌ Biome check failed"
      echo "Run 'npx biome check --write .' to auto-fix."
      return $EXIT_CODE
    fi
    echo "✅ PASSED - Biome check."
    return 0
  fi

  # Fall back to ESLint if no Biome config exists
  if [ -f ".eslintrc.json" ] || [ -f ".eslintrc.js" ] || [ -f ".eslintrc.cjs" ] || [ -f "eslint.config.js" ]; then
    echo "Running ESLint linting..."
    npx eslint . --ext .ts,.tsx
    return $?
  fi

  echo "❌ BLOCKED - No linter configuration found for TypeScript project."
  echo "   TypeScript projects require a linter: either Biome (biome.json/biome.jsonc)"
  echo "   or ESLint (.eslintrc.json/.eslintrc.js/eslint.config.js)."
  echo "   Create one of these configuration files to enable linting."
  return 1
}

run_tests() {
  if command -v npx >/dev/null 2>&1; then
    echo "Running TypeScript tests..."
    if npx vitest --version >/dev/null 2>&1; then
      run_without_git_context npx vitest run
    elif npx jest --version >/dev/null 2>&1; then
      run_without_git_context npx jest --passWithNoTests
    else
      echo "No test runner available (vitest or jest required)"
      return 1
    fi
    return $?
  else
    echo "npx not available, skipping TypeScript tests"
    return 0
  fi
}

run_coverage() {
  if command -v npx >/dev/null 2>&1; then
    echo "Running TypeScript coverage..."
    if npx vitest --version >/dev/null 2>&1; then
      run_without_git_context npx vitest run --coverage
    elif npx jest --version >/dev/null 2>&1; then
      run_without_git_context npx jest --coverage
    else
      echo "No test runner available for coverage"
      return 1
    fi
    return $?
  else
    echo "npx not available, skipping TypeScript coverage"
    return 0
  fi
}

# ── Biome linting (if installed) ──

run_biome_lint() {
  # Only run if biome is available
  if ! command -v npx >/dev/null 2>&1; then
    return 0
  fi
  if ! npx biome --version >/dev/null 2>&1; then
    return 0  # biome not installed → SKIP (same as other tools)
  fi

  echo "Running Biome linting..."
  local BIOME_EXIT=0
  npx biome lint . 2>&1 || BIOME_EXIT=$?

  # Check for known conflict: useLiteralKeys vs TypeScript TS4111
  # When biome reports useLiteralKeys on Record<string,unknown> usage,
  # it conflicts with TypeScript strict index-signature access (TS4111).
  # We only warn — we do NOT block — because both rules are correct in their domain.
  if npx biome lint . 2>&1 | grep -q "useLiteralKeys"; then
    local TSC_CHECK=0
    npx tsc --noEmit 2>&1 | grep -q "TS4111" || TSC_CHECK=$?
    if [ $TSC_CHECK -eq 0 ]; then
      echo ""
      echo "ℹ️  NOTE: Biome useLiteralKeys conflicts with TypeScript TS4111"
      echo "   This happens on Record<string,unknown> or index-signature types."
      echo "   Biome wants dot notation (obj.name), TypeScript requires bracket (obj['name'])."
      echo "   Recommended: disable useLiteralKeys in biome.json or see docs/biome-configuration.md"
      echo ""
    fi
  fi

  return $BIOME_EXIT
}
