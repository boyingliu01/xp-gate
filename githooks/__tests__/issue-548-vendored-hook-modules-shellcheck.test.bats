#!/usr/bin/env bats
# @test REQ-548 vendored hook modules are shellcheck-clean
# @intent Verify the shipped hook modules produce no shellcheck warnings, since
#         any repo that vendors them into githooks/ runs its own lint pass over
#         the copy and gets BLOCKED by findings that are artifacts of single-file
#         lint scope. #548 reported gate-10.sh; the root cause was systemic --
#         every module that assigns a variable the SOURCING PARENT consumes is
#         flagged SC2034 "appears unused", because the linter cannot see across
#         the source boundary. Five modules carried it: gate-3.sh (GATE_3_REASON,
#         CCN_WARN/BLOCK_THRESHOLD consumed by the sourced ccn-ratchet lib),
#         gate-4.sh, gate-7.sh, gate-10.sh, hook-module-resolution.sh.
# @covers AC-548-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  # The modules that are sourced by pre-commit/pre-push and expose a
  # parent-consumed contract.
  MODULES=(
    gate-3.sh
    gate-4.sh
    gate-7.sh
    gate-10.sh
    hook-module-resolution.sh
  )
}

@test "anti-vacuity: every listed module exists" {
  for m in "${MODULES[@]}"; do
    [ -f "$REPO_ROOT/githooks/$m" ] || {
      echo "missing: githooks/$m"
      return 1
    }
  done
}

@test "shellcheck reports no findings for any sourced hook module" {
  if ! command -v shellcheck >/dev/null 2>&1; then
    skip "shellcheck not installed"
  fi
  local failures=()
  for m in "${MODULES[@]}"; do
    if ! shellcheck -s bash "$REPO_ROOT/githooks/$m" >/dev/null 2>&1; then
      failures+=("$m")
    fi
  done
  if [ ${#failures[@]} -gt 0 ]; then
    echo "shellcheck findings in: ${failures[*]}"
    shellcheck -s bash "$REPO_ROOT/githooks/${failures[0]}" 2>&1 | head -10
    return 1
  fi
}

@test "no bare SC2034 remains unsuppressed in the vendored modules" {
  # Finding it via shellcheck is the real test; this pins the intent so a
  # future edit that removes a directive is caught even where shellcheck is
  # unavailable.
  for m in "${MODULES[@]}"; do
    local raw
    raw=$(grep -cE 'SC2034' "$REPO_ROOT/githooks/$m" || true)
    # Every module that exposes the contract must document it.
    [ "$raw" -ge 1 ] || {
      echo "no SC2034 directive in githooks/$m"
      return 1
    }
  done
}

@test "each directive is accompanied by a stated reason" {
  for m in "${MODULES[@]}"; do
    grep -q 'Consumed by the sourcing parent' "$REPO_ROOT/githooks/$m" || {
      echo "githooks/$m: directive without a documented reason"
      return 1
    }
  done
}
