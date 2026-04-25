#!/usr/bin/env bash
# Pre-Push Hook (Delphi Code Walkthrough) Installation Script
# Usage: bash scripts/install-pre-push.sh [--force]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../githooks" && pwd)"

if ! git rev-parse --git-dir &>/dev/null; then
  echo "❌ Not a git repository"
  exit 1
fi

GIT_DIR=$(git rev-parse --git-dir)
TARGET="$GIT_DIR/hooks/pre-push"

if [[ -f "$TARGET" ]] && [[ "$1" != "--force" ]]; then
  echo "⚠️  pre-push hook already installed at $TARGET"
  echo "   Use --force to overwrite"
  exit 0
fi

cp "$SCRIPT_DIR/pre-push" "$TARGET"
chmod +x "$TARGET"

echo "✅ Pre-push hook installed → $TARGET"
echo ""
echo "Validates: .code-walkthrough-result.json (Delphi review before push)"
echo "Recommended: install delphi-review skill (/delphi-review --mode code-walkthrough)"
