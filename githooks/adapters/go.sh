#!/usr/bin/env bash

# Go adapter for quality gates
# Tools: go vet, golangci-lint, arch-go (architecture), go test

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
