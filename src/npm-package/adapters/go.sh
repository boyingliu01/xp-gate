#!/usr/bin/env bash

# Go adapter for quality gates
# Tools: go vet, golangci-lint, arch-go (architecture), go test

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../adapter-common.sh" 2>/dev/null || true

run_static_analysis() {
  require_tool go "Go SDK" || return 1

  echo "Running Go static analysis (go vet)..."
  go vet ./...
  return $?
}

run_lint() {
  if ! require_tool golangci-lint "golangci-lint" 2>/dev/null; then
    echo "⚠ golangci-lint not available, installing..."
    go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest 2>/dev/null
    require_tool golangci-lint "golangci-lint" || return 0
  fi

  echo "Running Go linting (golangci-lint)..."
  golangci-lint run ./...
  return $?
}

run_architecture() {
  if ! require_tool arch-go "arch-go (Go architecture checker)" 2>/dev/null; then
    echo "⚠ arch-go not available, installing..."
    go install github.com/arch-go/arch-go@latest 2>/dev/null
    require_tool arch-go "arch-go" || return 0
  fi

  echo "Running Go architecture checks (arch-go)..."
  arch-go check
  return $?
}

run_tests() {
  require_tool go "Go SDK" || return 1

  echo "Running Go tests..."
  go test ./...
  return $?
}

run_coverage() {
  require_tool go "Go SDK" || return 1

  echo "Running Go coverage..."
  go test -coverprofile=coverage.out ./...
  local rc=$?
  if [ $rc -eq 0 ]; then
    go tool cover -func=coverage.out 2>/dev/null | tail -1
  fi
  return $rc
}
