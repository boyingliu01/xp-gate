#!/usr/bin/env bats

# Rust language support: Gate 0 detection, Gate 1/5 adapter contract.
#
# The defect these pin down: xp-gate had every piece of a Rust story except the
# two bindings that make it reachable. Gate 3's extension filter and Gate 10's
# file filter/would-be ruleset already knew `rs`, but Gate 0 never produced a
# `rust` entry in PROJECT_LANGS, so no adapter lookup ever happened -- Gate 1
# (fmt/clippy) and Gate 5 (cargo test/llvm-cov) printed "no adapter, assuming
# none to run" and PASSED a Rust half nobody measured. Same shape as #717 for C#.
#
# The adapter tests are behaviour, not existence: a passthrough/grep check would
# keep passing after someone deletes the manifest-warning arm or turns the
# missing-toolchain verdict into a PASS.

# Under a real hook git exports GIT_DIR/GIT_WORK_TREE, and they win over a `cd`
# into a fixture: git commands in the cases below then act on the project repo
# instead (measured while committing through the hook). Dropped for the file,
# using the same list the adapters isolate with.
setup_file() {
  # shellcheck source=/dev/null
  source "$BATS_TEST_DIRNAME/../adapter-common.sh"
  # shellcheck disable=SC2046  # one name per word, by design
  unset $(git_hook_context_vars)
}

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE_0_ENTRY="$REPO_ROOT/githooks/gate-entries/gate-0-entry.sh"
  GATE_5_ENTRY="$REPO_ROOT/githooks/gate-entries/gate-5-entry.sh"
  RUST_ADAPTER="$REPO_ROOT/githooks/adapters/rust.sh"
  WORK="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$WORK"
}

teardown() {
  cd /
  rm -rf "$WORK"
}

# --- Gate 0: the extension arm --------------------------------------------

# Run the real gate_0_run with only the helper functions it borrows from the
# driver stubbed. The fixture is on a feature branch so the protected-branch
# version check (which would demand a VERSION bump) short-circuits: this test is
# about language detection, not versioning.
#
# The staged list MUST come from the fixture's real index (git add), not from
# XP_STAGED_ACM: gate-0-entry.sh defines its own export_staged_acm_cache at
# source time, which re-exports `git diff --cached` and overwrites any preset
# value. Pre-seeding the env var therefore reads back as "No files changed" and
# the gate returns before detection ever runs.
detect_langs_for() {
  local paths="$1" p
  ( cd "$WORK" || exit 1
    git init -q -b feature/rust-detection 2>/dev/null || true
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      mkdir -p "$(dirname "$p")"
      printf '// fixture %s\n' "$p" > "$p"
    done <<< "$paths"
    git add -A
    cat > harness.sh <<HARNESS
set +u
unset XP_STAGED_ACM
gate_start_ms() { echo 0; }
record_gate_audit() { :; }
gate_enabled() { return 0; }
gate_selection_active() { return 1; }
detect_docs_only_commit() { cat >/dev/null; echo false; }
jscpd_is_build_output() { return 1; }
now_ms() { echo 0; }
source "$GATE_0_ENTRY"
gate_0_run > gate0.log 2>&1 || true
printf 'LANGS=%s\n' "\$PROJECT_LANGS"
HARNESS
    GATE_0_ENTRY="$GATE_0_ENTRY" bash harness.sh 2>/dev/null | sed -n 's/^LANGS=//p'
  )
}

@test "Gate 0: a staged .rs file adds rust to PROJECT_LANGS" {
  local langs
  langs=$(detect_langs_for "src/main.rs")
  [ "$langs" = "rust" ]
}

@test "Gate 0: a mixed TS+Rust commit reports both languages (Tauri shape)" {
  local langs
  langs=$(detect_langs_for "src/app.ts
src-tauri/src/main.rs")
  [ "$langs" = "typescript rust" ]
}

@test "Gate 0: a Rust-free commit does not gain a rust entry" {
  local langs
  langs=$(detect_langs_for "src/app.ts")
  [ "$langs" = "typescript" ]
}

# --- Gate 5: the code-file extension list ---------------------------------
#
# Second half of the same defect: with an adapter present but `rs` missing from
# CODE_EXTENSIONS, a Rust-only commit took the "No code files changed" early
# skip, so the adapter was never reached. Measured on a Rust crate with only
# src/lib.rs staged: "SKIPPED - No code files changed (only docs/config/VERSION)".
@test "Gate 5: a staged .rs file counts as a code file" {
  local ext
  ext=$(sed -n 's/^  CODE_EXTENSIONS="\(.*\)"$/\1/p' "$GATE_5_ENTRY" | head -1)
  [ -n "$ext" ]
  printf '%s\n' "src/lib.rs" "src-tauri/src/main.rs" | grep -qE "$ext"
}

@test "Gate 5 anti-vacuity: manifests and docs still do not count as code" {
  local ext
  ext=$(sed -n 's/^  CODE_EXTENSIONS="\(.*\)"$/\1/p' "$GATE_5_ENTRY" | head -1)
  [ -n "$ext" ]
  ! printf '%s\n' "Cargo.toml" "docs/README.md" | grep -qE "$ext"
}

# --- Gate 5: the lcov parser's output shape -------------------------------
#
# Stage 2 compares with test(1)'s integer `-ge`/`-lt`. A decimal parser return
# ("100.0") made those comparisons error out, and the caller read the error as
# "false" -- reporting "Could not determine coverage percentage" for a complete
# report. Measured on a 100%-covered Rust crate.
@test "Gate 5: parse_lcov_coverage returns an integer that compares" {
  local lcov="$BATS_TEST_TMPDIR/lcov.info"
  printf 'SF:/tmp/x/src/lib.rs\nLF:10\nLH:9\nend_of_record\n' > "$lcov"
  # pre-commit is a driver, not a library: source the one function out of it.
  local fn_src="$BATS_TEST_TMPDIR/lcovfn.sh"
  sed -n '/^parse_lcov_coverage() {$/,/^}$/p' "$REPO_ROOT/githooks/pre-commit" > "$fn_src"
  [ -s "$fn_src" ]
  local out
  out=$(bash -c "source '$fn_src'; parse_lcov_coverage '$lcov'")
  [ "$out" = "90" ]
  [ "$out" -ge 0 ] 2>/dev/null
}

# --- Gate 1/5: the adapter contract ---------------------------------------
#
# These source the adapter with a fake cargo on PATH. XP_GATE_CARGO_BIN is
# honoured first, which is what makes the fake authoritative even on a machine
# where a real toolchain exists.

run_adapter_with_fake_cargo() {
  local script="$1" fn="$2"
  local fake_dir="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$fake_dir"
  printf '%s\n' "$script" > "$fake_dir/cargo"
  chmod +x "$fake_dir/cargo"
  ( cd "$WORK" || exit 1
    XP_GATE_CARGO_BIN="$fake_dir/cargo" bash -c "
      source '$RUST_ADAPTER'
      $fn
    " 2>&1
  )
}

@test "adapter: missing cargo is a fail-closed BLOCK (2), never a PASS" {
  run bash -c "source '$RUST_ADAPTER'; PATH=/usr/bin:/bin HOME='$BATS_TEST_TMPDIR' XP_GATE_CARGO_BIN=/nonexistent/cargo run_static_analysis"
  [ "$status" -eq 2 ]
  [[ "$output" == *"XP_G1_REASON: cargo not found"* ]]
}

@test "adapter: clippy exit 0 plus a cargo manifest warning is still a finding" {
  # `cargo::unused_dependencies` is a cargo lint, not a rustc lint, so
  # `-- -D warnings` cannot reach it. Measured on this client repo: clippy
  # exited 0 while printing "warning: unused dependency `thiserror`".
  run run_adapter_with_fake_cargo '#!/bin/sh
echo "warning: unused dependency \`thiserror\`"
exit 0' run_static_analysis
  [ "$status" -eq 1 ]
}

@test "adapter: a clean clippy run passes" {
  run run_adapter_with_fake_cargo '#!/bin/sh
echo "    Finished dev profile"
exit 0' run_static_analysis
  [ "$status" -eq 0 ]
}

@test "adapter: clippy findings block" {
  run run_adapter_with_fake_cargo '#!/bin/sh
echo "error: this function has too many arguments"
exit 1' run_static_analysis
  [ "$status" -eq 1 ]
}

@test "adapter: coverage without cargo-llvm-cov fails closed with an install hint" {
  run run_adapter_with_fake_cargo '#!/bin/sh
if [ "$1" = "llvm-cov" ]; then
  echo "error: no such command: \`llvm-cov\`" >&2
  exit 1
fi
exit 0' run_coverage
  [ "$status" -eq 2 ]
  [[ "$output" == *"cargo-llvm-cov not installed"* ]]
}

@test "adapter: declares that the coverage run already executed the tests" {
  run bash -c "source '$RUST_ADAPTER'; coverage_runs_tests"
  [ "$status" -eq 0 ]
}

@test "adapter: fmt drift blocks (command shape is fmt --all -- --check)" {
  local fake_dir="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$fake_dir"
  cat > "$fake_dir/cargo" <<'FAKE'
#!/bin/sh
printf '%s\n' "$*" > "$CARGO_ARGV"
if [ "$1" = "fmt" ] && [ "$2" = "check" ]; then exit 1; fi
if [ "$1" = "fmt" ]; then exit 1; fi
echo "unexpected invocation: $*" >&2
exit 9
FAKE
  chmod +x "$fake_dir/cargo"
  export CARGO_ARGV="$BATS_TEST_TMPDIR/argv.txt"
  run env XP_GATE_CARGO_BIN="$fake_dir/cargo" CARGO_ARGV="$CARGO_ARGV" bash -c "source '$RUST_ADAPTER'; run_lint"
  [ "$status" -eq 1 ]
  grep -q -- "--all -- --check" "$CARGO_ARGV"
}
