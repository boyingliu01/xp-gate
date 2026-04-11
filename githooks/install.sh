#!/usr/bin/env bash
# OpenCode Quality Gates - Git Hooks Installation Script
#
# This script detects the user's default shell and installs the appropriate
# git hooks for the xp-workflow-automation project.
#
# Usage:
#   ./githooks/install.sh [--force]
#
# Options:
#   --force    Override existing hooks without prompting

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   OpenCode Git Hooks Installation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ============================================================================
# Step 1: Detect user's default shell
# ============================================================================
echo "→ Step 1: Detecting shell environment..."

# Get the user's default shell from $SHELL or fallback
USER_SHELL="${SHELL:-/bin/bash}"
SHELL_NAME=$(basename "$USER_SHELL")

# Verify shell is actually available
if ! command -v "$SHELL_NAME" &> /dev/null; then
    # Fallback to bash if the detected shell is not available
    echo "${YELLOW}⚠️  Detected shell '$SHELL_NAME' not found in PATH.${NC}"
    echo "${BLUE}Falling back to bash...${NC}"
    SHELL_NAME="bash"
fi

echo "${GREEN}✅ Detected shell: $SHELL_NAME ($USER_SHELL)${NC}"

# Check if this is zsh and display compatibility info
if [[ "$SHELL_NAME" == "zsh" ]]; then
    echo "${BLUE}ℹ️  Running in zsh environment.${NC}"
    echo "   Hooks use POSIX-compatible syntax (= instead of ==)."
    echo "   Scripts are written for bash but work with zsh."
fi

# ============================================================================
# Step 2: Verify git repository
# ============================================================================
echo ""
echo "→ Step 2: Verifying git repository..."

if ! git rev-parse --git-dir &> /dev/null; then
    echo "${RED}❌ ERROR: Not a git repository.${NC}"
    echo "Please run this script from within a git repository."
    exit 1
fi

GIT_DIR=$(git rev-parse --git-dir)
HOOKS_DIR="$GIT_DIR/hooks"

echo "${GREEN}✅ Git repository found${NC}"
echo "   Git directory: $GIT_DIR"
echo "   Hooks directory: $HOOKS_DIR"

# ============================================================================
# Step 3: Check for existing hooks
# ============================================================================
echo ""
echo "→ Step 3: Checking for existing hooks..."

FORCE_MODE=false
if [[ "$1" == "--force" ]]; then
    FORCE_MODE=true
fi

EXISTING_HOOKS=""
for hook in pre-commit pre-push; do
    if [[ -f "$HOOKS_DIR/$hook" ]]; then
        EXISTING_HOOKS="$EXISTING_HOOKS $hook"
    fi
done

if [[ -n "$EXISTING_HOOKS" ]]; then
    if [[ "$FORCE_MODE" == "true" ]]; then
        echo "${YELLOW}⚠️  Existing hooks found: $EXISTING_HOOKS${NC}"
        echo "${BLUE}Force mode enabled - will overwrite.${NC}"
    else
        echo "${YELLOW}⚠️  Existing hooks found: $EXISTING_HOOKS${NC}"
        echo ""
        read -p "Do you want to overwrite existing hooks? [y/N] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "${RED}❌ Installation cancelled.${NC}"
            echo "Use --force to override without prompting."
            exit 1
        fi
        echo "${BLUE}Proceeding with overwrite...${NC}"
    fi
fi

# ============================================================================
# Step 4: Copy hooks and set permissions
# ============================================================================
echo ""
echo "→ Step 4: Installing hooks..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure hooks directory exists
mkdir -p "$HOOKS_DIR"

for hook in pre-commit pre-push; do
    SOURCE="$SCRIPT_DIR/$hook"
    TARGET="$HOOKS_DIR/$hook"
    
    if [[ ! -f "$SOURCE" ]]; then
        echo "${RED}❌ ERROR: Hook source not found: $SOURCE${NC}"
        exit 1
    fi
    
    # Copy the hook
    cp "$SOURCE" "$TARGET"
    
    # Set executable permissions (chmod +x)
    chmod +x "$TARGET"
    
    echo "${GREEN}✅ Installed: $hook${NC}"
done

# ============================================================================
# Step 5: Verify installation
# ============================================================================
echo ""
echo "→ Step 5: Verifying installation..."

# Syntax check with the detected shell
SYNTAX_OK=true
for hook in pre-commit pre-push; do
    if "$SHELL_NAME" -n "$HOOKS_DIR/$hook" 2>&1; then
        echo "${GREEN}✅ Syntax check passed: $hook (using $SHELL_NAME)${NC}"
    else
        echo "${RED}❌ Syntax check failed: $hook${NC}"
        SYNTAX_OK=false
    fi
done

if [[ "$SYNTAX_OK" == "false" ]]; then
    echo "${RED}❌ Installation completed but syntax errors detected.${NC}"
    echo "Please check the hook files manually."
    exit 1
fi

# ============================================================================
# Step 6: Display summary
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   ✅ INSTALLATION SUCCESSFUL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Installed hooks:"
echo "  • pre-commit  → Runs static analysis, tests before commit"
echo "  • pre-push    → Runs multi-model code review before push"
echo ""
echo "Shell compatibility:"
echo "  • User shell: $SHELL_NAME"
echo "  • Hooks tested with: $SHELL_NAME"
echo ""
echo "What happens next:"
echo "  • 'git commit' → Pre-commit checks will run automatically"
echo "  • 'git push'   → Pre-push code walkthrough will run automatically"
echo ""
echo "To bypass hooks temporarily:"
echo "  • git commit --no-verify"
echo "  • git push --no-verify"
echo ""
echo "To uninstall:"
echo "  • rm $HOOKS_DIR/pre-commit $HOOKS_DIR/pre-push"
echo ""

exit 0