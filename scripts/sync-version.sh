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
#
# 依赖策略：
#   - JSON 版本号更新：首选 Node.js（精确 JSON 处理），无 Node 时降级为 sed
#   - AGENTS.md 头部更新：首选 Node.js（正则更灵活），无 Node 时降级为 sed
#   - sed 作为兜底确保脚本在任何 Bash 环境都能工作（CI 上纯 Bash runner 等）

set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# #392-#2: `pwd` in Git Bash/MSYS returns a POSIX path (/d/projects/xp-gate),
# which Node on Windows cannot resolve (it becomes D:\d\projects\...). Convert
# to a Windows-style path (D:/projects/xp-gate) so every interpolated path that
# reaches `node -e` is resolvable. Non-MSYS Bash (macOS/Linux/CI) has no
# cygpath, so leave ROOT_DIR as-is there.
if command -v cygpath >/dev/null 2>&1; then
  ROOT_DIR="$(cygpath -m "$ROOT_DIR")"
fi
VERSION_FILE="$ROOT_DIR/VERSION"
ROOT_PKG="$ROOT_DIR/package.json"
NPM_PKG="$ROOT_DIR/src/npm-package/package.json"
CLAUDE_PLUGIN="$ROOT_DIR/plugins/claude-code/.claude-plugin/plugin.json"
OPENCODE_PLUGIN="$ROOT_DIR/plugins/opencode/package.json"
QODE_PLUGIN="$ROOT_DIR/plugins/qoder/plugin.json"

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

# ---------- 通用函数 ----------

# 更新 JSON 文件中的顶层 "version" 字段
# 首选 Node.js（精确 JSON 解析，保留格式），无 Node 时降级为 sed
# 用法: sync_json_version <file> <new_version>
sync_json_version() {
  local file="$1"
  local new_version="$2"

  if command -v node >/dev/null 2>&1; then
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$file', 'utf8'));
      pkg.version = '$new_version';
      fs.writeFileSync('$file', JSON.stringify(pkg, null, 2) + '\n');
    "
  else
    # sed fallback: 替换第一个 "version": "..." 行
    # 使用 -i.bak 兼容 macOS/BSD sed；成功后删除 .bak 文件
    local sed_i
    case "$(uname -s 2>/dev/null || echo Linux)" in
      Darwin*) sed_i="sed -i '' -E" ;;
      *)       sed_i="sed -i -E" ;;
    esac
    # 匹配顶层 "version" 字段（行首空白 + "version": "..."）—— 避免嵌套依赖的误匹配
    $sed_i 's/^([[:space:]]*)"version":[[:space:]]*"[^"]*"/\1"version": "'"$new_version"'"/' "$file"
  fi
}

# ---------- JSON 版本号同步 ----------

# --- 根 package.json ---
if [ -f "$ROOT_PKG" ]; then
  sync_json_version "$ROOT_PKG" "$FULL_VERSION"
  echo "[sync-version] root package.json -> $FULL_VERSION"
fi

# --- npm-package/package.json ---
if [ -f "$NPM_PKG" ]; then
  sync_json_version "$NPM_PKG" "$NPM_VERSION"
  echo "[sync-version] src/npm-package/package.json -> $NPM_VERSION"
fi

# --- Claude Code plugin manifest ---
if [ -f "$CLAUDE_PLUGIN" ]; then
  sync_json_version "$CLAUDE_PLUGIN" "$NPM_VERSION"
  echo "[sync-version] plugins/claude-code/.claude-plugin/plugin.json -> $NPM_VERSION"
fi

# --- OpenCode plugin package.json ---
if [ -f "$OPENCODE_PLUGIN" ]; then
  sync_json_version "$OPENCODE_PLUGIN" "$NPM_VERSION"
  echo "[sync-version] plugins/opencode/package.json -> $NPM_VERSION"
fi

# --- Qoder plugin manifest ---
if [ -f "$QODE_PLUGIN" ]; then
  sync_json_version "$QODE_PLUGIN" "$NPM_VERSION"
  echo "[sync-version] plugins/qoder/plugin.json -> $NPM_VERSION"
fi

# --- npm-package mirror copies (for Mirror Parity CI check) ---
NPM_CLAUDE_PLUGIN="$ROOT_DIR/src/npm-package/plugins/claude-code/.claude-plugin/plugin.json"
NPM_OPENCODE_PLUGIN="$ROOT_DIR/src/npm-package/plugins/opencode/package.json"
NPM_QODE_PLUGIN="$ROOT_DIR/src/npm-package/plugins/qoder/plugin.json"

if [ -f "$NPM_CLAUDE_PLUGIN" ]; then
  sync_json_version "$NPM_CLAUDE_PLUGIN" "$NPM_VERSION"
  echo "[sync-version] src/npm-package/plugins/claude-code/.claude-plugin/plugin.json -> $NPM_VERSION"
fi

if [ -f "$NPM_OPENCODE_PLUGIN" ]; then
  sync_json_version "$NPM_OPENCODE_PLUGIN" "$NPM_VERSION"
  echo "[sync-version] src/npm-package/plugins/opencode/package.json -> $NPM_VERSION"
fi

if [ -f "$NPM_QODE_PLUGIN" ]; then
  sync_json_version "$NPM_QODE_PLUGIN" "$NPM_VERSION"
  echo "[sync-version] src/npm-package/plugins/qoder/plugin.json -> $NPM_VERSION"
fi

# ---------- AGENTS.md 头部更新 ----------
#
# ⚠️ 只同步 Version —— 与 scripts/sync-version.cjs 保持一致，别在这里加回日期/sha/分支。
#
# 本脚本被 cross-platform-ci 调用，用来验证「提交的镜像与正本一致」。若它把当天日期、
# HEAD sha、分支名写进 AGENTS.md 头部，那么同步之后的镜像与正本必然在头部不同，于是
# 那个校验永远无法直接比对，只能靠 sed 剥离头部再比 —— 而那种豁免正是病灶：
# 同一份内容在不同运行条件下产出不同字节，任何「比对两份文件」的守卫都会误报，
# 只能逐个打补丁绕开。
#
# 后果的实证见 #752：安装阶段弄脏 32 个跟踪文件，mutation job 因此每次都红。
# 版本号是内容属性（改 VERSION 才变），保留；其余交给显式动作。
# 守卫：scripts/__tests__/sync-version-deterministic.test.cjs

AGENTS_COUNT=0
while IFS= read -r -d '' agents_file; do
  if command -v node >/dev/null 2>&1; then
    node -e "
      const fs = require('fs');
      const p = '$agents_file';
      let c = fs.readFileSync(p, 'utf8');
      let changed = false;
      const repl = [
        [/^\*\*Version:\*\*.*$/m,   '**Version:** $FULL_VERSION'],
      ];
      for (const [re, rep] of repl) {
        if (re.test(c)) { c = c.replace(re, rep); changed = true; }
      }
      if (changed) { fs.writeFileSync(p, c); process.exit(0); }
      process.exit(2);
    " && AGENTS_COUNT=$((AGENTS_COUNT + 1)) || true
  else
    # sed fallback: 只替换 Version（见上）
    sed_i=""
    case "$(uname -s 2>/dev/null || echo Linux)" in
      Darwin*) sed_i="sed -i ''" ;;
      *)       sed_i="sed -i" ;;
    esac
    $sed_i "s|^\*\*Version:\*\*.*|**Version:** $FULL_VERSION|"          "$agents_file"
    AGENTS_COUNT=$((AGENTS_COUNT + 1))
  fi
done < <(find "$ROOT_DIR" -name 'AGENTS.md' -not -path '*/node_modules/*' -not -path '*/.git/*' -print0)
echo "[sync-version] AGENTS.md headers refreshed: $AGENTS_COUNT files (version=$FULL_VERSION)"

echo "[sync-version] OK — all package.json version fields synced from VERSION ($FULL_VERSION)"
