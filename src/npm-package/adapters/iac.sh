#!/usr/bin/env bash

# IaC (Infrastructure as Code) adapter for quality gates
# Supports: Terraform (.tf), Kubernetes (K8s *.yaml), Docker, CloudFormation
# Tools: checkov (primary), hadolint (Docker), kube-score (K8s)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# #597: the library can be beside the adapters or one level up, depending on how
# the package was installed:
#   global install   ~/.config/xp-gate/adapters/adapter-common.sh   (inside)
#   npm package      src/npm-package/adapters/../adapter-common.sh  (above)
# The old single "$SCRIPT_DIR/../adapter-common.sh" only ever matched the second,
# so in the global layout the library never loaded - and "2>/dev/null || true"
# made that indistinguishable from success, leaving every shared function
# undefined with no warning.
for _ac_candidate in \
  "$SCRIPT_DIR/adapter-common.sh" \
  "$SCRIPT_DIR/../adapter-common.sh"; do
  if [ -f "$_ac_candidate" ]; then
    # shellcheck source=/dev/null
    source "$_ac_candidate"
    break
  fi
done
unset _ac_candidate

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
        # Check if it's inside .github/workflows/ (GitHub Actions)
        if echo "$file" | grep -q "\.github/workflows/"; then
          # Pass directly to checkov as a GitHub Actions file
          yaml_files="$yaml_files $file"
        # Check if it's a K8s manifest (has apiVersion and kind)
        elif grep -qE "^(apiVersion|kind):" "$file" 2>/dev/null; then
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

    # checkov 3.x exits 0 on "found failures" (we parse the output for those),
    # so the status cannot be the only signal. It is still NOT discardable:
    # exit 2 means checkov itself crashed -- e.g. AttributeError from a broken
    # detect_secrets dependency -- and a crashed scanner has not judged
    # anything. Counting a traceback as findings invents security issues; a
    # traceback that happens to lack the marker reports a clean pass. Both are
    # wrong, so a crash is tracked separately and answered as "unusable" (#552).
    local checkov_log=$(mktemp)
    local checkov_args="--compact"
    local CHECKOV_CRASHED=0
    local checkov_scan_count=0

    # Record a checkov run's exit status and flag a crash. Codes 0 and 1 are
    # normal (1 = findings); anything else, or any traceback in the log, is the
    # tool failing rather than reporting.
    record_checkov_run() {
      local status=$1 file=$2
      checkov_scan_count=$((checkov_scan_count + 1))
      if [ "$status" -ne 0 ] && [ "$status" -ne 1 ]; then
        CHECKOV_CRASHED=1
        echo "     ⚠️  checkov exited $status on $file — the scanner failed, this is not a finding"
      fi
    }

    # Run checkov on all detected IaC files
    local tf_files=$(echo "$iac_files" | grep "TERRAFORM:" | sed 's/TERRAFORM://')
    local k8s_files=$(echo "$iac_files" | grep "KUBERNETES:" | sed 's/KUBERNETES://')
    local docker_files=$(echo "$iac_files" | grep "DOCKER:" | sed 's/DOCKER://')

    if [ -n "$tf_files" ]; then
      echo "Scanning Terraform files..."
      for file in $tf_files; do
        if [ -f "$file" ]; then
          checkov --file "$file" $checkov_args >> "$checkov_log" 2>&1
          record_checkov_run $? "$file"
        fi
      done
    fi

    if [ -n "$k8s_files" ]; then
      local gh_files=""
      local k8s_only=""
      for file in $k8s_files; do
        if echo "$file" | grep -q "\.github/workflows/"; then
          gh_files="$gh_files $file"
        else
          k8s_only="$k8s_only $file"
        fi
      done

      if [ -n "$k8s_only" ]; then
        echo "Scanning Kubernetes manifests..."
        for file in $k8s_only; do
          if [ -f "$file" ]; then
            checkov --file "$file" $checkov_args --framework kubernetes >> "$checkov_log" 2>&1
          record_checkov_run $? "$file"
          fi
        done
      fi

      if [ -n "$gh_files" ]; then
        echo "Scanning GitHub Actions workflows..."
        for file in $gh_files; do
          if [ -f "$file" ]; then
            checkov --file "$file" $checkov_args --framework github_actions >> "$checkov_log" 2>&1
            record_checkov_run $? "$file"
          fi
        done
      fi
    fi

    if [ -n "$docker_files" ]; then
      echo "Scanning Dockerfiles..."
      for file in $docker_files; do
        if [ -f "$file" ]; then
          checkov --file "$file" $checkov_args >> "$checkov_log" 2>&1
          record_checkov_run $? "$file"
        fi
      done
    fi

    # Print captured output then check for failures
    cat "$checkov_log"

    # A crash is answered before any parsing. The traceback is not evidence of
    # anything: its text decides the verdict if we let grep see it.
    if [ "$CHECKOV_CRASHED" -eq 1 ]; then
      rm -f "$checkov_log"
      echo ""
      echo "❌ BLOCKED - checkov could not run (the scanner crashed, so nothing was scanned)."
      echo "   This is NOT a security finding. Fix the environment, usually:"
      echo "     pip install -U checkov detect-secrets"
      echo "   (A common cause is a detect_secrets version whose FileType enum lacks JSON.)"
      echo "   To accept the risk for this commit: XP_GATE_IAC_SOFT=1"
      if [ "${XP_GATE_IAC_SOFT:-}" = "1" ]; then
        echo "⚠️  XP_GATE_IAC_SOFT=1: unusable scanner downgraded to WARN"
        return 3
      fi
      return 2
    fi

    local failed_count=$(grep -c "FAILED for resource" "$checkov_log" 2>/dev/null || true)
    rm -f "$checkov_log"

    if [ "$failed_count" -gt 0 ]; then
      echo "❌ $failed_count security issue(s) found by checkov across $checkov_scan_count file(s). Blocking commit."
      exit_code=1
    fi
    echo "checkov scan completed ($checkov_scan_count file(s) scanned)."
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
