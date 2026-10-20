#!/usr/bin/env bats
# @test REQ-544 Gate M survivor detail reaches the pre-push journal
# @intent Verify the journal carries per-file survivor counts when they were
#         measured, and omits the field when they were not. #544: retro could not
#         answer "which module has the most surviving mutants" because the
#         journal only held {skip_reason, duration_ms, mutation_score}. The
#         distinction that matters here is absent-vs-zero: a written zero means
#         "measured, no survivors", and that must never stand in for "never
#         measured". The field is a JSON document inside a string-valued domain,
#         so it is passed through the environment rather than interpolated into
#         the Python heredoc -- a quote in a path would otherwise break the hook.
# @covers AC-544-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_PUSH="$REPO_ROOT/githooks/pre-push"
}

@test "anti-vacuity: pre-push still writes Gate M details" {
  grep -q "'id': 'M'" "$PRE_PUSH"
  grep -q '_m_details' "$PRE_PUSH"
}

@test "the survivor JSON is collected from gate-m output" {
  grep -q 'GATE_M_SURVIVORS_JSON' "$PRE_PUSH"
  grep -q 'M_SURVIVORS_JSON' "$PRE_PUSH"
}

@test "the survivor JSON crosses into the report via the environment, not interpolation" {
  # Interpolating a JSON document into the Python source would break on any
  # quote in a file path. The writer must read it from the environment.
  grep -q 'export XP_GATE_M_SURVIVORS_JSON' "$PRE_PUSH"
  grep -q "os.environ.get('XP_GATE_M_SURVIVORS_JSON'" "$PRE_PUSH"
}

@test "the field is omitted when nothing was measured" {
  # The conditional must gate on the parsed value, not on a string literal.
  grep -q 'if survivors_detail is not None' "$PRE_PUSH"
}

@test "a malformed survivor payload does not break the journal" {
  # json.loads failures are caught and degrade to "not measured".
  local block
  block=$(awk '/_survivors_raw = os.environ.get/,/survivors_detail = None$/' "$PRE_PUSH")
  [ -n "$block" ]
  printf '%s\n' "$block" | grep -q 'except (ValueError, TypeError)'
}

@test "gate-m.ts emits a machine-readable survivor line" {
  local GATE_M="$REPO_ROOT/src/mutation/gate-m.ts"
  grep -q 'GATE_M_SURVIVORS_JSON=' "$GATE_M"
  grep -q 'export function summarizeSurvivors' "$GATE_M"
}

@test "gate-m.ts does not fabricate zero counts" {
  local GATE_M="$REPO_ROOT/src/mutation/gate-m.ts"
  # summarizeSurvivors must return null without a report, never a summary of
  # zeros -- that was the original defect's shape.
  grep -q 'if (!report || !report.files) return null;' "$GATE_M"
}

@test "every status variable the journal reads is one the hook actually assigns" {
  # Found while wiring #544: the journal read GATE_M_PYTHON_STATUS while the code
  # assigned GATE_M_PY_STATUS, so M-Python permanently reported its SKIP default
  # no matter what happened -- #557's exact bug, still live for that one gate.
  # Any future rename of an assigned variable must not silently orphan a journal
  # field again.
  local missing=""
  local var
  for var in GATE_MP_STATUS GATE_10_STATUS GATE_M_STATUS GATE_M_PY_STATUS \
             GATE_M_GO_STATUS GATE_M_JAVA_STATUS GATE_DELPHI_STATUS GATE_S_STATUS; do
    if ! grep -qE "^[[:space:]]*${var}=" "$PRE_PUSH"; then
      missing="$missing $var"
    fi
  done
  [ -z "$missing" ] || {
    echo "journal reads variables the hook never assigns:$missing"
    false
  }
}
