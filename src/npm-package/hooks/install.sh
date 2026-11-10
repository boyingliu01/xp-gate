#!/usr/bin/env bash
set -e

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The deploy manifest is a bash array projection generated from
# src/npm-package/lib/deploy-manifest.js (REQ-DEPLOY-001). Arrays only exist in
# bash: under POSIX sh they expand to nothing, so the installer would copy zero
# files and still exit 0. Fail closed before doing anything else.
if [ -z "${BASH_VERSION:-}" ]; then
  echo "Error: githooks/install.sh must run under bash (the deployment manifest is a bash array)." >&2
  echo "       Try: bash githooks/install.sh" >&2
  exit 1
fi

DEPLOY_MANIFEST="$HOOKS_DIR/deploy-manifest.sh"
if [ ! -f "$DEPLOY_MANIFEST" ]; then
  echo "Error: missing $DEPLOY_MANIFEST" >&2
  echo "       Regenerate it with: node scripts/generate-deploy-manifest.cjs" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "$DEPLOY_MANIFEST"

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

echo "Installing OpenCode quality gates..."
echo ""

for hook in "${DEPLOY_HOOK_FILES[@]}"; do
  src="$HOOKS_DIR/$hook"
  if [ -f "$src" ]; then
    cp "$src" "$TARGET_HOOKS/$hook"
    chmod +x "$TARGET_HOOKS/$hook"
    echo "  + $hook ($HOOKS_DIR/$hook) -> .git/hooks/"
  fi
done

# #505: hook-module-resolution.sh is GENERATED from
# src/npm-package/lib/hook-module-resolution.js, so a clean checkout has no copy.
# pre-commit aborts with "FATAL: cannot load hook-module-resolution.sh" when it is
# missing -- deliberately, because running without the module resolution order
# means the hook cannot find its own dependencies. That made a fresh clone
# unusable until someone knew to run the generator, which is what CI's
# First Commit Gates job reported.
#
# Generate it here when it is absent AND the generator is available (a consumer
# project installed via `xp-gate init` gets the generated file shipped, not the
# generator, so the absence of the generator is normal there and not an error).
if [ ! -f "$HOOKS_DIR/hook-module-resolution.sh" ]; then
  if [ -f "$PROJECT_ROOT/scripts/generate-hook-resolution.cjs" ] && command -v node >/dev/null 2>&1; then
    ( cd "$PROJECT_ROOT" && node scripts/generate-hook-resolution.cjs >/dev/null 2>&1 ) || true
    [ -f "$HOOKS_DIR/hook-module-resolution.sh" ] \
      && echo "  + generated hook-module-resolution.sh"
  fi
fi

# Install the gate scripts from the manifest. The old hand-written list named 7
# of 11 and silently omitted gate-6-layers.sh, gate-12-file-hygiene.sh and
# gate-registry.sh — gates that then never ran in an installed repo.
for gate in "${DEPLOY_GATE_FILES[@]}" hook-module-resolution.sh; do
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
