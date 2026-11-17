#!/usr/bin/env bash

# Rust adapter for quality gates
# Tools: cargo fmt (Gate 1 lint), cargo clippy (Gate 1 static analysis),
#        cargo test (Gate 5), cargo llvm-cov (Gate 5 coverage)
#
# Verdict contract (same as every adapter routed by Gate 1 / Gate 5):
#   0 = PASS            1 = BLOCK (ran, found problems)
#   2 = BLOCK (could not execute, fail-closed)
#   3 = WARN (skipped for a stated reason)
# A reason crosses the command-substitution subshell as an `XP_G1_REASON: ...`
# stdout line; an `export` inside an adapter can never reach the caller.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Same dual layout as the other adapters: the library sits beside the adapters in
# a global install and one level up in the npm package.
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

# rustup keeps every managed binary (cargo, rustc, rustfmt, installed cargo
# subcommands) in ~/.cargo/bin, which git-bash on Windows does not inherit from
# the Windows PATH. Probe it directly so an installed toolchain is not reported
# as missing; XP_GATE_CARGO_BIN stays authoritative for pinned toolchains.
rust_cargo_bin() {
  if [ -n "${XP_GATE_CARGO_BIN:-}" ] && [ -x "$XP_GATE_CARGO_BIN" ]; then
    printf '%s\n' "$XP_GATE_CARGO_BIN"
    return 0
  fi
  if command -v cargo >/dev/null 2>&1; then
    command -v cargo
    return 0
  fi
  if [ -x "${HOME:-}/.cargo/bin/cargo" ]; then
    printf '%s\n' "${HOME}/.cargo/bin/cargo"
    return 0
  fi
  if [ -x "${HOME:-}/.cargo/bin/cargo.exe" ]; then
    printf '%s\n' "${HOME}/.cargo/bin/cargo.exe"
    return 0
  fi
  return 1
}

_rust_require_cargo() {
  local cargo_bin
  if cargo_bin=$(rust_cargo_bin); then
    # Subcommands (`cargo fmt`, `cargo clippy`) are resolved through the same
    # directory, so put it on PATH for the calls below.
    PATH="$(dirname "$cargo_bin"):${PATH}"
    export PATH
    RUST_CARGO="$cargo_bin"
    export RUST_CARGO
    return 0
  fi
  echo "XP_G1_REASON: cargo not found (install rustup: https://rustup.rs, or set XP_GATE_CARGO_BIN)"
  return 2
}

run_static_analysis() {
  _rust_require_cargo || return $?

  echo "Running Rust static analysis (cargo clippy, warnings denied)..."
  local out rc
  out=$("$RUST_CARGO" clippy --workspace --all-targets -- -D warnings 2>&1)
  rc=$?
  printf '%s\n' "$out"
  if [ "$rc" -ne 0 ]; then
    return 1
  fi
  # Cargo's own manifest lints (unused_dependencies, unused_workspace_dependencies)
  # are NOT rustc lints, so `-D warnings` never reaches them: clippy exits 0 while
  # printing `warning: unused dependency ...`. Measured on a workspace whose
  # auth-service declared thiserror and never used it. Treat any cargo warning as
  # a finding, otherwise "0 warnings" would only mean "0 rustc warnings".
  if printf '%s\n' "$out" | grep -qE '^warning: '; then
    echo "XP_G1_REASON: cargo reported warnings that -D warnings cannot reach (manifest lints)"
    return 1
  fi
  return 0
}

run_lint() {
  _rust_require_cargo || return $?

  echo "Running Rust formatting check (cargo fmt --check)..."
  "$RUST_CARGO" fmt --all -- --check
  return $?
}

run_tests() {
  _rust_require_cargo || return $?

  echo "Running Rust tests (cargo test --workspace)..."
  "$RUST_CARGO" test --workspace
  return $?
}

# run_coverage() executes the suite itself (cargo llvm-cov), so a separate
# run_tests() pass would only double the wall time without changing the verdict.
coverage_runs_tests() { return 0; }

run_coverage() {
  _rust_require_cargo || return $?

  if ! "$RUST_CARGO" llvm-cov --version >/dev/null 2>&1; then
    echo "XP_G1_REASON: cargo-llvm-cov not installed (cargo install cargo-llvm-cov --locked)"
    return 2
  fi

  echo "Running Rust coverage (cargo llvm-cov)..."
  mkdir -p coverage
  # lcov.info is one of the report shapes Gate 5 Stage 2 already parses, so the
  # generic coverage arm enforces the same threshold as every other language.
  "$RUST_CARGO" llvm-cov --workspace --lcov --output-path coverage/lcov.info
  local rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "Rust coverage report: coverage/lcov.info"
  fi
  return "$rc"
}
