#!/usr/bin/env bash
set -euo pipefail

# XP-Gate: Install gitleaks for pre-commit secret scanning
# Usage: bash scripts/install-gitleaks.sh

detect_os() {
  case "$(uname -s)" in
    Darwin*)  echo "darwin" ;;
    Linux*)   echo "linux" ;;
    *)        echo "unknown" ;;
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

main "$@"
