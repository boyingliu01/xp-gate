#!/usr/bin/env bats
# @test REQ-490
# @intent Gate 10 passed the newline-joined staged-file list to semgrep as ONE
#         quoted argument, so staging >=2 supported files handed semgrep an
#         illegal path like $'a.ts\nb.ts' and semgrep died with "Invalid
#         scanning root" -- silently killing the whole commit. Single-file
#         commits worked by accident (no newline in the string), which is why
#         this looked intermittent (#475's field reports).
# @covers AC-490-01, AC-490-02, AC-490-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-10.sh"
  TEST_DIR="$(mktemp -d)"

  mkdir -p "$TEST_DIR/bin"
  cd "$TEST_DIR" || return 1
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  # Without this, the machine-wide core.hooksPath runs the real gate suite on every
  # fixture commit.
  git config core.hooksPath .git/hooks
  echo "seed" > README.md
  git add README.md
  git commit -q -m "seed"
  echo "export const value = 1;" > app.ts
  echo "export const other = 2;" > lib.ts
  git add app.ts lib.ts
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Sources gate-10.sh with a stub semgrep that records its exact argv (one line
# per argument) into $SEMGREP_STUB_ARGV and exits 0 with clean JSON.
run_gate_with_argv_stub() {
  local argv_path="$1"
  (
    set -u
    cd "$TEST_DIR" || exit 1
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    GATE_10_STATUS=""
    HOME="$TEST_DIR/no-home"
    PATH="$TEST_DIR/bin:$PATH"
    export SEMGREP_STUB_ARGV="$argv_path"
    # shellcheck disable=SC1091
    source "$GATE"
    printf 'STATUS=%s' "$GATE_10_STATUS"
  )
}

write_argv_semgrep_stub() {
  cat > "$TEST_DIR/bin/semgrep" << STUB
#!/bin/sh
printf '%s\n' "\$@" > "\$SEMGREP_STUB_ARGV"
echo '{"results":[],"errors":[],"paths":{"scanned":["app.ts"]}}'
exit 0
STUB
  chmod +x "$TEST_DIR/bin/semgrep"
}

@test "AC-490-01: 2 staged .ts files reach semgrep as 2 separate target arguments" {
  write_argv_semgrep_stub
  run run_gate_with_argv_stub "$TEST_DIR/argv.txt"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=PASS"* ]]
  NUM_TARGETS=$(grep -c '\.ts$' "$TEST_DIR/argv.txt")
  [ "$NUM_TARGETS" -eq 2 ]
  grep -qx "app.ts" "$TEST_DIR/argv.txt"
  grep -qx "lib.ts" "$TEST_DIR/argv.txt"
}

@test "AC-490-02: a multi-file commit PASSes and reports the scanned file count" {
  write_argv_semgrep_stub
  run run_gate_with_argv_stub "$TEST_DIR/argv.txt"
  [[ "$output" == *"files scanned: 2"* ]]
  [[ "$output" != *"Invalid scanning root"* ]]
}

@test "AC-490-03 anti-vacuity: every shipped gate-10 copy expands the array, not the quoted list" {
  for f in githooks/gate-10.sh src/npm-package/gate-10.sh src/npm-package/hooks/gate-10.sh; do
    grep -q -- '"\${SEMGREP_ARGS\[@\]}"' "$REPO_ROOT/$f" || {
      echo "$f: does not expand SEMGREP_ARGS array" >&2
      return 1
    }
    if grep -q -- 'disable-version-check "\$SEMGREP_FILES"' "$REPO_ROOT/$f"; then
      echo "$f: still passes the quoted newline-joined SEMGREP_FILES as one argument" >&2
      return 1
    fi
  done
}
