#!/usr/bin/env bats
# Issue #535: sourcing a missing lib must fail CLOSED, not silently continue.
#
# The incident: on 2026-10-16 the hooks/lib/python-test-selection.sh source
# failed ("No such file or directory") mid-commit, the hook printed one stderr
# line and kept going, and every gate still reported PASS/10.0. A lib that
# carries a fail-closed contract (python-test-selection.sh says so in its own
# header) being absent means that logic did not exist for the run -- yet the
# verdict was green. That is a fail-open surface inside a fail-closed design.
#
# Contract pinned here:
#   1. Every lib/<name>.sh sourced by pre-commit goes through
#      source_gate_lib(), which aborts with "FATAL: cannot load" when the
#      file is missing or exits non-zero while being sourced.
#   2. pre-push carries no raw lib sources either.
#   3. Sourcing the real libs still succeeds (no regression to the happy path).

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOKS_DIR="$REPO_ROOT/githooks"
}

@test "#535 pre-commit defines a source_gate_lib guard" {
  grep -q '^source_gate_lib()' "$HOOKS_DIR/pre-commit"
}

@test "#535 every lib source in pre-commit goes through the guard" {
  # Raw `source "${AUDIT_SCRIPT_DIR}/lib/..."` calls outside the guard are the
  # fail-open surface this issue is about. Only guarded calls may remain.
  local raw
  raw=$(grep -E '^[[:space:]]*source[[:space:]]+"\$\{AUDIT_SCRIPT_DIR\}/lib/' "$HOOKS_DIR/pre-commit" | grep -v 'source_gate_lib' || true)
  [ -z "$raw" ]
}

@test "#535 pre-push carries no raw lib sources" {
  local raw
  raw=$(grep -E '^[[:space:]]*source[[:space:]]+"\$\{(HOOK_DIR|SCRIPT_DIR|AUDIT_SCRIPT_DIR)\}/lib/' "$HOOKS_DIR/pre-push" || true)
  [ -z "$raw" ]
}

@test "#535 guard aborts when the lib file is missing" {
  tmp="$(mktemp -d)"
  cat > "$tmp/case.sh" <<EOF
$(sed -n '/^source_gate_lib()/,/^}/p' "$HOOKS_DIR/pre-commit")
source_gate_lib '$tmp/nope.sh'
echo SURVIVED
EOF
  run bash "$tmp/case.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"FATAL: cannot load"* ]]
  [[ "$output" != *SURVIVED* ]]
  rm -rf "$tmp"
}

@test "#535 guard aborts when the lib fails while being sourced" {
  tmp="$(mktemp -d)"
  # `exit` inside a sourced file exits the SOURCING shell, so a plain
  # `source` cannot be wrapped in `if !` — the guard must trap EXIT instead.
  printf 'exit 3\n' > "$tmp/broken.sh"
  cat > "$tmp/case.sh" <<EOF
$(sed -n '/^source_gate_lib()/,/^}/p' "$HOOKS_DIR/pre-commit")
source_gate_lib '$tmp/broken.sh'
echo SURVIVED
EOF
  run bash "$tmp/case.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"FATAL: cannot load"* ]]
  [[ "$output" != *SURVIVED* ]]
  rm -rf "$tmp"
}

@test "#535 guard loads a healthy lib without noise" {
  tmp="$(mktemp -d)"
  printf 'GATE_LIB_PROBE=ok\n' > "$tmp/healthy.sh"
  cat > "$tmp/case.sh" <<EOF
$(sed -n '/^source_gate_lib()/,/^}/p' "$HOOKS_DIR/pre-commit")
source_gate_lib '$tmp/healthy.sh'
echo "VALUE=\$GATE_LIB_PROBE"
EOF
  run bash "$tmp/case.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *VALUE=ok* ]]
  [[ "$output" != *"FATAL"* ]]
  rm -rf "$tmp"
}

@test "#535 all libs shipped under hooks/lib still source cleanly" {
  for lib in "$HOOKS_DIR"/lib/*.sh; do
    run bash -c "set -u; source '$lib'"
    # Some libs only define functions and reference variables lazily; a clean
    # source must exit 0.
    [ "$status" -eq 0 ]
  done
}
