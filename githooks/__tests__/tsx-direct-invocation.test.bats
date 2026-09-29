#!/usr/bin/env bats
#
# Gate 6 (Boy Scout) and Gate 9 (build integrity) run their analysers through
# `npx tsx`. On Windows that routes every argument through the cmd.exe shim,
# which caps a command line at 8191 chars — a merge with ~14k chars of staged
# file lists false-blocked with "The command line is too long." (exit 1 is
# indistinguishable from a real gate violation at the call site).
#
# run_tsx() must prefer the repo-local tsx CLI executed directly by node and
# keep `npx tsx` only as the fallback for consumer repos without a local tsx.

setup() {
  TEST_DIR=$(mktemp -d)
  HOOK_PATH="$BATS_TEST_DIRNAME/../pre-commit"
  mkdir -p "$TEST_DIR/bin"
  cd "$TEST_DIR" || return 1
}

teardown() {
  rm -rf "$TEST_DIR"
}

# Extract the real run_tsx definition from the hook and invoke it once.
extract_run_tsx() {
  local harness="$TEST_DIR/run-tsx.sh"
  {
    printf '%s\n' '#!/usr/bin/env bash'
    # shellcheck disable=SC2016
    sed -n '/^if ! declare -F run_tsx >\/dev\/null 2>&1; then$/,/^fi$/p' "$HOOK_PATH"
    printf '%s\n' 'run_tsx "$@"'
  } > "$harness"
  printf '%s\n' "$harness"
}

install_fake_local_tsx() {
  mkdir -p "$TEST_DIR/node_modules/tsx/dist"
  cat > "$TEST_DIR/node_modules/tsx/dist/cli.mjs" <<'JS'
console.log('LOCAL-TSX:' + process.argv.slice(2).join(' '));
JS
}

install_fake_npx() {
  cat > "$TEST_DIR/bin/npx" <<'SH'
#!/usr/bin/env bash
echo "NPX-SHIM:$*"
SH
  chmod +x "$TEST_DIR/bin/npx"
}

@test "run_tsx drives the repo-local tsx CLI through node, not the npx shim" {
  install_fake_local_tsx
  install_fake_npx
  harness=$(extract_run_tsx)

  run env PROJECT_ROOT="$TEST_DIR" PATH="$TEST_DIR/bin:$PATH" \
    bash "$harness" src/principles/boy-scout.ts --new-files a.ts,b.ts

  [ "$status" -eq 0 ]
  [[ "$output" == *"LOCAL-TSX:src/principles/boy-scout.ts --new-files a.ts,b.ts"* ]]
  [[ "$output" != *"NPX-SHIM"* ]]
}

@test "run_tsx falls back to npx when no repo-local tsx exists" {
  install_fake_npx
  harness=$(extract_run_tsx)

  run env PROJECT_ROOT="$TEST_DIR" PATH="$TEST_DIR/bin:$PATH" \
    bash "$harness" src/principles/boy-scout.ts --new-files a.ts

  [ "$status" -eq 0 ]
  [[ "$output" == *"NPX-SHIM:tsx src/principles/boy-scout.ts --new-files a.ts"* ]]
}

@test "run_tsx survives staged file lists longer than the Windows cmd.exe limit" {
  install_fake_local_tsx
  harness=$(extract_run_tsx)
  long_list=$(printf 'src/file-%04d.ts,' $(seq 1 800) | sed 's/,$//')
  [ "${#long_list}" -gt 8191 ]

  run env PROJECT_ROOT="$TEST_DIR" PATH="$TEST_DIR/bin:$PATH" \
    bash "$harness" src/principles/boy-scout.ts --new-files "$long_list"

  [ "$status" -eq 0 ]
  [[ "$output" == *"LOCAL-TSX:"* ]]
  [[ "$output" == *"${long_list:0:100}"* ]]
}

@test "Gate 6 Boy Scout invokes the analyser through run_tsx" {
  run grep -F 'BOY_SCOUT_OUTPUT=$(run_tsx "$BOY_SCOUT_SCRIPT"' "$HOOK_PATH"
  [ "$status" -eq 0 ]

  run grep -F 'BOY_SCOUT_OUTPUT=$(npx tsx' "$HOOK_PATH"
  [ "$status" -ne 0 ]
}

@test "Gate 9 build integrity invokes the analyser through run_tsx" {
  run grep -F 'RUN_TSX_TIMEOUT=120s run_tsx "$GATE_9_SCRIPT"' "$HOOK_PATH"
  [ "$status" -eq 0 ]

  run grep -F 'timeout 120s npx tsx "$GATE_9_SCRIPT"' "$HOOK_PATH"
  [ "$status" -ne 0 ]
}
