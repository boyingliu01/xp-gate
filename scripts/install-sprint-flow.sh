#!/usr/bin/env bash
# Sprint Flow Skill Installation Script
# Usage: bash scripts/install-sprint-flow.sh [--force]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_SRC="$PROJECT_ROOT/skills/sprint-flow"
OPENCODE_SKILLS="$HOME/.config/opencode/skills/sprint-flow"

mkdir -p "$OPENCODE_SKILLS/references" "$OPENCODE_SKILLS/templates"

for f in "$SKILL_SRC"/SKILL.md "$SKILL_SRC"/references/*.md "$SKILL_SRC"/templates/*.md; do
  [[ -f "$f" ]] || continue
  rel="${f#$SKILL_SRC/}"
  mkdir -p "$(dirname "$OPENCODE_SKILLS/$rel")"
  cp "$f" "$OPENCODE_SKILLS/$rel"
done

echo "✅ Sprint Flow skill installed → $OPENCODE_SKILLS/"
echo ""
echo "Usage:"
echo '  /sprint-flow "开发功能，支持多轮对话"'
echo ""
echo "Sprint Flow orchestrates all other skills (delphi-review, test-spec-alignment)."
echo "If those are not installed, Sprint Flow will still work but limited to its own functionality."
