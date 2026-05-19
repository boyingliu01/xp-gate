#!/usr/bin/env bash

# IaC (Infrastructure as Code) adapter for quality gates
# Supports: Terraform (.tf), Kubernetes (K8s *.yaml), Docker, CloudFormation
# Tools: checkov (primary), hadolint (Docker), kube-score (K8s)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../adapter-common.sh" 2>/dev/null || true

# Detect IaC files in changed files
detect_iac_files() {
  local files="$1"
  local tf_files=""
  local yaml_files=""
  local dockerfile_files=""
  
  for file in $files; do
    case "$file" in
      *.tf)
        tf_files="$tf_files $file"
        ;;
      *.yaml|*.yml)
        # Check if it's a K8s manifest (has apiVersion and kind)
        if grep -qE "^(apiVersion|kind):" "$file" 2>/dev/null; then
          yaml_files="$yaml_files $file"
        fi
        ;;
      Dockerfile|*.dockerfile|Dockerfile.*)
        dockerfile_files="$dockerfile_files $file"
        ;;
    esac
  done
  
  echo "TERRAFORM:$tf_files"
  echo "KUBERNETES:$yaml_files"
  echo "DOCKER:$dockerfile_files"
}

run_static_analysis() {
  local changed_files="$1"
  local iac_files=$(detect_iac_files "$changed_files")
  
  # Check if any IaC files are present
  local has_iac=false
  if echo "$iac_files" | grep -qE "TERRAFORM:.*[^\s]|KUBERNETES:.*[^\s]|DOCKER:.*[^\s]"; then
    has_iac=true
  fi
  
  if [ "$has_iac" = false ]; then
    return 0  # No IaC files, skip
  fi
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   GATE: IaC Security Scan"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  local exit_code=0
  
  # Try checkov first (recommended - supports multiple platforms)
  if command -v checkov >/dev/null 2>&1; then
    echo "Running checkov IaC security scan..."
    
    # Run checkov on all detected IaC files
    local tf_files=$(echo "$iac_files" | grep "TERRAFORM:" | sed 's/TERRAFORM://')
    local k8s_files=$(echo "$iac_files" | grep "KUBERNETES:" | sed 's/KUBERNETES://')
    local docker_files=$(echo "$iac_files" | grep "DOCKER:" | sed 's/DOCKER://')
    
    if [ -n "$tf_files" ]; then
      echo "Scanning Terraform files..."
      for file in $tf_files; do
        if [ -f "$file" ]; then
          checkov --file "$file" --compact 2>&1 | tail -20
          local tf_exit=${PIPESTATUS[0]}
          if [ $tf_exit -ne 0 ]; then
            exit_code=$tf_exit
          fi
        fi
      done
    fi
    
    if [ -n "$k8s_files" ]; then
      echo "Scanning Kubernetes manifests..."
      for file in $k8s_files; do
        if [ -f "$file" ]; then
          checkov --file "$file" --compact 2>&1 | tail -20
          local k8s_exit=${PIPESTATUS[0]}
          if [ $k8s_exit -ne 0 ]; then
            exit_code=$k8s_exit
          fi
        fi
      done
    fi
    
    if [ -n "$docker_files" ]; then
      echo "Scanning Dockerfiles..."
      for file in $docker_files; do
        if [ -f "$file" ]; then
          checkov --file "$file" --compact 2>&1 | tail -20
          local docker_exit=${PIPESTATUS[0]}
          if [ $docker_exit -ne 0 ]; then
            exit_code=$docker_exit
          fi
        fi
      done
    fi
    
    echo "checkov scan completed with exit code: $exit_code"
    return $exit_code
  fi
  
  # Fallback to individual tools if checkov not available
  
  # Try hadolint for Docker
  local docker_files=$(echo "$iac_files" | grep "DOCKER:" | sed 's/DOCKER://')
  if [ -n "$docker_files" ] && command -v hadolint >/dev/null 2>&1; then
    echo "Running hadolint for Dockerfiles..."
    for file in $docker_files; do
      if [ -f "$file" ]; then
        hadolint "$file" 2>&1 | tail -20
        local hadolint_exit=${PIPESTATUS[0]}
        if [ $hadolint_exit -ne 0 ]; then
          exit_code=$hadolint_exit
        fi
      fi
    done
  fi
  
  # Try kube-score for Kubernetes
  local k8s_files=$(echo "$iac_files" | grep "KUBERNETES:" | sed 's/KUBERNETES://')
  if [ -n "$k8s_files" ] && command -v kube-score >/dev/null 2>&1; then
    echo "Running kube-score for Kubernetes..."
    for file in $k8s_files; do
      if [ -f "$file" ]; then
        kube-score score "$file" 2>&1 | tail -20
        local kube_exit=${PIPESTATUS[0]}
        if [ $kube_exit -ne 0 ]; then
          exit_code=$kube_exit
        fi
      fi
    done
  fi
  
  # Try tflint for Terraform
  local tf_files=$(echo "$iac_files" | grep "TERRAFORM:" | sed 's/TERRAFORM://')
  if [ -n "$tf_files" ] && command -v tflint >/dev/null 2>&1; then
    echo "Running tflint for Terraform..."
    for file in $tf_files; do
      if [ -f "$file" ]; then
        tflint --chdir "$(dirname "$file")" 2>&1 | tail -20
        local tflint_exit=${PIPESTATUS[0]}
        if [ $tflint_exit -ne 0 ]; then
          exit_code=$tflint_exit
        fi
      fi
    done
  fi
  
  # If no tools available but IaC files detected, warn user
  if [ $exit_code -eq 0 ]; then
    echo "⚠ IaC files detected but no scanning tools available."
    echo "  Install checkov (recommended) or individual tools:"
    echo "  - checkov: pip install checkov"
    echo "  - hadolint: https://github.com/hadolint/hadolint"
    echo "  - kube-score: https://github.com/zegl/kube-score"
    echo "  - tflint: https://github.com/terraform-linters/tflint"
    echo ""
    echo "  Per QUALITY-GATES-CODE-OF-CONDUCT.md: tool unavailable = BLOCK, not SKIP"
    return 1
  fi
  
  return $exit_code
}

run_lint() {
  # IaC linting is handled by run_static_analysis
  run_static_analysis "$1"
}

run_tests() {
  # IaC typically doesn't have unit tests in the traditional sense
  # Could add integration tests with terratest (Go) or pytest (Python)
  echo "IaC tests not configured"
  return 0
}

run_coverage() {
  echo "IaC coverage not available"
  return 0
}
