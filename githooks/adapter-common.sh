#!/usr/bin/env bash

# Common adapter functions for language detection and routing

detect_project_lang() {
  # Determine language based on project files
  if [[ -f "tsconfig.json" ]]; then
    echo "typescript"
  elif [[ -f "pyproject.toml" ]] || [[ -f "requirements.txt" ]] || [[ -f "setup.py" ]]; then
    echo "python"
  elif [[ -f "go.mod" ]]; then
    echo "go"
  elif [[ -n "$(find . -name "*.sh" -type f | head -n 1)" ]] || [[ -n "$(find . -name "Dockerfile" -o -name "*.dockerfile" -type f | head -n 1)" ]]; then
    echo "shell"
  else
    # Fallback: check for any language-specific files
    if [[ -n "$(find . -name "*.ts" -o -name "*.tsx" -type f | head -n 1)" ]]; then
      echo "typescript"
    elif [[ -n "$(find . -name "*.py" -type f | head -n 1)" ]]; then
      echo "python"
    elif [[ -n "$(find . -name "*.go" -type f | head -n 1)" ]]; then
      echo "go"
    elif [[ -n "$(find . -name "*.sh" -type f | head -n 1)" ]]; then
      echo "shell"
    else
      echo "unknown"
    fi
  fi
}

route_to_adapter() {
  local action="$1"
  local lang
  lang=$(detect_project_lang)
  
  # Source the appropriate adapter
  if [[ -f "githooks/adapters/${lang}.sh" ]]; then
    # shellcheck source=githooks/adapters/"${lang}".sh
    source "githooks/adapters/${lang}.sh"
    
    # Execute the requested action
    case "$action" in
      "static_analysis") run_static_analysis ;;
      "lint") run_lint ;;
      "tests") run_tests ;;
      "coverage") run_coverage ;;
      *) return 1 ;;
    esac
  elif [[ -f "./githooks/adapters/${lang}.sh" ]]; then
    # Alternative: source with ./ prefix
    # shellcheck source=./githooks/adapters/"${lang}".sh
    source "./githooks/adapters/${lang}.sh"
    
    # Execute the requested action
    case "$action" in
      "static_analysis") run_static_analysis ;;
      "lint") run_lint ;;
      "tests") run_tests ;;
      "coverage") run_coverage ;;
      *) return 1 ;;
    esac
  else
    echo "No adapter found for language: $lang"
    return 1
  fi
}

check_if_tool_available() {
  local tool_name="$1"
  
  # Check if command exists
  if command -v "$tool_name" >/dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

require_tool() {
  local tool_name="$1"
  local gate_name="${2:-Gate}"
  local install_hint="${3:-}"
  
  if command -v "$tool_name" >/dev/null 2>&1; then
    return 0
  fi
  
  if command -v npx >/dev/null 2>&1 && npx --no-install "$tool_name" --version >/dev/null 2>&1; then
    return 0
  fi
  
  echo "❌ BLOCKED - Required tool '$tool_name' not available for $gate_name"
  if [[ -n "$install_hint" ]]; then
    echo "   Install: $install_hint"
  fi
  echo "   Per QUALITY-GATES-CODE-OF-CONDUCT.md: tool unavailable = BLOCK, not SKIP"
  return 1
}