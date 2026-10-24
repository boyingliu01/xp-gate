#!/usr/bin/env bats
# @test REQ-600
# @intent Gate 11 reported PASS for sprints it never evaluated (#584).
#
#         sprint-gate.sh answered `allow` in three different situations, and
#         pre-commit's `case "$decision" in allow) STATUS=PASS` collapsed them all
#         into "checked and fine":
#
#             allow, checks passed          -> PASS   (honest)
#             allow, phase not reached      -> PASS   (nothing was checked)
#             allow, no JSON parser         -> PASS   (nothing COULD be checked)
#
#         Measured on this repository: sprint state 21-22 days old, `.sprint-state/`
#         gitignored and not in version control at all, phase=0 against a gate that
#         requires phase 6 — and Gate 11 still printed PASS. That raised
#         PASSED_COUNT, raised the score, and left the verdict unaffected, so a gate
#         that examined nothing made the report look better.
#
#         "Not applicable" is a legitimate outcome; announcing it as a PASS is not.
#         sprint-gate.sh now names WHY it allowed, and only `checks-passed` maps to
#         PASS. Everything else is SKIP, with the real reason printed.
# @covers AC-600-01, AC-600-02
bats_require_minimum_version 1.5.0

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SPRINT_GATE="$REPO_ROOT/githooks/sprint-gate.sh"
  REPORT_LIB="$REPO_ROOT/githooks/lib/sprint-gate-report.sh"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
  WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
  git init -q -b feature/x .
  git config user.email test@example.com
  git config user.name Test
  git config core.hooksPath /dev/null
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$WORK"
}

# Build .sprint-state/sprint-state.json. $1=phase, $2=days since started,
# $3=status (default in_progress).
write_state() {
  local phase="$1" days="$2" status="${3:-in_progress}"
  mkdir -p .sprint-state
  local started
  started=$(python -c "
import datetime
print((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=$days)).strftime('%Y-%m-%dT%H:%M:%SZ'))
" 2>/dev/null || date -u -d "$days days ago" +%Y-%m-%dT%H:%M:%SZ)
  cat > .sprint-state/sprint-state.json <<EOF
{
  "sprint_id": "sprint-test",
  "phase": $phase,
  "status": "$status",
  "started_at": "$started"
}
EOF
}

# The decision verb sprint-gate.sh reports.
decision() {
  bash "$SPRINT_GATE" --pre-commit 2>&1 | sed -n 's/.*"decision"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | tail -1
}

# The reason field sprint-gate.sh attaches to an allow.
allow_reason() {
  bash "$SPRINT_GATE" --pre-commit 2>&1 | sed -n 's/.*"allow_reason"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | tail -1
}

@test "AC-600-01: a pre-PLAN phase is allowed but not as checks-passed" {
  # phase 0 is "the sprint has not reached the phase this gate inspects". The
  # commit must go through, but calling that a PASS is the defect.
  write_state 0 1
  [ "$(decision)" = "allow" ] || { echo "expected allow, got $(decision)"; return 1; }
  [ "$(allow_reason)" != "checks-passed" ] || {
    echo "a pre-PLAN phase must not claim the checks passed"
    return 1
  }
  [ "$(allow_reason)" = "phase-not-reached" ] || {
    echo "expected allow_reason=phase-not-reached, got '$(allow_reason)'"
    return 1
  }
}

@test "AC-600-01: a validated sprint is allowed as checks-passed" {
  # The honest PASS: delphi approved, phase reached. This is the one shape that
  # may become Gate 11 PASS, so it must still report checks-passed.
  write_state 6 1
  mkdir -p .sprint-state
  cat > .sprint-state/requirements-reviewed.json <<'EOF'
{"verdict": "APPROVED", "experts": ["a", "b", "c"]}
EOF
  # sprint-gate.sh reads the verdict from .sprint-state/delphi-reviewed.json.
  echo '{"verdict": "APPROVED"}' > .sprint-state/delphi-reviewed.json

  local out
  out=$(bash "$SPRINT_GATE" --pre-commit 2>&1)
  # Either the gate validated (checks-passed) or it declined for a named reason --
  # what it must never do is allow with no reason at all.
  local reason
  reason=$(printf '%s' "$out" | sed -n 's/.*"allow_reason"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | tail -1)
  if printf '%s' "$out" | grep -q '"decision"[[:space:]]*:[[:space:]]*"allow"'; then
    [ -n "$reason" ] || {
      echo "an allow must always carry an allow_reason: $out"
      return 1
    }
  fi
}

@test "AC-600-01: a stale sprint is not certified (skip, not allow)" {
  # Already the behaviour from #551; pinned here because it is the same defect
  # class and must not regress while the reasons are being added.
  write_state 6 40
  # sprint-gate.sh reads the verdict from .sprint-state/delphi-reviewed.json.
  echo '{"verdict": "APPROVED"}' > .sprint-state/delphi-reviewed.json
  [ "$(decision)" = "skip" ] || {
    echo "a 40-day-old in_progress sprint must not be certified, got '$(decision)'"
    return 1
  }
}

@test "AC-600-02: pre-commit maps a non-checks-passed allow to SKIP, not PASS" {
  # The mapping is the actual fix: sprint-gate.sh could name all the reasons it
  # liked and Gate 11 would still say PASS. Assert the hook's allow arm.
  local arm
  arm=$(sed -n '/^  case "\$SPRINT_GATE_DECISION" in$/,/^  esac$/p' "$PRE_COMMIT")
  [ -n "$arm" ] || { echo "the Gate 11 decision case was not found"; return 1; }

  # The allow arm must consult a reason before defaulting to PASS.
  printf '%s' "$arm" | grep -q 'ALLOW_REASON' || {
    echo "the allow arm never reads the reason, so every allow is still a PASS:"
    printf '%s\n' "$arm"
    return 1
  }
  printf '%s' "$arm" | grep -q 'SKIP' || {
    echo "the allow arm has no SKIP path, so nothing can stop the false PASS"
    return 1
  }
}

@test "AC-600-02: running the allow arm gives SKIP for a phase-not-reached allow" {
  # A text match cannot tell whether the branch actually flips the status. Run the
  # arm: extract it, syntax-check it, and execute it inside a subshell with the
  # reason helper sourced, the way pre-commit runs it.
  sed -n '/^  case "\$SPRINT_GATE_DECISION" in$/,/^  esac$/p' "$PRE_COMMIT" > "$WORK/arm.sh"
  [ -s "$WORK/arm.sh" ] || { echo "nothing extracted"; return 1; }

  run bash -c '
    set -u
    source "$1" || exit 9
    CURRENT_GATE_STATUS=PASS
    GATE_11_STATUS=PASS
    SPRINT_GATE_DECISION=allow
    SPRINT_GATE_OUTPUT=$2
    SPRINT_GATE_DETAIL=$3
    eval "$(cat "$4")"
    echo "STATUS=$GATE_11_STATUS"
  ' _ "$REPORT_LIB" \
    '{"decision":"allow","allow_reason":"phase-not-reached","reason":"sprint phase 0 (pre-PLAN)"}' \
    'sprint phase 0 (pre-PLAN)' \
    "$WORK/arm.sh"

  [ "$status" -eq 0 ] || { echo "the arm did not run: $output"; return 1; }
  [[ "$output" == *"STATUS=SKIP"* ]] || {
    echo "a phase-not-reached allow must not leave the status at PASS: $output"
    return 1
  }
  [[ "$output" == *"phase-not-reached"* ]] || {
    echo "the reason must be printed so the operator can see why: $output"
    return 1
  }
}

@test "AC-600-02: running the allow arm still gives PASS for checks-passed" {
  # The other direction: the honest PASS must survive, or the fix just breaks the
  # gate instead of correcting it.
  sed -n '/^  case "\$SPRINT_GATE_DECISION" in$/,/^  esac$/p' "$PRE_COMMIT" > "$WORK/arm.sh"
  [ -s "$WORK/arm.sh" ] || { echo "nothing extracted"; return 1; }

  run bash -c '
    set -u
    source "$1" || exit 9
    GATE_11_STATUS=PASS
    SPRINT_GATE_DECISION=allow
    SPRINT_GATE_OUTPUT=$2
    SPRINT_GATE_DETAIL=$3
    eval "$(cat "$4")"
    echo "STATUS=$GATE_11_STATUS"
  ' _ "$REPORT_LIB" \
    '{"decision":"allow","allow_reason":"checks-passed","message":"delphi-review APPROVED"}' \
    'delphi-review APPROVED' \
    "$WORK/arm.sh"

  [ "$status" -eq 0 ] || { echo "the arm did not run: $output"; return 1; }
  [[ "$output" == *"STATUS=PASS"* ]] || {
    echo "a validated sprint must still PASS: $output"
    return 1
  }
}

@test "AC-600-02: the report helper exposes the allow reason" {
  # shellcheck disable=SC1090
  source "$REPORT_LIB"
  declare -F sprint_gate_allow_reason >/dev/null || {
    echo "sprint_gate_allow_reason is not defined"
    return 1
  }
  local out='{"decision":"allow","allow_reason":"phase-not-reached","reason":"sprint phase 0"}'
  [ "$(sprint_gate_allow_reason "$out")" = "phase-not-reached" ] || {
    echo "got '$(sprint_gate_allow_reason "$out")'"
    return 1
  }
  [ "$(sprint_gate_decision "$out")" = "allow" ] || {
    echo "the decision verb must still read as allow"
    return 1
  }
}

@test "AC-600-02: a decision with no allow_reason is treated as unchecked, not passed" {
  # Default must be the safe one. A sprint-gate.sh from an older install emits
  # allow with no reason at all; reading that as PASS reinstates the defect.
  # shellcheck disable=SC1090
  source "$REPORT_LIB"
  local out='{"decision":"allow","message":"sprint push validated"}'
  local reason
  reason=$(sprint_gate_allow_reason "$out")
  [ "$reason" != "checks-passed" ] || {
    echo "an allow with no reason must not be read as checks-passed"
    return 1
  }
}
