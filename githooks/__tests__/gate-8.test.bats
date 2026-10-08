#!/usr/bin/env bats

# Tests for gate-8.sh (Secret Scanning - gitleaks + detect-secrets)
#
# Since #499 the gate is FAIL-CLOSED:
#   - gitleaks missing            -> BLOCK (exit 1), never SKIP
#   - gitleaks non-0/1 exit code  -> BLOCK (exit 1), never SKIP
# so the old "SKIP when the scanner is absent" contract is gone. A security
# gate that cannot run must not report success.
#
# The gate is executed through a small inner script file (placed next to this
# test) instead of `bash -c '<multi-line>'`: quote-splicing through two shell
# layers broke on Windows, and $BATS_TEST_DIRNAME is a backslash path there
# that `source` silently rejects — which surfaced as an empty exit-0 run.
# `dirname "$0"` keeps every path POSIX-relative, and a SOURCE-FAILED sentinel
# (exit 3) makes a silently-failed source impossible to mistake for a pass.
#
# TMPDIR is forced to a POSIX-style /tmp: the hook writes its gitleaks report
# under ${TMPDIR:-/tmp}, and a Windows drive-letter TMPDIR is valid for real
# git-hook runs but trips sandboxed rm shims inside BATS.

INNER_SCRIPT="$BATS_TEST_DIRNAME/_gate8-inner.sh"

teardown() {
  # `|| true`: sandboxed environments may shim rm into rejecting this path;
  # a failed cleanup must not fail an otherwise-passing test.
  rm -f "$INNER_SCRIPT" 2>/dev/null || true
}

write_inner() {
  # $1 = extra shell to run before sourcing the gate (e.g. PATH sabotage)
  # The gate path is resolved NOW (PATH intact) and baked in as a literal:
  # after PATH sabotage even `dirname` is gone, so the inner script cannot
  # compute any path by itself.
  local gate_abs
  gate_abs="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/gate-8.sh"
  {
    printf 'export TMPDIR=/tmp\n'
    printf 'export HOME="$(mktemp -d)"\n'
    printf '%s\n' "$1"
    printf 'gate_start_ms() { echo "0"; }\n'
    printf 'record_gate_audit() { :; }\n'
    printf 'source "%s" || { echo "SOURCE-FAILED"; exit 3; }\n' "$gate_abs"
    printf 'printf "GATE8_STATUS=%%s\\n" "$GATE_8_STATUS"\n'
  } > "$INNER_SCRIPT"
}

@test "gate-8.sh sources and passes with gitleaks available (clean index)" {
  command -v gitleaks >/dev/null 2>&1 || skip "gitleaks not installed on this runner"
  write_inner ""
  run bash "$INNER_SCRIPT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"→ Gate 8"* ]]
  [[ "$output" == "GATE8_STATUS=PASS"* || "$output" == *"GATE8_STATUS=PASS"* || "$output" == *"GATE8_STATUS=SKIP"* ]]
}

@test "gate-8.sh sets GATE_8_STATUS to PASS or SKIP when gitleaks is available" {
  command -v gitleaks >/dev/null 2>&1 || skip "gitleaks not installed on this runner"
  write_inner ""
  run bash "$INNER_SCRIPT"
  [[ "$output" == *"GATE8_STATUS=PASS"* || "$output" == *"GATE8_STATUS=SKIP"* ]]
}

@test "gate-8.sh BLOCKS when gitleaks is missing (fail-closed, #499)" {
  # Hide gitleaks from PATH *and* the ~/.local/bin fallback the script probes
  # (HOME is pointed at a fresh empty temp dir).
  write_inner 'export PATH="/nonexistent-gitleaks-guard"'
  run bash "$INNER_SCRIPT"
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED"*"gitleaks not installed"* ]]
}

@test "gate-8.sh fail-closed message includes install instructions (#499)" {
  write_inner 'export PATH="/nonexistent-gitleaks-guard"'
  run bash "$INNER_SCRIPT"
  [[ "$output" == *"brew install gitleaks"* ]]
  [[ "$output" == *"winget install gitleaks"* ]]
}
