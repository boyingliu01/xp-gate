#!/usr/bin/env bash
# copy-skills.sh: Copy entire skill directories from source to plugin destination
# Usage: copy-skills.sh --source <skills_dir> --dest <target_dir> [--verify]
#
# Copies each subdirectory containing SKILL.md (full directory contents, not just SKILL.md).
# With --verify, validates every copied file by SHA-256 comparison against the source.

set -euo pipefail

SOURCE_DIR=""
DEST_DIR=""
VERIFY=false

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
    --verify)
      VERIFY=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$SOURCE_DIR" ] || [ -z "$DEST_DIR" ]; then
  echo "Usage: copy-skills.sh --source <skills_dir> --dest <target_dir> [--verify]" >&2
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

# --verify: post-copy integrity check via SHA-256 comparison
if $VERIFY; then
  echo ""
  echo "[verify] Checking SHA-256 integrity of copied skills..."
  errors=0
  for skill_dir in "$SOURCE_DIR"/*/; do
    skill_name=$(basename "$skill_dir")
    skill_md="$skill_dir/SKILL.md"
    dest_skill_dir="$DEST_DIR/$skill_name"

    if [[ ! -f "$skill_md" ]] || [[ ! -d "$dest_skill_dir" ]]; then
      continue
    fi

    # Walk every file in the source skill directory, compare checksums
    while IFS= read -r -d '' src_file; do
      rel_path="${src_file#"$skill_dir"}"
      dest_file="$dest_skill_dir/$rel_path"

      if [[ ! -f "$dest_file" ]]; then
        echo "[verify] ERROR: $skill_name/$rel_path — missing in destination" >&2
        errors=$((errors + 1))
        continue
      fi

      src_hash=$(sha256sum "$src_file" | awk '{print $1}')
      dest_hash=$(sha256sum "$dest_file" | awk '{print $1}')

      if [[ "$src_hash" != "$dest_hash" ]]; then
        echo "[verify] ERROR: $skill_name/$rel_path — SHA-256 mismatch" >&2
        errors=$((errors + 1))
      fi
    done < <(find "$skill_dir" -type f -print0)
  done

  if [[ $errors -eq 0 ]]; then
    echo "[verify] OK: all $count skill(s) verified (SHA-256 match)"
  else
    echo "[verify] FAIL: $errors checksum error(s) found" >&2
    exit 1
  fi
fi
