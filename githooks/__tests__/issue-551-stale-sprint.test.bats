#!/usr/bin/env bats
# @test REQ-551 Gate 11 detects stale sprints
# @intent Verify Gate 11 cannot report PASS for a sprint whose state has not
#         moved. #551: sprint-gate.sh read only `phase` and the delphi verdict,
#         so a state file left at status=in_progress for 12 days produced
#         "✅ PASSED ... sprint phase 6 validated" on every unrelated commit.
#         That removes the gate's ability to tell an advancing sprint from an
#         abandoned one -- worse than SKIP, because SKIP is honest and PASS
#         misleads. It also injects a 12-day-old phase_history event into every
#         commit's audit trail as "sprint conservation evidence".
# @covers AC-551-01

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/sprint-gate.sh"
  WORK="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$WORK/.sprint-state"
  git -C "$WORK" init -q 2>/dev/null
  git -C "$WORK" config user.email t@example.com
  git -C "$WORK" config user.name t
  printf 'x\n' > "$WORK/README.md"
  git -C "$WORK" add README.md
  git -C "$WORK" commit -q -m init 2>/dev/null
  # APPROVED delphi file so the only remaining variable is staleness.
  printf '{"verdict":"APPROVED"}\n' > "$WORK/.sprint-state/delphi-reviewed.json"
  # Gate resolves its dirs relative to cwd / repo root.
  cp "$GATE" "$WORK/sprint-gate.sh"
  chmod +x "$WORK/sprint-gate.sh"
}

write_state() { # phase status started_at
  local phase="$1" status="$2" started="$3"
  cat > "$WORK/.sprint-state/sprint-state.json" <<JSON
{"id":"sprint-test","phase":$phase,"status":"$status","started_at":"$started"}
JSON
}

run_gate() { # cwd = WORK
  ( cd "$WORK" && bash ./sprint-gate.sh --pre-commit 2>&1 )
}

@test "anti-vacuity: the gate script still runs and allows a fresh sprint" {
  write_state 6 in_progress "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  run run_gate
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"allow"'* ]]
}

@test "a sprint stalled well past the threshold is not a plain allow" {
  # Beyond the default 14-day threshold.
  local old
  old=$(bash -c 'date -u -d "@$(( $(date -u +%s) - 20*86400 ))" +%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
        || bash -c 'date -u -v-20d +%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)
  write_state 6 in_progress "$old"
  run run_gate
  # It may skip or deny, but it must not serve an unconditional allow with a
  # "validated" message.
  if [ "$status" -eq 0 ]; then
    [[ "$output" != *"sprint phase 6 validated"* ]]
  fi
  [[ "$output" == *"stale"* || "$output" == *"STALE"* || "$output" == *"SKIP"* || "$output" == *"skip"* || "$status" -ne 0 ]]
}

@test "a stalled sprint reports its age and how to clear it" {
  local old
  old=$(bash -c 'date -u -d "@$(( $(date -u +%s) - 20*86400 ))" +%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
        || bash -c 'date -u -v-20d +%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)
  write_state 6 in_progress "$old"
  run run_gate
  # Visibility matters as much as the verdict: an operator who sees only a skip
  # has no idea what to do about it.
  [[ "$output" == *"20 day"* ]]
  [[ "$output" == *"sprint-state.json"* || "$output" == *"close"* ]]
}

@test "the threshold is overridable by env" {
  local old
  old=$(bash -c 'date -u -d "@$(( $(date -u +%s) - 5*86400 ))" +%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
        || bash -c 'date -u -v-5d +%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)
  write_state 6 in_progress "$old"
  # 5 days is fine under the 14-day default but stale under a 3-day threshold.
  run bash -c "cd '$WORK' && SPRINT_STALE_DAYS=3 bash ./sprint-gate.sh --pre-commit 2>&1"
  [[ "$output" == *"stale"* || "$output" == *"STALE"* ]]
}

@test "the gate consults staleness at all" {
  grep -qE 'stale|STALE' "$GATE"
}

@test "the staleness threshold is configurable and documented" {
  grep -qE 'SPRINT_STALE|STALE_DAYS|stale_days' "$GATE"
}

@test "a completed sprint is not treated as stale" {
  write_state 6 completed "2020-01-01T00:00:00Z"
  run run_gate
  # status != in_progress means the sprint is not abandoned mid-flight.
  [ "$status" -eq 0 ]
}

@test "the allow message names how long the sprint has been open" {
  write_state 6 in_progress "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  run run_gate
  [ "$status" -eq 0 ]
  [[ "$output" == *day* ]]
}
