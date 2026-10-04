#!/usr/bin/env bats
# @test REQ-457
# @intent Gate 4 must tell "the checker found ERROR-severity violations" apart from
#         "the checker itself failed". Both used to exit 1, and the gate branched on
#         `if run_tsx ...; then`, which collapsed them: a real finding took the crash
#         branch, printed PASSED (SKIP), and released exactly the most serious
#         violations. Exit codes are now 0 clean / 1 findings / >=2 tool failure.
# @covers AC-457-08, AC-457-09

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

# Source gate-4.sh with a stubbed run_tsx so the decision is driven purely by the
# exit status we choose, independent of whether tsx works in this environment.
run_gate_with_exit() {
  local exit_status="$1" payload="$2"
  (
    set -u
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    PROJECT_LANG="typescript"
    CHANGED_FILES="src/test.ts"
    GATE_4_STATUS=""
    WARNING_COUNT=0
    PRINCIPLES_FILES="src/test.ts"
    PRINCIPLES_DIR="src/principles"
    run_tsx() {
      printf '%s' "$payload" > /tmp/principles-output.json
      return "$exit_status"
    }
    # shellcheck disable=SC1091
    source "$REPO_ROOT/githooks/gate-4.sh"
    printf '%s' "$GATE_4_STATUS"
  )
}

PAYLOAD_ERRORS='{
  "violations": [
    {"file":"src/a.ts","line":3,"ruleId":"solid.srp","message":"x","severity":"error"}
  ],
  "summary": {"totalViolations": 1, "errorCount": 1, "warningCount": 0}
}'

PAYLOAD_CLEAN='{
  "violations": [],
  "summary": {"totalViolations": 0, "errorCount": 0, "warningCount": 0}
}'

@test "AC-457-08: exit 1 with error-severity findings BLOCKS instead of skipping" {
  run run_gate_with_exit 1 "$PAYLOAD_ERRORS"
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED"* ]]
  # The regression this guards: the crash branch used to announce success.
  [[ "$output" != *"SKIPPED"* ]]
  [[ "$output" != *"PASSED"* ]]
}

@test "AC-457-09: exit 2 means the tool failed and SKIPs without claiming PASS" {
  run run_gate_with_exit 2 '{"violations":[],"summary":{}}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"SKIPPED"* ]]
  [[ "$output" != *"✅ PASSED"* ]]
}

@test "AC-457-08: exit 0 with no findings PASSES" {
  run run_gate_with_exit 0 "$PAYLOAD_CLEAN"
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED"* ]]
}

@test "AC-457-09: every shipped gate-4 copy branches on exit >= 2" {
  for f in githooks/gate-4.sh githooks/adapters/gate-4.sh githooks/gates/gate-4-principles.sh; do
    grep -q 'PRINCIPLES_EXIT.*-ge 2' "$REPO_ROOT/$f" || {
      echo "missing crash/violation split in $f" >&2
      return 1
    }
  done
}

@test "AC-457-09: no shipped gate-4 copy still wraps the checker in if-run-then" {
  for f in githooks/gate-4.sh githooks/adapters/gate-4.sh githooks/gates/gate-4-principles.sh; do
    if grep -Eq '^\s*if (run_tsx|npx tsx) .*index\.ts.*; then' "$REPO_ROOT/$f"; then
      echo "$f still conflates exit 1 with exit 2" >&2
      return 1
    fi
  done
}
