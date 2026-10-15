#!/usr/bin/env bash
set -euo pipefail

# XP-Gate: Install gitleaks for pre-commit secret scanning
# Usage: bash scripts/install-gitleaks.sh

detect_os() {
  case "$(uname -s)" in
    Darwin*)              echo "darwin" ;;
    Linux*)               echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)                    echo "unknown" ;;
  esac
}

detect_arch() {
  local arch
  arch=$(uname -m)
  case "$arch" in
    x86_64|amd64)  echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)             echo "$arch" ;;
  esac
}

# #511 / Major-1 (Delphi): the Windows installer drops gitleaks.exe into
# ~/.local/bin, but that dir is NOT on Git Bash's default PATH. Without
# persistence the next commit's `command -v gitleaks` still fails-closed
# (Gate 8), so "--with-tools installed it" never actually made it usable.
# Appending `export PATH="$HOME/.local/bin:$PATH"` to the user's shell config
# makes the install stick across shells. Idempotent: never appends twice.
persist_gitbash_path() {
  local bin_dir="$HOME/.local/bin"
  local export_line="export PATH=\"$bin_dir:\$PATH\""
  local rc="$HOME/.bashrc"

  # Prefer .bash_profile for a login-only Git Bash, but fall back to .bashrc;
  # appending to whichever exists (or .bashrc if neither) covers both setups.
  [ -f "$HOME/.bash_profile" ] && rc="$HOME/.bash_profile"

  if grep -qF "$bin_dir" "$rc" 2>/dev/null; then
    echo "  ✓ PATH entry already present in $rc"
    return 0
  fi

  {
    printf '\n# XP-Gate: gitleaks install (scripts/install-gitleaks.sh)\n'
    printf '%s\n' "$export_line"
  } >> "$rc"
  echo "  ✓ Persisted PATH in $rc"
  echo "  Run 'source $rc' in current shells, or open a new terminal."
}

main() {
  if command -v gitleaks >/dev/null 2>&1; then
    echo "Already installed: $(gitleaks --version 2>/dev/null)"
    return 0
  fi

  local OS
  OS=$(detect_os)
  local ARCH
  ARCH=$(detect_arch)

  echo "Installing gitleaks for $OS/$ARCH..."

  if [ "$OS" = "darwin" ]; then
    if command -v brew >/dev/null 2>&1; then
      brew install gitleaks
      echo "Installed via Homebrew: $(gitleaks --version)"
      return 0
    fi
  fi

  # Manual install from GitHub releases
  local VERSION
  VERSION=$(curl -sL "https://api.github.com/repos/gitleaks/gitleaks/releases/latest" \
    | grep -o '"tag_name": "v[^"]*"' | head -1 | grep -o 'v[^"]*')

  VERSION="${VERSION:-v8.24.2}"

  # Windows releases are .zip archives containing gitleaks.exe, not .tar.gz
  # (gitleaks publishes no tarball for the windows asset). Handled before the
  # Unix path so a native Windows user gets a working binary instead of a
  # failed tar extraction (#511).
  if [ "$OS" = "windows" ]; then
    local WIN_URL="https://github.com/gitleaks/gitleaks/releases/download/${VERSION}/gitleaks_${VERSION#v}_windows_${ARCH}.zip"
    local WIN_BIN_DIR="$HOME/.local/bin"
    local WIN_TMP
    WIN_TMP=$(mktemp -d)
    mkdir -p "$WIN_BIN_DIR"
    echo "Downloading $WIN_URL..."
    if curl -sL "$WIN_URL" -o "$WIN_TMP/gitleaks.zip" && command -v unzip >/dev/null 2>&1; then
      unzip -o -q "$WIN_TMP/gitleaks.zip" -d "$WIN_TMP"
      mv "$WIN_TMP/gitleaks.exe" "$WIN_BIN_DIR/gitleaks.exe"
      rm -rf "$WIN_TMP"
      echo "Installed: $WIN_BIN_DIR/gitleaks.exe"
      # #511 / Major-1: persist the dir on Git Bash's PATH so the very next
      # commit (Gate 8, `command -v gitleaks`) succeeds — not just this shell.
      persist_gitbash_path
      echo ""
      echo "Next commit will find gitleaks on PATH (Gate 8, fail-closed #499)."
      return 0
    fi
    rm -rf "$WIN_TMP"
    echo "⚠ Could not auto-install on Windows (need curl + unzip)."
    echo "  Download manually: https://github.com/gitleaks/gitleaks/releases"
    echo "  then put gitleaks.exe on your PATH."
    return 1
  fi

  local DOWNLOAD_URL="https://github.com/gitleaks/gitleaks/releases/download/${VERSION}/gitleaks_${VERSION#v}_${OS}_${ARCH}.tar.gz"
  local TMP_DIR
  TMP_DIR=$(mktemp -d)

  echo "Downloading $DOWNLOAD_URL..."
  curl -sL "$DOWNLOAD_URL" -o "$TMP_DIR/gitleaks.tar.gz"
  tar -xzf "$TMP_DIR/gitleaks.tar.gz" -C "$TMP_DIR"

  local BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"

  if [[ -f "$TMP_DIR/gitleaks" ]]; then
    mv "$TMP_DIR/gitleaks" "$BIN_DIR/gitleaks"
  else
    mv "$TMP_DIR"/gitleaks_*/*gitleaks* "$BIN_DIR/gitleaks" 2>/dev/null || {
      cp "$TMP_DIR/gitleaks" "$BIN_DIR/gitleaks" || {
        find "$TMP_DIR" -name "gitleaks" -type f | head -1 | xargs -I{} cp {} "$BIN_DIR/gitleaks"
      }
    }
  fi

  chmod +x "$BIN_DIR/gitleaks"

  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo ""
    echo "Add to your shell config:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi

  echo "Installed: $($BIN_DIR/gitleaks --version)"
  rm -rf "$TMP_DIR"
}

# Run as a script; sourcing (bats unit tests) only defines the functions.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
