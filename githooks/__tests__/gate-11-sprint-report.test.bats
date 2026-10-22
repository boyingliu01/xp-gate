#!/usr/bin/env bats
# @test REQ-476
# @intent Gate 11 reported "sprint-gate.sh not found" on machines where the file was
#         installed under ~/.config/xp-gate/hooks, because every tier of the resolution
#         chain pointed at a gate-script directory. Its decision JSON then printed with
#         no heading, under Gate 10's banner, and "skip: not a sprint project" -- a
#         legitimate outcome -- was shown as a bare object with no human line.
# @covers AC-476-01, AC-476-02, AC-476-03, AC-476-04, AC-476-05, AC-476-06, AC-476-07

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/sprint-gate-report.sh"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  TEST_DIR="$(mktemp -d)"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

make_gate_dir() {
  local dir="$1" body="$2"
  mkdir -p "$dir"
  printf '#!/usr/bin/env bash\n%s\n' "$body" > "$dir/sprint-gate.sh"
  chmod +x "$dir/sprint-gate.sh"
}

# Runs the wired Gate 11 region, lifted out of pre-commit, against stub directories.
# The region's `exit 1` deny path is contained by running it in a subshell; its status
# is read back from the audit record the region writes before exiting.
run_wired_gate_11() {
  (
    set -u
    source "$LIB"
    cd "$TEST_DIR/repo" || exit 1
    gate_start_ms() { echo 0; }
    audit_status=""
    record_gate_audit() { audit_status="$3"; printf '%s' "$3" > "$TEST_DIR/audit-status"; }
    GATE_DIR="$TEST_DIR/adapters"
    SCRIPT_DIR="$TEST_DIR/hooks"
    HOME="$TEST_DIR/home"
    GATE_11_START=$(date +%s)
    GATE_11_STATUS="PASS"
    region=$(awk '/# BEGIN SPRINT_GATE_SCRIPT RESOLUTION/,/record_gate_audit "gate-11" "sprint-flow" "\$GATE_11_STATUS" "0"/' "$HOOK")
    ( eval "$region" )
    inner=$?
    printf 'STATUS=%s EXITED=%s' "$(cat "$TEST_DIR/audit-status" 2>/dev/null)" "$inner"
  )
}

prepare_repo() {
  mkdir -p "$TEST_DIR/repo"
  cd "$TEST_DIR/repo" || return 1
  git init -q
  git config core.hooksPath .git/hooks
}

@test "AC-476-01: the resolver takes the first directory that actually holds the script" {
  mkdir -p "$TEST_DIR/a" "$TEST_DIR/b"
  make_gate_dir "$TEST_DIR/b" 'echo hi'
  run bash -c "source '$LIB'; resolve_sprint_gate_script '$TEST_DIR/a' '$TEST_DIR/b'"
  [ "$output" = "$TEST_DIR/b/sprint-gate.sh" ]
}

@test "AC-476-01: a directory that exists but lacks the script is not a match" {
  mkdir -p "$TEST_DIR/a"
  run bash -c "source '$LIB'; resolve_sprint_gate_script '$TEST_DIR/a' ; echo \"exit=\$?\""
  [[ "$output" != *"sprint-gate.sh"* ]]
  [[ "$output" == *"exit=1"* ]]
}

@test "AC-476-02: the canonical global hooks directory is part of the chain" {
  grep -q '.config/xp-gate/hooks' "$HOOK"
}

@test "AC-476-03: 'not found' names every location it searched" {
  prepare_repo
  mkdir -p "$TEST_DIR/adapters" "$TEST_DIR/hooks" "$TEST_DIR/home"
  run run_wired_gate_11
  [[ "$output" == *"SKIPPED - Gate 11"* ]]
  [[ "$output" == *"adapters"* ]]
  [[ "$output" == *"hooks"* ]]
  [[ "$output" == *"STATUS=SKIP"* ]]
}

@test "AC-476-04: a skip decision is translated into a human line, not a bare object" {
  prepare_repo
  make_gate_dir "$TEST_DIR/home/.config/xp-gate/hooks" \
    "echo '{\"decision\":\"skip\",\"reason\":\"not a sprint project\"}'"
  run run_wired_gate_11
  [[ "$output" == *"SKIPPED - Gate 11: Sprint Flow (not a sprint project)"* ]]
  [[ "$output" == *"STATUS=SKIP"* ]]
}

@test "AC-476-04: the gate the decision belongs to is named before it runs" {
  prepare_repo
  make_gate_dir "$TEST_DIR/home/.config/xp-gate/hooks" \
    "echo '{\"decision\":\"skip\",\"reason\":\"not a sprint project\"}'"
  run run_wired_gate_11
  [[ "$output" == *"→ Gate 11: Sprint Flow"* ]]
}

@test "AC-476-05: an allow decision reads as a pass and never as a skip" {
  run bash -c "
    source '$LIB'
    out='{\"decision\":\"allow\",\"message\":\"delphi-review APPROVED, sprint phase 3 validated\"}'
    echo \"\$(sprint_gate_decision \"\$out\")|\$(sprint_gate_detail \"\$out\")\"
  "
  [[ "$output" == "allow|delphi-review APPROVED, sprint phase 3 validated" ]]
}

@test "AC-476-05: the wired region blocks a deny with its reason" {
  prepare_repo
  make_gate_dir "$TEST_DIR/adapters" \
    "echo '{\"decision\":\"deny\",\"reason\":\"delphi-review not APPROVED\"}'; exit 1"
  run run_wired_gate_11
  [[ "$output" == *"BLOCKED - Gate 11"* ]]
  [[ "$output" == *"delphi-review not APPROVED"* ]]
  [[ "$output" == *"EXITED=1"* ]]
}

@test "AC-476-06: an unrecognised decision falls back to the exit status, never silently passes" {
  run bash -c "source '$LIB'; sprint_gate_decision 'this is not json at all'"
  [ "$output" = "unknown" ]
}

@test "AC-476-07 anti-vacuity: the hook uses the resolver instead of hand-rolled tiers" {
  # The three wiring facts, each asserted on the thing that matters rather than
  # on one exact spelling.
  #
  # The library is loaded through `source_gate_lib` (a guarded wrapper) rather
  # than a bare `source`, so matching the literal
  #     source "${AUDIT_SCRIPT_DIR}/lib/sprint-gate-report.sh"
  # made this case red on correct code once the wrapper was introduced. What the
  # invariant needs is: the report library is loaded, from a path under
  # $AUDIT_SCRIPT_DIR — how it is loaded is an implementation detail.
  awk '/^[[:space:]]*#/ {next} /sprint-gate-report\.sh/ && /AUDIT_SCRIPT_DIR/ {found=1} END {exit !found}' "$HOOK" || {
    echo "pre-commit no longer loads lib/sprint-gate-report.sh from AUDIT_SCRIPT_DIR"
    return 1
  }

  # The resolver must be used, not re-implemented inline.
  grep -q 'resolve_sprint_gate_script' "$HOOK" || {
    echo "pre-commit does not call resolve_sprint_gate_script"
    return 1
  }
  # ...and the decision must go through the shared translator.
  grep -q 'sprint_gate_decision' "$HOOK" || {
    echo "pre-commit does not call sprint_gate_decision"
    return 1
  }

  # Anti-vacuity: the resolver really lives in the sourced library, so these
  # greps are not passing on a commented-out or unrelated mention.
  grep -q '^resolve_sprint_gate_script()' "$LIB" || {
    echo "resolve_sprint_gate_script is not defined in $LIB"
    return 1
  }
  grep -q '^sprint_gate_decision()' "$LIB" || {
    echo "sprint_gate_decision is not defined in $LIB"
    return 1
  }
}

@test "AC-476-08: pre-push's sprint gate chain probes the same canonical directory" {
  # Same root cause on the push path: two gate-script tiers, no global hooks dir.
  grep -q '"$HOME/.config/xp-gate/hooks"' "$REPO_ROOT/githooks/pre-push"
  grep -q 'searched:' "$REPO_ROOT/githooks/pre-push"
}
