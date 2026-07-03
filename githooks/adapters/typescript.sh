#!/usr/bin/env bash

# TypeScript adapter for quality gates

run_static_analysis() {
  if command -v npx >/dev/null 2>&1; then
    echo "Running TypeScript static analysis..."
    npx tsc --noEmit
    return $?
  else
    echo "npx not available, skipping TypeScript static analysis"
    return 0
  fi
}

run_lint() {
  if command -v npx >/dev/null 2>&1; then
    echo "Running TypeScript linting..."
    npx eslint . --ext .ts,.tsx
    return $?
  else
    echo "npx not available, skipping TypeScript linting"
    return 0
  fi
}

run_tests() {
  if command -v npx >/dev/null 2>&1; then
    echo "Running TypeScript tests..."
    if npx vitest --version >/dev/null 2>&1; then
      npx vitest run
    elif npx jest --version >/dev/null 2>&1; then
      npx jest --passWithNoTests
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
      npx vitest run --coverage
    elif npx jest --version >/dev/null 2>&1; then
      npx jest --coverage
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
