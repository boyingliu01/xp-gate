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

# Create target directories
mkdir -p "$TARGET_DIR"
mkdir -p "$WIDGET_TARGET"

# ──────────────────────────────────────────────
# Dependency check: superpowers + gstack
# xp-gate requires these regardless of platform
# ──────────────────────────────────────────────
SUPERPOWERS_REPO="https://github.com/obra/superpowers.git"
GSTACK_REPO="https://github.com/garrytan/gstack.git"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/xp-gate-deps"

check_dep() {
  local name="$1"
  local indicator="$2"
  if [ -f "$TARGET_DIR/$indicator/SKILL.md" ]; then
    return 0
  fi
  return 1
}

install_dep() {
  local name="$1"
  local repo="$2"
  local clone_dir="$CACHE_DIR/$name"

  echo ""
  echo "  Installing $name..."
  mkdir -p "$CACHE_DIR"

  if [ -d "$clone_dir" ]; then
    echo "  Updating cached $name..."
    (cd "$clone_dir" && git pull --ff-only 2>/dev/null) || true
  else
    echo "  Cloning $name..."
    git clone --single-branch --depth 1 "$repo" "$clone_dir" 2>&1
  fi

  # Copy skills based on project structure
  if [ -d "$clone_dir/skills" ]; then
    # superpowers: skills/ subdirectory
    for skill_dir in "$clone_dir/skills"/*/; do
      [ -d "$skill_dir" ] || continue
      skill_name=$(basename "$skill_dir")
      if [ -f "$skill_dir/SKILL.md" ]; then
        cp -r "$skill_dir" "$TARGET_DIR/$skill_name"
        echo "    ✓ $name/$skill_name"
      fi
    done
  else
    # gstack: skills at root level (each subdirectory with SKILL.md)
    for skill_dir in "$clone_dir"/*/; do
      [ -d "$skill_dir" ] || continue
      skill_name=$(basename "$skill_dir")
      if [ -f "$skill_dir/SKILL.md" ]; then
        cp -r "$skill_dir" "$TARGET_DIR/$skill_name"
        echo "    ✓ $name/$skill_name"
      fi
    done
    # Also copy root-level SKILL.md and supporting dirs
    if [ -f "$clone_dir/SKILL.md" ]; then
      mkdir -p "$TARGET_DIR/$name"
      cp "$clone_dir/SKILL.md" "$TARGET_DIR/$name/SKILL.md"
      [ -d "$clone_dir/bin" ] && cp -r "$clone_dir/bin" "$TARGET_DIR/$name/bin"
      [ -d "$clone_dir/lib" ] && cp -r "$clone_dir/lib" "$TARGET_DIR/$name/lib"
      echo "    ✓ $name (root)"
    fi
  fi
}

echo ""
echo "Checking dependencies..."
DEPS_MISSING=0

if check_dep "superpowers" "brainstorming"; then
  echo "  ✓ superpowers (found)"
else
  echo "  ✗ superpowers (not found)"
  DEPS_MISSING=1
fi

if check_dep "gstack" "ship"; then
  echo "  ✓ gstack (found)"
else
  echo "  ✗ gstack (not found)"
  DEPS_MISSING=1
fi

if [ "$DEPS_MISSING" -eq 1 ]; then
  echo ""
  echo "xp-gate requires superpowers and gstack. Auto-installing..."

  if ! check_dep "superpowers" "brainstorming"; then
    install_dep "superpowers" "$SUPERPOWERS_REPO"
  fi

  if ! check_dep "gstack" "ship"; then
    install_dep "gstack" "$GSTACK_REPO"
  fi

  echo ""
  echo "  Dependencies installed."
fi

# ──────────────────────────────────────────────
# Install xp-gate skills
# ──────────────────────────────────────────────
echo ""
echo "Installing xp-gate skills..."

if [ ! -d "$SKILLS_SOURCE" ]; then
  echo "Error: Skills source directory not found: $SKILLS_SOURCE" >&2
  exit 1
fi

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
