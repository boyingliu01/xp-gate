#!/usr/bin/env bats
# @test REQ-507-02
# @intent G3 CCN 阈值三级覆盖：.xp-gate/ccn-threshold > XP_GATE_CCN_THRESHOLD > 默认 5；
#         非法值 WARN + 回退默认；生效阈值进入 gate-3 审计输出（#507 S2）。
# @covers AC-507-02-01 AC-507-02-02 AC-507-02-03 AC-507-02-04 AC-507-02-05

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  export TMPDIR=/tmp
  FIXTURE_REPO="$(mktemp -d)"
  # The resolver reads .xp-gate/ccn-threshold relative to the repo root (the
  # hook's cwd at runtime); tests run it with cwd = fixture repo.
  (
    cd "$FIXTURE_REPO" || exit 1
    mkdir -p .xp-gate
  )
}

teardown() {
  rm -rf "$FIXTURE_REPO" 2>/dev/null || true
}

# The real resolver, extracted from the live gate at run time. An empty or
# moved extraction fails loudly instead of testing nothing. The function is
# defined inside gate-3.sh's else-branch, so extraction tolerates indentation.
resolver_block() {
  awk '/^[[:space:]]*resolve_ccn_threshold\(\) \{/,/^[[:space:]]*\}/ {print}' "$REPO_ROOT/githooks/gate-3.sh"
}

run_resolver() {
  (
    set -u
    cd "$FIXTURE_REPO" || exit 90
    block=$(resolver_block)
    [ -n "$block" ] || { echo "EXTRACTION-EMPTY" >&2; exit 91; }
    export XP_GATE_CCN_THRESHOLD="${XP_GATE_CCN_THRESHOLD:-}"
    eval "$block"
    # WARN diagnostics go to a log file (bats `run` would otherwise merge
    # stderr into $output and blur the resolved-value assertion).
    resolve_ccn_threshold 2>"$FIXTURE_REPO/resolve-warn.log"
  )
}

resolver_warn_log() {
  cat "$FIXTURE_REPO/resolve-warn.log" 2>/dev/null
}

# --- AC-507-02-01: project file wins ---
@test "AC-507-02-01: .xp-gate/ccn-threshold=10 resolves to 10" {
  printf '10\n' > "$FIXTURE_REPO/.xp-gate/ccn-threshold"
  run run_resolver
  [ "$status" -eq 0 ]
  [ "$output" = "10" ]
}

# --- AC-507-02-02: env var applies; file takes precedence ---
@test "AC-507-02-02: env var 8 applies when no file" {
  unset XP_GATE_CCN_THRESHOLD
  export XP_GATE_CCN_THRESHOLD=8
  run run_resolver
  [ "$status" -eq 0 ]
  [ "$output" = "8" ]
}

@test "AC-507-02-02: file 12 beats env 8" {
  printf '12\n' > "$FIXTURE_REPO/.xp-gate/ccn-threshold"
  export XP_GATE_CCN_THRESHOLD=8
  run run_resolver
  [ "$status" -eq 0 ]
  [ "$output" = "12" ]
}

# --- AC-507-02-03: invalid values WARN + fall back to 5 ---
@test "AC-507-02-03: non-numeric file value warns and falls back to 5" {
  printf 'abc\n' > "$FIXTURE_REPO/.xp-gate/ccn-threshold"
  run run_resolver
  [ "$status" -eq 0 ]
  [ "$output" = "5" ]
  resolver_warn_log | grep -q "WARN.*ccn-threshold"
}

@test "AC-507-02-03: zero and negative file values fall back to 5" {
  printf '0\n' > "$FIXTURE_REPO/.xp-gate/ccn-threshold"
  run run_resolver
  [ "$output" = "5" ]
  printf -- '-5\n' > "$FIXTURE_REPO/.xp-gate/ccn-threshold"
  run run_resolver
  [ "$output" = "5" ]
  printf '   \n' > "$FIXTURE_REPO/.xp-gate/ccn-threshold"
  run run_resolver
  [ "$output" = "5" ]
}

@test "AC-507-02-03: invalid env var warns and falls back to 5" {
  export XP_GATE_CCN_THRESHOLD="not-a-number"
  run run_resolver
  [ "$status" -eq 0 ]
  [ "$output" = "5" ]
  resolver_warn_log | grep -q "WARN.*XP_GATE_CCN_THRESHOLD"
}

# --- AC-507-02-05: no config = legacy default 5 ---
@test "AC-507-02-05: no file and no env var resolves to default 5" {
  unset XP_GATE_CCN_THRESHOLD
  run run_resolver
  [ "$status" -eq 0 ]
  [ "$output" = "5" ]
}

# --- AC-507-02-04: effective threshold reaches the gate-3 audit output ---
@test "AC-507-02-04: gate-3 audit record carries the effective threshold" {
  grep -q 'record_gate_audit "gate-3" "complexity" "$GATE_3_STATUS" "${CC_WARNINGS:-0}" "$GATE_3_START" "ccn_threshold=' "$REPO_ROOT/githooks/gate-3.sh"
}

@test "AC-507-02-04: record_gate_audit forwards an optional detail argument" {
  grep -q 'detail' "$REPO_ROOT/githooks/pre-commit" || return 1
  # The audit CLI accepts --detail (additive, optional field).
  grep -q "opts\['detail'\]" "$REPO_ROOT/src/npm-package/lib/gate-audit.ts"
}

@test "AC-507-02-04 anti-vacuity: the extraction is the real resolver" {
  block=$(resolver_block)
  [ "$(printf '%s\n' "$block" | wc -l)" -ge 10 ]
  printf '%s\n' "$block" | grep -q 'ccn-threshold'
  printf '%s\n' "$block" | grep -q 'XP_GATE_CCN_THRESHOLD'
}
