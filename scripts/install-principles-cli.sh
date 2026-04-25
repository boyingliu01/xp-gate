#!/usr/bin/env bash
# Principles Checker CLI Installation Script
# Usage: bash scripts/install-principles-cli.sh [--force] [--skip-npm]
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --skip-npm: skip npm install if already done
if [[ "$2" != "--skip-npm" ]]; then
  echo "→ Installing dependencies..."
  npm install --prefix "$PROJECT_ROOT" 2>&1 | tail -1
  echo "✅ Dependencies installed"
fi

PRINCIPLES_BIN="$PROJECT_ROOT/src/principles/index.ts"
if [[ ! -f "$PRINCIPLES_BIN" ]]; then
  echo "❌ Principles Checker not found at $PRINCIPLES_BIN"
  exit 1
fi

echo ""
echo "✅ Principles Checker CLI installed"
echo ""
echo "Usage:"
echo "  npx tsx src/principles/index.ts --files 'src/**/*.ts' --format console"
echo "  npx tsx src/principles/index.ts --files 'src/**/*.ts' --format sarif"
echo ""
echo "Boy Scout Rule (historical projects):"
echo "  npx tsx src/principles/boy-scout.ts --init-baseline"
echo "  npx tsx src/principles/boy-scout.ts --new-files <files> --modified-files <files> --baseline <path>"
