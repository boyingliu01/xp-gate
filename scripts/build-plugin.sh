#!/usr/bin/env bash
# build-plugin.sh: Build a plugin package for a target platform (Claude Code or OpenCode)
# Usage: scripts/build-plugin.sh --platform claude-code|opencode
#
# Unified build script (Delphi M3 fix) — eliminates duplication between Claude and OpenCode builds.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PLATFORM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      PLATFORM="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$PLATFORM" ]; then
  echo "Usage: build-plugin.sh --platform claude-code|opencode" >&2
  exit 1
fi

case "$PLATFORM" in
  claude-code|opencode)
    ;;
  *)
    echo "Error: --platform must be 'claude-code' or 'opencode' (got: $PLATFORM)" >&2
    exit 1
    ;;
esac

PLUGIN_DIR="$REPO_ROOT/plugins/$PLATFORM"
SKILLS_SOURCE="$REPO_ROOT/skills"

if [ ! -d "$SKILLS_SOURCE" ]; then
  echo "Error: Skills directory not found: $SKILLS_SOURCE" >&2
  exit 1
fi

if [ ! -d "$PLUGIN_DIR" ]; then
  echo "Error: Plugin directory not found: $PLUGIN_DIR" >&2
  echo "Run Task 1 first to create directory structure" >&2
  exit 1
fi

echo "Building $PLATFORM plugin..."
echo "Source: $SKILLS_SOURCE"
echo "Target: $PLUGIN_DIR/skills"

# Clean existing skills before rebuild (idempotent)
if [ -d "$PLUGIN_DIR/skills" ]; then
  find "$PLUGIN_DIR/skills" -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +
fi

# Copy all skills
bash "$SCRIPT_DIR/copy-skills.sh" --source "$SKILLS_SOURCE" --dest "$PLUGIN_DIR/skills"

# Verify expected skills (matching skills/ directory)
EXPECTED_SKILLS=(
  "sprint-flow"
  "delphi-review"
  "test-specification-alignment"
  "ralph-loop"
  "test-driven-development"
  "improve-codebase-architecture"
  "to-issues"
)

MISSING=0
for skill in "${EXPECTED_SKILLS[@]}"; do
  if [ ! -f "$PLUGIN_DIR/skills/$skill/SKILL.md" ]; then
    echo "Missing: $skill/SKILL.md" >&2
    MISSING=$((MISSING + 1))
  fi
done

if [ "$MISSING" -gt 0 ]; then
  echo "Error: $MISSING skills missing from $PLATFORM plugin" >&2
  exit 1
fi

echo ""
echo "Build complete: ${#EXPECTED_SKILLS[@]} skills packaged for $PLATFORM"
echo "Plugin location: $PLUGIN_DIR"
