#!/usr/bin/env bash
# Test-Specification Alignment Skill Installation Script
# Usage: bash scripts/install-test-spec-alignment.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_SRC="$PROJECT_ROOT/skills/test-specification-alignment"
OPENCODE_SKILLS="$HOME/.config/opencode/skills/test-specification-alignment"

mkdir -p "$OPENCODE_SKILLS/references"

for f in "$SKILL_SRC"/SKILL.md "$SKILL_SRC"/references/*.md; do
  [[ -f "$f" ]] || continue
  rel="${f#$SKILL_SRC/}"
  mkdir -p "$(dirname "$OPENCODE_SKILLS/$rel")"
  cp "$f" "$OPENCODE_SKILLS/$rel"
done

echo "✅ Test-Specification Alignment skill installed → $OPENCODE_SKILLS/"
echo ""
echo "Usage:"
echo "  /test-specification-alignment"
