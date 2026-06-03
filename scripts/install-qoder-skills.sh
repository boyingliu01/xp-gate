#!/usr/bin/env bash
# install-qoder-skills.sh: Install xp-gate skills for Qoder IDE
# Usage: bash scripts/install-qoder-skills.sh --global|--local [--force]
#
# --global: Install to ~/.qoder/skills/ (user-level, all projects)
# --local:  Install to .qoder/skills/ (project-level, current directory)
# --force:  Overwrite existing skills

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_SOURCE="$PROJECT_ROOT/skills"
WIDGETS_SOURCE="$PROJECT_ROOT/plugins/qoder/widgets"

MODE=""
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --global)
      MODE="global"
      shift
      ;;
    --local)
      MODE="local"
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --help|-h)
      echo "Usage: install-qoder-skills.sh --global|--local [--force]"
      echo ""
      echo "Options:"
      echo "  --global  Install to ~/.qoder/skills/ (user-level)"
      echo "  --local   Install to .qoder/skills/ (project-level)"
      echo "  --force   Overwrite existing skills"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$MODE" ]; then
  echo "Error: --global or --local required" >&2
  echo "Usage: install-qoder-skills.sh --global|--local [--force]" >&2
  exit 1
fi

# Determine target directory
# On Windows Git Bash, $HOME may resolve to /c/Users/xxx or /home/xxx (WSL).
# We need the Windows user profile for Qoder to discover skills.
if [ "$MODE" = "global" ]; then
  if [ -n "$USERPROFILE" ]; then
    # Windows: use USERPROFILE (works in both PowerShell and Git Bash)
    TARGET_DIR="$USERPROFILE/.qoder/skills"
  else
    HOME_DIR="${HOME:-$(echo ~)}"
    TARGET_DIR="$HOME_DIR/.qoder/skills"
  fi
else
  TARGET_DIR=".qoder/skills"
fi

WIDGET_TARGET="$(dirname "$TARGET_DIR")/widgets"

echo "Installing xp-gate skills for Qoder ($MODE mode)..."
echo "Source:  $SKILLS_SOURCE"
echo "Target:  $TARGET_DIR"

if [ ! -d "$SKILLS_SOURCE" ]; then
  echo "Error: Skills source directory not found: $SKILLS_SOURCE" >&2
  exit 1
fi

# Create target directories
mkdir -p "$TARGET_DIR"
mkdir -p "$WIDGET_TARGET"

# Expected skills (all 8 for Qoder — includes admin-template-guidelines)
EXPECTED_SKILLS=(
  "sprint-flow"
  "delphi-review"
  "test-specification-alignment"
  "ralph-loop"
  "test-driven-development"
  "improve-codebase-architecture"
  "to-issues"
  "admin-template-guidelines"
)

INSTALLED=0
SKIPPED=0

for skill in "${EXPECTED_SKILLS[@]}"; do
  skill_src="$SKILLS_SOURCE/$skill"
  skill_dst="$TARGET_DIR/$skill"

  if [ ! -d "$skill_src" ]; then
    echo "  ⚠ SKIP: $skill (source not found)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ -d "$skill_dst" ] && [ "$FORCE" = false ]; then
    echo "  ⚠ SKIP: $skill (already exists, use --force to overwrite)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Copy entire skill directory (preserves references/, templates/, evals/)
  if [ -d "$skill_dst" ]; then
    rm -rf "$skill_dst"
  fi
  cp -r "$skill_src" "$skill_dst"
  echo "  ✓ $skill"
  INSTALLED=$((INSTALLED + 1))
done

# Copy widget templates
if [ -d "$WIDGETS_SOURCE" ]; then
  echo ""
  echo "Installing widget templates..."
  for widget in "$WIDGETS_SOURCE"/*.html; do
    [ -f "$widget" ] || continue
    wname=$(basename "$widget")
    cp "$widget" "$WIDGET_TARGET/$wname"
    echo "  ✓ widgets/$wname"
  done
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Installation complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Installed: $INSTALLED skill(s)"
echo "  Skipped:   $SKIPPED skill(s)"
echo "  Location:  $TARGET_DIR"
echo ""
echo "Available skills in Qoder (type / to see):"
for skill in "${EXPECTED_SKILLS[@]}"; do
  if [ -f "$TARGET_DIR/$skill/SKILL.md" ]; then
    echo "  /$skill"
  fi
done
echo ""
echo "Note: Qoder auto-discovers skills from ~/.qoder/skills/ and .qoder/skills/"
