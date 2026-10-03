#!/usr/bin/env bats

# ============================================================================
# Issue #458: Gate 1 (Biome) blocks docs-only and config-only commits
#
# `npx biome check --staged .` exits 1 with
#   internalError/io - No files were processed in the specified paths.
# whenever the staged set contains no Biome-lintable file (docs-only,
# config-only, or everything excluded by biome.json).
#
# Zero files processed is "nothing to do", not a lint violation. The hook's own
# stated design principle is: tool available + check SUCCEEDS = PASS. Blocking
# here makes it impossible to commit documentation in any repo with biome.json.
#
# These tests drive the real gate-1 Biome branch by stubbing `npx` on PATH, so
# they exercise the shipped control flow rather than a reimplementation of it.
# ============================================================================

setup() {
  TEST_DIR=$(mktemp -d)
  mkdir -p "$TEST_DIR/bin" "$TEST_DIR/proj"

  # A project where the Biome branch is active.
  printf '%s\n' '{"linter":{"enabled":false}}' > "$TEST_DIR/proj/biome.json"

  # Extract just the Biome branch from the real hook. `exit 1` inside the branch
  # must terminate the script, so it is run as a file rather than sourced.
  sed -n '/── Biome lint\/format check ──/,/^    fi$/p' \
    "$BATS_TEST_DIRNAME/../pre-commit" > "$TEST_DIR/gate1-biome.sh"

  # Stub npx: `biome check` reproduces whatever the test wants to simulate.
  cat > "$TEST_DIR/bin/npx" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "biome" ] && [ "$2" = "check" ]; then
  cat "$BIOME_STUB_OUTPUT"
  exit "$BIOME_STUB_STATUS"
fi
exit 0
STUB
  chmod +x "$TEST_DIR/bin/npx"

  cd "$TEST_DIR/proj"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Run the extracted branch with a given biome stdout + exit status.
run_biome_branch() {
  local status="$1" message="$2"
  printf '%s\n' "$message" > "$TEST_DIR/biome-output.txt"
  BIOME_STUB_STATUS="$status" BIOME_STUB_OUTPUT="$TEST_DIR/biome-output.txt" \
    PATH="$TEST_DIR/bin:$PATH" bash "$TEST_DIR/gate1-biome.sh"
}

# ---------------------------------------------------------------------------
# The regression: zero files processed must NOT block (#458)
# ---------------------------------------------------------------------------

@test "Gate 1 passes when biome processes zero files (docs-only commit)" {
  run run_biome_branch 1 "Checked 0 files in 2ms. No fixes applied.
internalError/io ━━━━━━━━━━━━━━━━━━━━
× No files were processed in the specified paths."

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ ! "$output" =~ "BLOCKED" ]]
  [[ "$output" =~ "PASSED" ]]
}

@test "Gate 1 still blocks when biome reports a real lint error" {
  run run_biome_branch 1 "src/index.ts:1:1 lint/style/useConst ━━━━━━
× This let declares a variable that is never reassigned."

  echo "output: $output"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "BLOCKED" ]]
}

@test "Gate 1 still blocks when biome reports a parse error" {
  run run_biome_branch 1 "src/broken.ts:3:1 parse ━━━━━━
× Expected a semicolon or an implicit line break."

  echo "output: $output"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "BLOCKED" ]]
}

@test "Gate 1 passes when biome succeeds normally" {
  run run_biome_branch 0 "Checked 3 files in 12ms. No fixes applied."

  echo "output: $output"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "PASSED" ]]
}
