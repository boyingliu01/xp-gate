#!/usr/bin/env bash
set -e

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! git rev-parse --git-dir &>/dev/null; then
  echo "Error: Not a git repository. Must be run from within a project."
  exit 1
fi

GIT_DIR=$(git rev-parse --git-dir)
GIT_DIR=$(cd "$GIT_DIR" && pwd)
PROJECT_ROOT=$(git rev-parse --show-toplevel)

TARGET_HOOKS="$GIT_DIR/hooks"
mkdir -p "$TARGET_HOOKS"
TARGET_GITHOOKS="$PROJECT_ROOT/githooks"

HOOKS_LIST="pre-commit pre-push"

echo "Installing OpenCode quality gates..."
echo ""

for hook in $HOOKS_LIST; do
  src="$HOOKS_DIR/$hook"
  if [[ -f "$src" ]]; then
    cp "$src" "$TARGET_HOOKS/$hook"
    chmod +x "$TARGET_HOOKS/$hook"
    echo "  + $hook ($HOOKS_DIR/$hook) -> .git/hooks/"
  fi
done

if [[ -d "$TARGET_GITHOOKS" ]]; then
  if [[ "$1" != "--force" ]]; then
    mkdir -p "$TARGET_GITHOOKS/adapters"
    if [[ -f "$HOOKS_DIR/adapter-common.sh" ]]; then
      cp "$HOOKS_DIR/adapter-common.sh" "$TARGET_GITHOOKS/adapter-common.sh"
      echo "  + adapter-common.sh -> $TARGET_GITHOOKS/"
    fi
    cp -n "$HOOKS_DIR/adapters/"*.sh "$TARGET_GITHOOKS/adapters/" 2>/dev/null || true
    echo "  + adapters/*.sh (merged into $TARGET_GITHOOKS/adapters/)"
    echo ""
    echo "Git hooks and adapter infrastructure installed to current project."
    echo "  Hooks:    $TARGET_HOOKS/{pre-commit,pre-push}"
    echo "  Adapters: $TARGET_GITHOOKS/adapter-common.sh + adapters/"
    echo ""
    echo "On next commit, quality gates will run automatically."
    exit 0
  fi
fi

mkdir -p "$TARGET_GITHOOKS/adapters"
cp "$HOOKS_DIR/adapter-common.sh" "$TARGET_GITHOOKS/adapter-common.sh"
cp "$HOOKS_DIR/adapters/"*.sh "$TARGET_GITHOOKS/adapters/"

echo "  + adapter-common.sh -> $TARGET_GITHOOKS/"
echo "  + adapters/*.sh -> $TARGET_GITHOOKS/adapters/"
echo ""
echo "Git hooks and adapter infrastructure installed to current project."
echo "  Hooks:    $TARGET_HOOKS/{pre-commit,pre-push}"
echo "  Adapters: $TARGET_GITHOOKS/adapter-common.sh + adapters/"
echo ""
echo "On next commit, quality gates will run automatically."
