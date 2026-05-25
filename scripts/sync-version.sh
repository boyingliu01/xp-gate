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

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$ROOT_DIR/VERSION"
ROOT_PKG="$ROOT_DIR/package.json"
NPM_PKG="$ROOT_DIR/src/npm-package/package.json"

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

echo "[sync-version] OK — all package.json version fields synced from VERSION ($FULL_VERSION)"
