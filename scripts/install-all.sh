#!/usr/bin/env bash
# OpenCode Quality Gates - Git Hooks Installation Script
# Installs hooks to TWO locations:
#   1. Project's .git/hooks/ (for current project)
#   2. OpenCode global template ~/.config/opencode/git-hooks-template/
#
# Usage: bash scripts/install-all.sh [--force] [--project-only] [--global-only]

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   OpenCode Git Hooks Installation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: Detect shell
echo "→ Step 1: Detecting shell environment..."
USER_SHELL="${SHELL:-/bin/bash}"
SHELL_NAME=$(basename "$USER_SHELL")

if ! command -v "$SHELL_NAME" &> /dev/null; then
    echo "${YELLOW}⚠️  Shell '$SHELL_NAME' not found, falling back to bash${NC}"
    SHELL_NAME="bash"
fi

echo "${GREEN}✅ Detected shell: $SHELL_NAME${NC}"

if [[ "$SHELL_NAME" = "zsh" ]]; then
    echo "${BLUE}ℹ️  Hooks use POSIX syntax (= not ==), compatible with zsh${NC}"
fi

# Step 2: Verify git repository
echo ""
echo "→ Step 2: Verifying git repository..."

if ! git rev-parse --git-dir &> /dev/null; then
    echo "${RED}❌ ERROR: Not a git repository${NC}"
    exit 1
fi

GIT_DIR=$(git rev-parse --git-dir)
echo "${GREEN}✅ Git repository found${NC}"

# Parse arguments
FORCE_MODE=false
INSTALL_MODE="both"

for arg in "$@"; do
    case "$arg" in
        --force) FORCE_MODE=true ;;
        --project-only) INSTALL_MODE="project-only" ;;
        --global-only) INSTALL_MODE="global-only" ;;
    esac
done

# Step 3: Determine targets
echo ""
echo "→ Step 3: Determining installation targets..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../githooks" && pwd)"
PROJECT_HOOKS_DIR="$GIT_DIR/hooks"
OPENCODE_TEMPLATE_DIR="$HOME/.config/opencode/git-hooks-template"

if [[ "$INSTALL_MODE" = "both" ]]; then
    echo "${BLUE}Installing to BOTH:${NC}"
    echo "   1. Project: $PROJECT_HOOKS_DIR"
    echo "   2. Global:  $OPENCODE_TEMPLATE_DIR"
elif [[ "$INSTALL_MODE" = "project-only" ]]; then
    echo "${BLUE}Installing to PROJECT only:${NC}"
    echo "   Target: $PROJECT_HOOKS_DIR"
else
    echo "${BLUE}Installing to GLOBAL only:${NC}"
    echo "   Target: $OPENCODE_TEMPLATE_DIR"
fi

# Step 4: Install hooks
echo ""
echo "→ Step 4: Installing hooks..."

install_hooks() {
    TARGET_DIR="$1"
    LABEL="$2"
    
    mkdir -p "$TARGET_DIR"
    
    for hook in pre-commit pre-push; do
        SOURCE="$SCRIPT_DIR/$hook"
        TARGET="$TARGET_DIR/$hook"
        
        if [[ ! -f "$SOURCE" ]]; then
            echo "${RED}❌ ERROR: $SOURCE not found${NC}"
            exit 1
        fi
        
        cp "$SOURCE" "$TARGET"
        chmod +x "$TARGET"
        
        echo "${GREEN}✅ $hook → $LABEL${NC}"
    done
}

if [[ "$INSTALL_MODE" = "both" ]] || [[ "$INSTALL_MODE" = "project-only" ]]; then
    install_hooks "$PROJECT_HOOKS_DIR" "Project"
fi

if [[ "$INSTALL_MODE" = "both" ]] || [[ "$INSTALL_MODE" = "global-only" ]]; then
    install_hooks "$OPENCODE_TEMPLATE_DIR" "Global template"
fi

# Step 5: Verify syntax
echo ""
echo "→ Step 5: Verifying syntax..."

verify_hooks() {
    TARGET_DIR="$1"
    LABEL="$2"
    
    for hook in pre-commit pre-push; do
        TARGET="$TARGET_DIR/$hook"
        if "$SHELL_NAME" -n "$TARGET" 2>&1; then
            echo "${GREEN}✅ $hook syntax OK ($LABEL)${NC}"
        else
            echo "${RED}❌ $hook syntax error${NC}"
            return 1
        fi
    done
}

if [[ "$INSTALL_MODE" = "both" ]] || [[ "$INSTALL_MODE" = "project-only" ]]; then
    verify_hooks "$PROJECT_HOOKS_DIR" "Project" || exit 1
fi

if [[ "$INSTALL_MODE" = "both" ]] || [[ "$INSTALL_MODE" = "global-only" ]]; then
    verify_hooks "$OPENCODE_TEMPLATE_DIR" "Global" || exit 1
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   ✅ INSTALLATION SUCCESSFUL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "What happens next:"
echo "  • 'git commit' → Pre-commit checks run automatically"
echo "  • 'git push'   → Pre-push review runs automatically"
echo ""
echo "Shell: $SHELL_NAME (verified)"
echo ""
echo "To reinstall: bash scripts/install-all.sh --force"
echo ""

exit 0