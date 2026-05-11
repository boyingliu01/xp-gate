#!/usr/bin/env bash
set -e
OK=0
MISSING=0

check() {
  if [[ -f "$1" ]]; then
    echo "  ✅ $2"
    OK=$((OK + 1))
  else
    echo "  ❌ $2 (missing: $1)"
    MISSING=$((MISSING + 1))
  fi
}

if ! git rev-parse --git-dir &>/dev/null; then
  echo "Error: Not a git repository."
  exit 2
fi

GIT_DIR=$(git rev-parse --git-dir)
PROJECT_ROOT=$(git rev-parse --show-toplevel)

echo "Checking quality gates installation..."
echo ""

check "$GIT_DIR/hooks/pre-commit" ".git/hooks/pre-commit"
check "$GIT_DIR/hooks/pre-push" ".git/hooks/pre-push"
check "$PROJECT_ROOT/githooks/adapter-common.sh" "githooks/adapter-common.sh"
if [[ -d "$PROJECT_ROOT/githooks/adapters" ]]; then
  echo "  ✅ githooks/adapters/ directory"
  OK=$((OK + 1))
else
  echo "  ❌ githooks/adapters/ directory (missing: $PROJECT_ROOT/githooks/adapters)"
  MISSING=$((MISSING + 1))
fi

for lang in typescript python go shell flutter dart; do
  check "$PROJECT_ROOT/githooks/adapters/$lang.sh" "adapters/$lang.sh"
done

echo ""
if [[ $MISSING -eq 0 ]]; then
  echo "✅ All quality gates components present ($OK/$OK)."
  exit 0
else
  echo "⚠️  $MISSING component(s) missing ($OK found, $MISSING missing)."
  echo "   Fix: bash githooks/install.sh --force"
  exit 1
fi
