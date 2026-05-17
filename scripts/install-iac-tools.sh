#!/bin/bash

# Install IaC scanning tools for XGate
# Supports: Terraform, Kubernetes, Docker, CloudFormation
# Tools: checkov (recommended), hadolint, kube-score, tflint

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  XGate IaC Tools Installation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "This script installs IaC scanning tools:"
echo "  • checkov    - Multi-platform IaC scanner (recommended)"
echo "  • hadolint   - Dockerfile linter"
echo "  • kube-score - Kubernetes manifest analyzer"
echo "  • tflint     - Terraform linter"
echo ""
echo "Note: checkov is recommended as it supports all platforms."
echo ""

# Detect OS
detect_os() {
  case "$(uname -s)" in
    Linux*)     echo "linux" ;;
    Darwin*)    echo "macos" ;;
    *)          echo "unknown" ;;
  esac
}

OS=$(detect_os)
echo "Detected OS: $OS"
echo ""

# Install checkov (Python-based, supports all platforms)
install_checkov() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Installing checkov (recommended)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  
  # Check if Python is available
  if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ Python 3 is required but not installed."
    echo "   Install Python 3.8+ first, then run: pip3 install checkov"
    return 1
  fi
  
  # Check if pip is available
  if ! command -v pip3 >/dev/null 2>&1; then
    echo "❌ pip3 is required but not installed."
    echo "   Install pip3 first, then run: pip3 install checkov"
    return 1
  fi
  
  echo "Installing checkov via pip3..."
  pip3 install --user checkov
  
  if command -v checkov >/dev/null 2>&1; then
    echo "✅ checkov installed successfully"
    checkov --version
  else
    echo "❌ checkov installation failed or not in PATH"
    echo "   Try: pip3 install --user checkov"
    return 1
  fi
  echo ""
}

# Install hadolint (Dockerfile linter)
install_hadolint() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Installing hadolint"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  
  local HASLINT_BIN="$HOME/.local/bin/hadolint"
  mkdir -p "$HOME/.local/bin"
  
  case "$OS" in
    linux)
      echo "Downloading hadolint for Linux..."
      curl -sSL https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint-Linux-x86_64 -o "$HASLINT_BIN"
      chmod +x "$HASLINT_BIN"
      ;;
    macos)
      echo "Downloading hadolint for macOS..."
      curl -sSL https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint-Darwin-x86_64 -o "$HASLINT_BIN"
      chmod +x "$HASLINT_BIN"
      ;;
    *)
      echo "❌ Unsupported OS: $OS"
      echo "   Download manually from: https://github.com/hadolint/hadolint/releases"
      return 1
      ;;
  esac
  
  if command -v hadolint >/dev/null 2>&1 || [ -f "$HASLINT_BIN" ]; then
    echo "✅ hadolint installed successfully"
    if [ -f "$HASLINT_BIN" ]; then
      echo "   Location: $HASLINT_BIN"
      echo "   Add to PATH: export PATH=\$HOME/.local/bin:\$PATH"
    fi
  else
    echo "❌ hadolint installation failed"
    return 1
  fi
  echo ""
}

# Install kube-score (Kubernetes analyzer)
install_kube_score() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Installing kube-score"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  
  local KUBE_SCORE_BIN="$HOME/.local/bin/kube-score"
  mkdir -p "$HOME/.local/bin"
  
  case "$OS" in
    linux)
      echo "Downloading kube-score for Linux..."
      curl -sSL https://github.com/zegl/kube-score/releases/download/v1.16.0/kube-score_1.16.0_linux_amd64.tar.gz | tar xz -C "$HOME/.local/bin"
      chmod +x "$KUBE_SCORE_BIN"
      ;;
    macos)
      echo "Downloading kube-score for macOS..."
      curl -sSL https://github.com/zegl/kube-score/releases/download/v1.16.0/kube-score_1.16.0_darwin_amd64.tar.gz | tar xz -C "$HOME/.local/bin"
      chmod +x "$KUBE_SCORE_BIN"
      ;;
    *)
      echo "❌ Unsupported OS: $OS"
      echo "   Download manually from: https://github.com/zegl/kube-score/releases"
      return 1
      ;;
  esac
  
  if command -v kube-score >/dev/null 2>&1 || [ -f "$KUBE_SCORE_BIN" ]; then
    echo "✅ kube-score installed successfully"
    if [ -f "$KUBE_SCORE_BIN" ]; then
      echo "   Location: $KUBE_SCORE_BIN"
      echo "   Add to PATH: export PATH=\$HOME/.local/bin:\$PATH"
    fi
  else
    echo "❌ kube-score installation failed"
    return 1
  fi
  echo ""
}

# Install tflint (Terraform linter)
install_tflint() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Installing tflint"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  
  case "$OS" in
    linux)
      echo "Installing tflint via curl..."
      curl -sS https://raw.githubusercontent.com/terraform-linters/tflint/master/install.sh | bash -s -- -b "$HOME/.local/bin" v0.48.0
      ;;
    macos)
      echo "Installing tflint via Homebrew..."
      if command -v brew >/dev/null 2>&1; then
        brew install tflint
      else
        echo "❌ Homebrew not found. Install manually from: https://github.com/terraform-linters/tflint"
        return 1
      fi
      ;;
    *)
      echo "❌ Unsupported OS: $OS"
      echo "   Download manually from: https://github.com/terraform-linters/tflint/releases"
      return 1
      ;;
  esac
  
  if command -v tflint >/dev/null 2>&1; then
    echo "✅ tflint installed successfully"
    tflint --version
  else
    echo "❌ tflint installation failed"
    return 1
  fi
  echo ""
}

# Main installation logic
main() {
  echo ""
  echo "Installation Options:"
  echo "  1. Install all tools (recommended)"
  echo "  2. Install only checkov (recommended minimum)"
  echo "  3. Install specific tools"
  echo ""
  read -p "Choose option [1-3]: " OPTION
  
  case "$OPTION" in
    1)
      echo ""
      echo "Installing all tools..."
      install_checkov
      install_hadolint
      install_kube_score
      install_tflint
      ;;
    2)
      echo ""
      echo "Installing checkov only..."
      install_checkov
      ;;
    3)
      echo ""
      echo "Which tools to install?"
      echo "  a) checkov"
      echo "  b) hadolint"
      echo "  c) kube-score"
      echo "  d) tflint"
      echo ""
      read -p "Enter choices (e.g., abcd): " CHOICES
      
      [[ "$CHOICES" == *"a"* ]] && install_checkov
      [[ "$CHOICES" == *"b"* ]] && install_hadolint
      [[ "$CHOICES" == *"c"* ]] && install_kube_score
      [[ "$CHOICES" == *"d"* ]] && install_tflint
      ;;
    *)
      echo "❌ Invalid option"
      exit 1
      ;;
  esac
  
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Installation Complete!"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "To use the tools, ensure they're in your PATH:"
  echo "  export PATH=\$HOME/.local/bin:\$PATH"
  echo ""
  echo "Add this to your ~/.bashrc or ~/.zshrc to make it permanent."
  echo ""
  echo "Verify installation:"
  echo "  checkov --version"
  echo "  hadolint --version"
  echo "  kube-score version"
  echo "  tflint --version"
  echo ""
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
