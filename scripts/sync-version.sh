#!/usr/bin/env bash
# sync-version.sh — 单源真理：从 VERSION 文件同步版本号到所有 package.json
#
# VERSION 文件是唯一版本源头（格式：MAJOR.MINOR.PATCH.MICRO）
# 根 package.json 使用完整的 MAJOR.MINOR.PATCH.MICRO
# src/npm-package/package.json 使用 MAJOR.MINOR.PATCH（npm semver）
#
# 使用方式：
#   修改 VERSION 后，运行此脚本自动同步
#   或作为 prepare/postinstall hook 自动执行

set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$ROOT_DIR/VERSION"
ROOT_PKG="$ROOT_DIR/package.json"
NPM_PKG="$ROOT_DIR/src/npm-package/package.json"
CLAUDE_PLUGIN="$ROOT_DIR/plugins/claude-code/.claude-plugin/plugin.json"
OPENCODE_PLUGIN="$ROOT_DIR/plugins/opencode/package.json"

if [ ! -f "$VERSION_FILE" ]; then
  echo "[sync-version] ERROR: VERSION file not found at $VERSION_FILE"
  exit 1
fi

FULL_VERSION="$(tr -d '\r\n[:space:]' < "$VERSION_FILE")"

if ! echo "$FULL_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "[sync-version] ERROR: VERSION '$FULL_VERSION' does not match MAJOR.MINOR.PATCH.MICRO"
  exit 1
fi

# npm semver 格式：去掉第4位
NPM_VERSION="$(echo "$FULL_VERSION" | sed 's/\.[0-9]*$//')"

# --- 根 package.json ---
if [ -f "$ROOT_PKG" ]; then
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$ROOT_PKG', 'utf8'));
    pkg.version = '$FULL_VERSION';
    fs.writeFileSync('$ROOT_PKG', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "[sync-version] root package.json -> $FULL_VERSION"
fi

# --- npm-package/package.json ---
if [ -f "$NPM_PKG" ]; then
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$NPM_PKG', 'utf8'));
    pkg.version = '$NPM_VERSION';
    fs.writeFileSync('$NPM_PKG', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "[sync-version] src/npm-package/package.json -> $NPM_VERSION"
fi

# --- Claude Code plugin manifest ---
if [ -f "$CLAUDE_PLUGIN" ]; then
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$CLAUDE_PLUGIN', 'utf8'));
    pkg.version = '$NPM_VERSION';
    fs.writeFileSync('$CLAUDE_PLUGIN', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "[sync-version] plugins/claude-code/.claude-plugin/plugin.json -> $NPM_VERSION"
fi

# --- OpenCode plugin package.json ---
if [ -f "$OPENCODE_PLUGIN" ]; then
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$OPENCODE_PLUGIN', 'utf8'));
    pkg.version = '$NPM_VERSION';
    fs.writeFileSync('$OPENCODE_PLUGIN', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "[sync-version] plugins/opencode/package.json -> $NPM_VERSION"
fi

# --- npm-package mirror copies (for Mirror Parity CI check) ---
NPM_CLAUDE_PLUGIN="$ROOT_DIR/src/npm-package/plugins/claude-code/.claude-plugin/plugin.json"
NPM_OPENCODE_PLUGIN="$ROOT_DIR/src/npm-package/plugins/opencode/package.json"

if [ -f "$NPM_CLAUDE_PLUGIN" ]; then
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$NPM_CLAUDE_PLUGIN', 'utf8'));
    pkg.version = '$NPM_VERSION';
    fs.writeFileSync('$NPM_CLAUDE_PLUGIN', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "[sync-version] src/npm-package/plugins/claude-code/.claude-plugin/plugin.json -> $NPM_VERSION"
fi

if [ -f "$NPM_OPENCODE_PLUGIN" ]; then
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$NPM_OPENCODE_PLUGIN', 'utf8'));
    pkg.version = '$NPM_VERSION';
    fs.writeFileSync('$NPM_OPENCODE_PLUGIN', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "[sync-version] src/npm-package/plugins/opencode/package.json -> $NPM_VERSION"
fi

# Header-only refresh for AGENTS.md mirrors (issue #206).
# Walks every AGENTS.md and updates the 3 metadata header lines from VERSION + git HEAD + today's date.
# Body content is untouched — re-run /init-deep when body content goes stale.
TODAY="$(date +%Y-%m-%d)"
HEAD_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

AGENTS_COUNT=0
while IFS= read -r -d '' agents_file; do
  node -e "
    const fs = require('fs');
    const p = '$agents_file';
    let c = fs.readFileSync(p, 'utf8');
    let changed = false;
    const repl = [
      [/^\*\*Generated:\*\*.*$/m, '**Generated:** $TODAY'],
      [/^\*\*Commit:\*\*.*$/m,    '**Commit:** $HEAD_SHA'],
      [/^\*\*Branch:\*\*.*$/m,    '**Branch:** $BRANCH'],
      [/^\*\*Version:\*\*.*$/m,   '**Version:** $FULL_VERSION'],
    ];
    for (const [re, rep] of repl) {
      if (re.test(c)) { c = c.replace(re, rep); changed = true; }
    }
    if (changed) { fs.writeFileSync(p, c); process.exit(0); }
    process.exit(2);
  " && AGENTS_COUNT=$((AGENTS_COUNT + 1)) || true
done < <(find "$ROOT_DIR" -name 'AGENTS.md' -not -path '*/node_modules/*' -not -path '*/.git/*' -print0)
echo "[sync-version] AGENTS.md headers refreshed: $AGENTS_COUNT files (date=$TODAY commit=$HEAD_SHA branch=$BRANCH version=$FULL_VERSION)"

echo "[sync-version] OK — all package.json version fields synced from VERSION ($FULL_VERSION)"
