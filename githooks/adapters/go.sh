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

# REMOVED in #688: run_architecture()
# Never invoked -- its only would-be caller, route_to_adapter(), had no callers
# either. Gate 6 implements arch-go in pre-commit (grep "arch-go"), and reads
# the checker's own exit status via PIPESTATUS[0] (#630) instead of letting a
# `| head` pipeline report head's. See githooks/adapter-common.sh for the full
# rationale.

run_tests() {
  require_tool go "Go SDK" || return 1

  echo "Running Go tests..."
  go test ./...
  return $?
}

# #798 / #794: run_coverage() below also executes and validates every test
# (`go test`), so a separate run_tests() pass adds no verdict -- only time.
# Undeclared adapters keep the safe double-run default.
coverage_runs_tests() { return 0; }

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
