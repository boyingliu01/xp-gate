#!/usr/bin/env bash

# Common adapter functions for language detection and routing

detect_project_lang() {
  if [[ -f "tsconfig.json" ]]; then
    echo "typescript"
  elif [[ -f "pyproject.toml" ]] || [[ -f "requirements.txt" ]] || [[ -f "setup.py" ]]; then
    echo "python"
  elif [[ -f "go.mod" ]]; then
    echo "go"
  elif [[ -f "build.gradle" ]] || [[ -f "build.gradle.kts" ]]; then
    if [[ -n "$(find . -name "*.kt" -type f | head -n 1)" ]]; then
      echo "kotlin"
    else
      echo "java"
    fi
  elif [[ -f "pom.xml" ]]; then
    echo "java"
  elif [[ -f "pubspec.yaml" ]]; then
    if grep -q "flutter:" "pubspec.yaml" 2>/dev/null || [[ -f ".metadata" ]]; then
      echo "flutter"
    else
      echo "dart"
    fi
  elif [[ -n "$(find . -name "*.ps1" -type f | head -n 1)" ]]; then
    echo "powershell"
  elif [[ -f "Package.swift" ]]; then
    echo "swift"
  elif [[ -f "CMakeLists.txt" ]] || [[ -n "$(find . -name "*.cpp" -o -name "*.cc" -type f | head -n 1)" ]]; then
    echo "cpp"
  elif [[ -n "$(find . -name "*.m" -o -name "*.mm" -type f | head -n 1)" ]]; then
    echo "objectivec"
  elif [[ -n "$(find . -name "*.sh" -type f | head -n 1)" ]] || [[ -n "$(find . -name "Dockerfile" -o -name "*.dockerfile" -type f | head -n 1)" ]]; then
    echo "shell"
  elif [[ -n "$(find . -name "*.ps1" -type f -not -path "./.git/*" | head -n 1)" ]]; then
    echo "powershell"
  else
    if [[ -n "$(find . -name "*.ts" -o -name "*.tsx" -type f | head -n 1)" ]]; then
      echo "typescript"
    elif [[ -n "$(find . -name "*.py" -type f | head -n 1)" ]]; then
      echo "python"
    elif [[ -n "$(find . -name "*.go" -type f | head -n 1)" ]]; then
      echo "go"
    elif [[ -n "$(find . -name "*.kt" -type f | head -n 1)" ]]; then
      echo "kotlin"
    elif [[ -n "$(find . -name "*.java" -type f | head -n 1)" ]]; then
      echo "java"
    elif [[ -n "$(find . -name "*.dart" -type f | head -n 1)" ]]; then
      if grep -q "flutter:" "pubspec.yaml" 2>/dev/null || [[ -f ".flutter" ]]; then
        echo "flutter"
      else
        echo "dart"
      fi
    elif [[ -n "$(find . -name "*.swift" -type f | head -n 1)" ]]; then
      echo "swift"
    elif [[ -n "$(find . -name "*.cpp" -o -name "*.cc" -o -name "*.c" -o -name "*.h" -type f | head -n 1)" ]]; then
      echo "cpp"
    elif [[ -n "$(find . -name "*.m" -o -name "*.mm" -type f | head -n 1)" ]]; then
      echo "objectivec"
    elif [[ -n "$(find . -name "*.sh" -type f | head -n 1)" ]]; then
      echo "shell"
    elif [[ -n "$(find . -name "*.ps1" -type f -not -path "./.git/*" | head -n 1)" ]]; then
      echo "powershell"
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

# Detect if project has IaC files (Terraform, Kubernetes, Docker)
detect_iac_project() {
  local has_iac=false
  
  # Check for Terraform files
  if [[ -n "$(find . -maxdepth 2 -name "*.tf" -not -path "./.git/*" 2>/dev/null | head -1)" ]]; then
    has_iac=true
  fi
  
  # Check for Kubernetes manifests (YAML with apiVersion/kind)
  if [[ -n "$(find . -maxdepth 2 \( -name "*.yaml" -o -name "*.yml" \) -not -path "./.git/*" 2>/dev/null | head -1)" ]]; then
    local yaml_file=$(find . -maxdepth 2 \( -name "*.yaml" -o -name "*.yml" \) -not -path "./.git/*" 2>/dev/null | head -1)
    if grep -qE "^(apiVersion|kind):" "$yaml_file" 2>/dev/null; then
      has_iac=true
    fi
  fi
  
  # Check for Dockerfiles
  if [[ -n "$(find . -maxdepth 2 -name "Dockerfile" -o -name "*.dockerfile" -not -path "./.git/*" 2>/dev/null | head -1)" ]]; then
    has_iac=true
  fi
  
  if [ "$has_iac" = true ]; then
    echo "iac"
  else
    echo ""
  fi
}

# Stryker 9.x config files (new format, takes priority)
detect_mutation_testable() {
  if [[ -f "stryker.config.mjs" ]] || [[ -f "stryker.config.js" ]] || \
     [[ -f "stryker.config.cjs" ]] || [[ -f "stryker.config.json" ]]; then
    if [[ -f "package.json" ]] && grep -qE '"@stryker-mutator[^"]*"' package.json 2>/dev/null; then
      return 0
    fi
    if command -v npx >/dev/null 2>&1 && npx --no-install stryker --version >/dev/null 2>&1; then
      return 0
    fi
  fi

  # Legacy Stryker config files (backwards compatibility)
  if [[ -f "stryker.conf.json" ]] || [[ -f "stryker.prepush.conf.json" ]]; then
    if [[ -f "package.json" ]] && grep -qE '"@stryker-mutator[^"]*"' package.json 2>/dev/null; then
      return 0
    fi
    if command -v npx >/dev/null 2>&1 && npx --no-install stryker --version >/dev/null 2>&1; then
      return 0
    fi
  fi

  return 1
}