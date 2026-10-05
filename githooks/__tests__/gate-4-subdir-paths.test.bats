#!/usr/bin/env bats
# @test REQ-478
# @intent Gate 4 passes repo-root-relative paths (git diff output) to the principles
#         checker, but pre-commit may already have cd'd into a single-language
#         subdirectory. The checker then read web/src/a.ts as web/web/src/a.ts, threw,
#         and a checker that works degraded to SKIPPED -- silently disabling the gate.
#         Every checker invocation now runs from the repo root, so the path base of the
#         arguments and of the working directory always agree.
# @covers AC-478-01, AC-478-02, AC-478-03, AC-478-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  TEST_DIR="$(mktemp -d)"

  mkdir -p "$TEST_DIR/web/src/api" "$TEST_DIR/src/principles" "$TEST_DIR/bin" "$TEST_DIR/home"
  echo "export const a = 1;" > "$TEST_DIR/web/src/api/index.ts"
  # The real checker is never executed here; its presence is what PRINCIPLES_DIR probes.
  echo "// stub" > "$TEST_DIR/src/principles/index.ts"

  # gate-4.sh only reaches the checker when it can find a runner. A stub npx on PATH
  # keeps the test about path resolution, not about whether tsx works in this shell.
  cat > "$TEST_DIR/bin/npx" << 'STUB'
#!/bin/sh
exit 0
STUB
  chmod +x "$TEST_DIR/bin/npx"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Runs gate-4.sh with a stubbed checker. The stub records the directory it was called
# from and every path argument, then behaves like the real checker: paths it cannot
# read from its own working directory produce the "Analysis failed" crash (exit 2).
#   $1 -- directory the hook is standing in when Gate 4 runs
#   $2 -- PROJECT_SUBDIR ("" when the repo has no subproject layout)
#   $3 -- ORIGINAL_DIR, the marker pre-commit sets only when it really cd'd
run_gate() {
  local cwd="$1" subdir="$2" original_dir="$3"
  (
    set -u
    cd "$cwd"
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    PROJECT_LANG="typescript"
    PROJECT_ROOT="$TEST_DIR"
    HOME="$TEST_DIR/home"
    PATH="$TEST_DIR/bin:$PATH"
    PROJECT_SUBDIR="$subdir"
    ORIGINAL_DIR="$original_dir"
    CHANGED_FILES="web/src/api/index.ts"
    GATE_4_STATUS=""
    WARNING_COUNT=0
    run_tsx() {
      local _arg collecting=0 _missing=""
      pwd > "$TEST_DIR/checker-cwd"
      : > "$TEST_DIR/checker-args"
      # Not `_`: bash rewrites that variable to the last argument of every command it
      # runs, so a loop over it silently reads back something else.
      for _arg in "$@"; do
        if [ "$collecting" = "1" ]; then
          case "$_arg" in
            --format) collecting=0; continue ;;
          esac
          printf '%s\n' "$_arg" >> "$TEST_DIR/checker-args"
          [ -f "$_arg" ] || _missing="$_missing $_arg"
        fi
        [ "$_arg" = "--files" ] && collecting=1
      done
      if [ -n "$_missing" ]; then
        printf 'Analysis failed: Could not read file:%s\n' "$_missing" >&2
        printf '{"violations":[],"summary":{}}' > "${PRINCIPLES_JSON:?gate set no output path}"
        return 2
      fi
      printf '{"violations":[],"summary":{"totalViolations":0,"errorCount":0,"warningCount":0}}' > "${PRINCIPLES_JSON:?gate set no output path}"
      return 0
    }
    # shellcheck disable=SC1091
    source "$REPO_ROOT/githooks/gate-4.sh"
    printf '%s' "$GATE_4_STATUS"
  )
}

@test "AC-478-01: subdir mode runs the checker from the repo root so the paths resolve" {
  run run_gate "$TEST_DIR/web" "web" "$TEST_DIR"
  [[ "$output" == *"PASS"* ]]
  [[ "$output" != *"SKIPPED"* ]]
  [ "$(cat "$TEST_DIR/checker-cwd")" = "$TEST_DIR" ]
}

@test "AC-478-01: the paths handed to the checker stay repo-root relative" {
  run_gate "$TEST_DIR/web" "web" "$TEST_DIR" >/dev/null
  [ "$(cat "$TEST_DIR/checker-args")" = "web/src/api/index.ts" ]
}

@test "AC-478-02: a repo without a subproject layout still passes" {
  (
    set -u
    cd "$TEST_DIR"
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    PROJECT_LANG="typescript"
    PROJECT_ROOT="$TEST_DIR"
    HOME="$TEST_DIR/home"
    PATH="$TEST_DIR/bin:$PATH"
    PROJECT_SUBDIR=""
    ORIGINAL_DIR=""
    CHANGED_FILES="web/src/api/index.ts"
    GATE_4_STATUS=""
    WARNING_COUNT=0
    run_tsx() {
      pwd > "$TEST_DIR/checker-cwd"
      printf '{"violations":[],"summary":{"totalViolations":0,"errorCount":0,"warningCount":0}}' > "${PRINCIPLES_JSON:?gate set no output path}"
      return 0
    }
    # shellcheck disable=SC1091
    source "$REPO_ROOT/githooks/gate-4.sh"
    [ "$GATE_4_STATUS" = "PASS" ]
  )
  [ "$(cat "$TEST_DIR/checker-cwd")" = "$TEST_DIR" ]
}

@test "AC-478-03: a checker that genuinely cannot read the files still SKIPs, never PASSes" {
  # The failure this pins: an invocation that throws must not be read as a clean run.
  # PROJECT_ROOT points at a directory that no longer exists, so the checker cannot
  # even start -- that is a tool failure (SKIP), not zero findings (PASS).
  (
    set -u
    cd "$TEST_DIR/web"
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    PROJECT_LANG="typescript"
    PROJECT_ROOT="$TEST_DIR/does-not-exist"
    HOME="$TEST_DIR/home"
    PATH="$TEST_DIR/bin:$PATH"
    PROJECT_SUBDIR="web"
    ORIGINAL_DIR="$TEST_DIR"
    CHANGED_FILES="web/src/api/index.ts"
    GATE_4_STATUS=""
    WARNING_COUNT=0
    run_tsx() { return 2; }
    # shellcheck disable=SC1091
    source "$REPO_ROOT/githooks/gate-4.sh"
    [ "$GATE_4_STATUS" = "SKIP" ]
  )
}

@test "AC-478-04 anti-vacuity: every shipped gate-4 copy resolves the checker from PROJECT_ROOT" {
  for f in githooks/gate-4.sh githooks/adapters/gate-4.sh; do
    grep -q 'PROJECT_ROOT' "$REPO_ROOT/$f" || { echo "$f never consults PROJECT_ROOT" >&2; return 1; }
    grep -Eq 'PRINCIPLES_BASE|cd "\$\{?PROJECT_ROOT' "$REPO_ROOT/$f" || {
      echo "$f still resolves the checker against the hook CWD" >&2
      return 1
    }
  done
}

@test "AC-478-04 anti-vacuity: each copy invokes the checker from that same base" {
  for f in githooks/gate-4.sh githooks/adapters/gate-4.sh; do
    grep -Eq '\(\s*cd "\$PRINCIPLES_BASE"' "$REPO_ROOT/$f" || {
      echo "$f runs the checker from the hook CWD" >&2
      return 1
    }
  done
}
