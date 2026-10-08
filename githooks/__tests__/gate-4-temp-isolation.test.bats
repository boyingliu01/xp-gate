#!/usr/bin/env bats
# @test REQ-457
# @intent Gate 4 wrote the checker's JSON report to the fixed path
#         /tmp/principles-output.json. Two gate runs that overlap on one machine --
#         two worktrees, a hook and a CI job, a re-entry -- share that file, so the
#         second truncates the first's report before it is counted. A run with
#         ERROR-severity findings then reads a clean report and PASSes, which is the
#         exact false negative this gate exists to prevent. Each invocation now gets
#         its own mktemp file.
# @covers AC-457-17, AC-457-18

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  TEST_DIR="$(mktemp -d)"

  mkdir -p "$TEST_DIR/src/principles" "$TEST_DIR/bin" "$TEST_DIR/home"
  echo "// stub" > "$TEST_DIR/src/principles/index.ts"

  cat > "$TEST_DIR/bin/npx" << 'STUB'
#!/bin/sh
exit 0
STUB
  chmod +x "$TEST_DIR/bin/npx"

  # The pre-fix module, recovered from git rather than reimplemented, so the
  # "provably broken before" assertion runs the real old code path. Resolved from
  # history, not from HEAD and not from a pinned SHA: HEAD's copy became the fixed
  # module the moment the fix was committed (the guard passed only while the author
  # ran it inside that commit's own pre-commit hook), and a rebase would move a
  # literal SHA. The pickaxe string is the per-invocation report, not `mktemp` --
  # the stderr temp predates the fix.
  local fix_commit
  fix_commit="$(git -C "$REPO_ROOT" log --format=%H -S'PRINCIPLES_JSON=$(mktemp)' -- githooks/gate-4.sh | tail -1)"
  [ -n "$fix_commit" ] || { echo "cannot locate the commit that introduced the per-invocation report" >&2; return 1; }
  git -C "$REPO_ROOT" show "$fix_commit^:githooks/gate-4.sh" > "$TEST_DIR/gate-4.shared-path.sh"
  grep -q '/tmp/principles-output.json' "$TEST_DIR/gate-4.shared-path.sh" || {
    echo "the resolved pre-fix module does not use the shared report path" >&2
    return 1
  }
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
  rm -f /tmp/principles-output.json
}

# Write a report carrying `$1` error-severity violations into `$2` (the path the gate
# chose). The fallback models the pre-fix convention: a module that never sets
# PRINCIPLES_JSON wrote to the shared path, so a faithful stub writes there too.
write_report() {
  local errors="$1" target="${2:-${PRINCIPLES_JSON:-/tmp/principles-output.json}}" _i="" _json=""
  for _i in $(seq 1 "$errors"); do
    _json="${_json}{\"severity\": \"error\", \"rule\": \"x\"},"
  done
  printf '{"violations":[%s],"summary":{}}' "${_json%,}" > "$target"
}

# Shared environment for sourcing a gate-4 module inside a subshell.
gate_env() {
  cd "$TEST_DIR" || return 1
  gate_start_ms() { echo 0; }
  record_gate_audit() { :; }
  PROJECT_LANG="typescript"
  PROJECT_ROOT="$TEST_DIR"
  HOME="$TEST_DIR/home"
  PATH="$TEST_DIR/bin:$PATH"
  CHANGED_FILES="src/principles/index.ts"
  GATE_4_STATUS=""
  WARNING_COUNT=0
}

# Source a gate-4 module whose checker emits `$1` errors, and print the resulting
# status. On the BLOCK path the module itself calls `exit 1`, so the status is taken
# from the exit code rather than from a variable read that would never be reached.
#   $1 -- module path, $2 -- error count, $3 -- "interleave" to run a clean nested
#         gate between the report write and the counting (see AC-457-18).
gate_status_with() {
  local module="$1" errors="$2" interleave="${3:-}" out="" rc=0
  out="$(
    gate_env
    STUB_ERRORS="$errors"
    NESTED_RUN=0
    run_tsx() {
      write_report "$STUB_ERRORS"
      if [ "$interleave" = "interleave" ] && [ "$NESTED_RUN" = "0" ]; then
        NESTED_RUN=1
        GATE_4_STATUS=""
        STUB_ERRORS=0
        # shellcheck disable=SC1091
        source "$module" >/dev/null 2>&1
        STUB_ERRORS="$errors"
        NESTED_RUN=0
      fi
    }
    # shellcheck disable=SC1091
    source "$module" >/dev/null 2>&1
    printf '%s' "${GATE_4_STATUS:-}"
  )" || rc=$?
  # 1 on the module's own BLOCK path (it calls `exit 1`), 0 on PASS and SKIP.
  if [ "$rc" -ne 0 ]; then
    printf 'FAIL'
  else
    printf '%s' "$out"
  fi
}

@test "AC-457-17: no gate-4 copy writes the checker report to a fixed shared path" {
  for f in githooks/gate-4.sh githooks/adapters/gate-4.sh githooks/gates/gate-4-principles.sh; do
    # Match the REDIRECTION, not the prose: the modules name the shared path in a
    # comment explaining why it was removed, and a comment must stay allowed to.
    if grep -Eq '> *"*/tmp/principles-output' "$REPO_ROOT/$f"; then
      echo "$f still writes the report to the shared /tmp path" >&2
      return 1
    fi
  done
}

@test "AC-457-17: findings are counted from a per-invocation file" {
  # Anti-vacuity: with no gate-created path the stub has nowhere faithful to write,
  # the report stays empty, and a broken wiring would read as a clean PASS.
  [ "$(gate_status_with "$REPO_ROOT/githooks/gate-4.sh" 1)" = "FAIL" ]
  [ "$(gate_status_with "$REPO_ROOT/githooks/gate-4.sh" 0)" = "PASS" ]
}

@test "AC-457-18: two invocations on one machine do not share a report file" {
  # Both runs are clean on purpose: the BLOCK path makes the module itself `exit 1`,
  # which would end the subshell before the path could be read back.
  first="$(
    (
      gate_env
      STUB_ERRORS=0
      run_tsx() { write_report "$STUB_ERRORS"; }
      # shellcheck disable=SC1091
      source "$REPO_ROOT/githooks/gate-4.sh" >/dev/null 2>&1
      printf '%s' "${PRINCIPLES_JSON:-}"
    )
  )"
  second="$(
    (
      gate_env
      STUB_ERRORS=0
      run_tsx() { write_report "$STUB_ERRORS"; }
      # shellcheck disable=SC1091
      source "$REPO_ROOT/githooks/gate-4.sh" >/dev/null 2>&1
      printf '%s' "${PRINCIPLES_JSON:-}"
    )
  )"
  [ -n "$first" ]
  [ -n "$second" ]
  [ "$first" != "$second" ]
  case "$first" in
    */tmp/principles-output.json) echo "gate still uses the shared path" >&2; return 1 ;;
  esac
}

@test "AC-457-18: an overlapping clean run cannot mask another run's findings" {
  # Run A's checker writes its findings; a clean run then executes before A counts
  # its report. Shared file: the clean run truncates A's findings and A PASSes.
  # Per-invocation file: A's report is untouched and A blocks.
  [ "$(gate_status_with "$REPO_ROOT/githooks/gate-4.sh" 1 interleave)" = "FAIL" ]
}

@test "AC-457-18 regression guard: the pre-fix shared-path module is provably wrong" {
  # The same interleaving against the module as it stood before the fix. If this
  # stops passing, the fixture no longer reproduces the bug and the assertion above
  # proves nothing.
  [ "$(gate_status_with "$TEST_DIR/gate-4.shared-path.sh" 1 interleave)" = "PASS" ]
}
