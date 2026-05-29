#!/usr/bin/env bash
# copy-skills.sh: Copy entire skill directories from source to plugin destination
# Usage: copy-skills.sh --source <skills_dir> --dest <target_dir>
#
# Copies each subdirectory containing SKILL.md (full directory contents, not just SKILL.md).

set -euo pipefail

SOURCE_DIR=""
DEST_DIR=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --source)
      SOURCE_DIR="$2"
      shift 2
      ;;
    --dest)
      DEST_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$SOURCE_DIR" ] || [ -z "$DEST_DIR" ]; then
  echo "Usage: copy-skills.sh --source <skills_dir> --dest <target_dir>" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Error: Source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

count=0

# Copy full skill directories (Delphi M3 fix: cp -r entire dir, not just SKILL.md)
for skill_dir in "$SOURCE_DIR"/*/; do
  skill_name=$(basename "$skill_dir")
  skill_md="$skill_dir/SKILL.md"

  if [[ -f "$skill_md" ]]; then
    # Copy entire skill directory (preserves references/, templates/, etc.)
    cp -r "$skill_dir" "$DEST_DIR/"
    echo "Copied: $skill_name"
    count=$((count + 1))
  fi
done

echo "Total skills copied: $count"
