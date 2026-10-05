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

HOOKS_LIST="pre-commit pre-push post-merge"
GATE_SCRIPTS="gate-3.sh gate-4.sh gate-7.sh gate-8.sh gate-9.sh gate-10.sh"

echo "Installing OpenCode quality gates..."
echo ""

for hook in $HOOKS_LIST; do
  src="$HOOKS_DIR/$hook"
  if [ -f "$src" ]; then
    cp "$src" "$TARGET_HOOKS/$hook"
    chmod +x "$TARGET_HOOKS/$hook"
    echo "  + $hook ($HOOKS_DIR/$hook) -> .git/hooks/"
  fi
done

# Install gate-*.sh scripts required by pre-commit (referenced via $GATE_DIR)
for gate in $GATE_SCRIPTS; do
  src="$HOOKS_DIR/$gate"
  if [ -f "$src" ]; then
    cp "$src" "$TARGET_HOOKS/$gate"
    chmod +x "$TARGET_HOOKS/$gate"
    echo "  + $gate ($HOOKS_DIR/$gate) -> .git/hooks/"
  fi
done

# Install the hook libraries. A hook resolves them against its own directory
# ($SCRIPT_DIR/lib/...), so they have to sit next to the installed copy: without
# lib/, pre-commit loses now_ms() and, since #473, Gate 5's handle_test_failure
# — whose absence fails closed into a block on every commit.
if [ -d "$HOOKS_DIR/lib" ]; then
  mkdir -p "$TARGET_HOOKS/lib"
  for libfile in "$HOOKS_DIR"/lib/*; do
    [ -f "$libfile" ] || continue
    libname=$(basename "$libfile")
    cp "$libfile" "$TARGET_HOOKS/lib/$libname"
    chmod +x "$TARGET_HOOKS/lib/$libname"
    echo "  + lib/$libname -> .git/hooks/lib/"
  done
fi

if [ -d "$TARGET_GITHOOKS" ]; then
  if [ "$1" != "--force" ]; then
    mkdir -p "$TARGET_GITHOOKS/adapters"
    if [ -f "$HOOKS_DIR/adapter-common.sh" ]; then
      cp "$HOOKS_DIR/adapter-common.sh" "$TARGET_GITHOOKS/adapter-common.sh"
      echo "  + adapter-common.sh -> $TARGET_GITHOOKS/"
    fi
    cp -n "$HOOKS_DIR/adapters/"*.sh "$TARGET_GITHOOKS/adapters/" 2>/dev/null || true
    echo "  + adapters/*.sh (merged into $TARGET_GITHOOKS/adapters/)"
    echo ""
    echo "Git hooks and adapter infrastructure installed to current project."
echo "  Hooks:    $TARGET_HOOKS/{pre-commit,pre-push,post-merge}"
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
