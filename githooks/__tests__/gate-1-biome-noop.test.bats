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
  #
  # The range is the WHOLE `if [ -f biome.json ] ... fi` block, and `^    fi$`
  # (four spaces) is the right end: the nested if/fi blocks added by local tool
  # resolution are indented deeper, so they cannot truncate the range. Two wrong
  # anchors were tried and both broke the suite -- stopping at the invocation
  # line left the `if` unclosed ("unexpected end of file from `if'") and the
  # npx stub never ran either way.
  sed -n '/── Biome lint\/format check ──/,/^    fi$/p' \
    "$BATS_TEST_DIRNAME/../gate-entries/gate-1-entry.sh" > "$TEST_DIR/gate1-biome.sh"

  # The binary is resolved LOCALLY first: <project>/node_modules/.bin/biome, then
  # `command -v biome`, and only then `npx biome`. That ladder exists so a commit
  # hook never downloads biome from the registry. It also means a stub on `npx`
  # alone is UNREACHABLE on a machine that has biome installed globally — which
  # is the default on this project's own dev/CI images. Stub the highest rung so
  # the suite proves the gate's behaviour on every host:
  #   - a local node_modules/.bin/biome (what a real install provides), and
  #   - npx, kept as a fallback so the assertion still holds if the ladder is
  #     reordered back to npx-first.
  mkdir -p "$TEST_DIR/proj/node_modules/.bin"
  cat > "$TEST_DIR/proj/node_modules/.bin/biome" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "check" ]; then
  cat "$BIOME_STUB_OUTPUT"
  exit "$BIOME_STUB_STATUS"
fi
exit 0
STUB
  chmod +x "$TEST_DIR/proj/node_modules/.bin/biome"

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
