#!/usr/bin/env bash
# Pre-Commit Hook (9 Gates) Installation Script
# Usage: bash scripts/install-pre-commit.sh [--force]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../githooks" && pwd)"

if ! git rev-parse --git-dir &>/dev/null; then
  echo "❌ Not a git repository"
  exit 1
fi

GIT_DIR=$(git rev-parse --git-dir)
TARGET="$GIT_DIR/hooks/pre-commit"

# Check if already installed
if [[ -f "$TARGET" ]] && [[ "$1" != "--force" ]]; then
  echo "⚠️  pre-commit hook already installed at $TARGET"
  echo "   Use --force to overwrite"
  exit 0
fi

cp "$SCRIPT_DIR/pre-commit" "$TARGET"
chmod +x "$TARGET"

echo "✅ Pre-commit hook installed → $TARGET"
echo ""
echo "9 Gates: TypeScript/Lint/Tests/Coverage/Shell/Principles/CCN/BoyScout/Architecture"
echo ""
echo "Required runtime: node >=20"
echo "Recommended: lizard (cyclomatic complexity), archlint (architecture validation)"
