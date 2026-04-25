#!/usr/bin/env bash
# Delphi Review Skill Installation Script
# Usage: bash scripts/install-delphi-review.sh [--force]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_SRC="$PROJECT_ROOT/skills/delphi-review"

OPENCODE_SKILLS="$HOME/.config/opencode/skills/delphi-review"
mkdir -p "$OPENCODE_SKILLS"

for f in "$SKILL_SRC"/SKILL.md "$SKILL_SRC"/*.json "$SKILL_SRC"/references/*.md; do
  [[ -f "$f" ]] || continue
  rel="${f#$SKILL_SRC/}"
  mkdir -p "$(dirname "$OPENCODE_SKILLS/$rel")"
  cp "$f" "$OPENCODE_SKILLS/$rel"
done

echo "✅ Delphi Review skill installed → $OPENCODE_SKILLS/"
echo ""
echo "Next steps:"
echo "  1. Copy .delphi-config.json.example → .delphi-config.json"
echo "     cp $SKILL_SRC/.delphi-config.json.example .delphi-config.json"
echo "  2. Edit .delphi-config.json with your API keys and models"
echo ""
echo "  3. Add agent definitions to your opencode.json (see opencode.json.delphi.example)"
echo ""
echo "Usage:"
echo "  /delphi-review                      # Design mode"
echo "  /delphi-review --mode code-walkthrough  # Code walkthrough"
