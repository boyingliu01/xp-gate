#!/usr/bin/env bash
# Delphi Review Skill Installation Script
# Usage: bash scripts/install-delphi-review.sh [--force]
#
# Platform-aware (#414 REQ-2): a ~/.qoder directory means Qoder is the active
# IDE and the skill belongs in ~/.qoder/skills/. Everything else keeps the
# historical OpenCode destination. The official npm path
# (`xp-gate install-skill delphi-review`) remains the preferred installer;
# this script is the no-CLI fallback and must not drift from it.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_SRC="$PROJECT_ROOT/skills/delphi-review"

if [[ -d "$HOME/.qoder" ]]; then
  SKILL_DEST="$HOME/.qoder/skills/delphi-review"
  PLATFORM="qoder"
else
  SKILL_DEST="$HOME/.config/opencode/skills/delphi-review"
  PLATFORM="opencode"
fi

if [[ -d "$SKILL_DEST" ]]; then
  echo "ℹ️  Existing install found at $SKILL_DEST"
  echo "   The script overwrites shared files in place; use 'xp-gate install-skill delphi-review --force'"
  echo "   for a backed-up, versioned reinstall."
fi

mkdir -p "$SKILL_DEST"

for f in "$SKILL_SRC"/SKILL.md "$SKILL_SRC"/*.json "$SKILL_SRC"/references/*.md; do
  [[ -f "$f" ]] || continue
  rel="${f#$SKILL_SRC/}"
  mkdir -p "$(dirname "$SKILL_DEST/$rel")"
  cp "$f" "$SKILL_DEST/$rel"
done

echo "✅ Delphi Review skill installed → $SKILL_DEST/ (platform: $PLATFORM)"

if [[ ! -f ".delphi-config.json" ]]; then
  if [[ -f "$SKILL_SRC/.delphi-config.json.example" ]]; then
    cp "$SKILL_SRC/.delphi-config.json.example" ".delphi-config.json"
    echo "✅ .delphi-config.json initialized from example"
    echo "   Edit .delphi-config.json to configure your models"
  else
    echo "⚠️  .delphi-config.json.example not found — please create .delphi-config.json manually"
  fi
else
  echo "ℹ️  .delphi-config.json already exists — skipping initialization"
fi

echo ""
echo "Next steps:"
echo "  1. Edit .delphi-config.json with your API keys and models"
if [[ "$PLATFORM" == "qoder" ]]; then
  echo "  2. Bind the three expert agents: xp-gate delphi-setup --model architecture=<id> --model technical=<id> --model feasibility=<id>"
  echo "  3. Reload Qoder (agent definitions load only at session start)"
else
  echo "  2. Add agent definitions to your opencode.json (see opencode.json.delphi.example)"
fi
echo ""
echo "Usage:"
echo "  /delphi-review                      # Design mode"
echo "  /delphi-review --mode code-walkthrough  # Code walkthrough"
