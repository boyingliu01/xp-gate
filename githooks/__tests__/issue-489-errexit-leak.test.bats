#!/usr/bin/env bats
# @test REQ-489
# @intent A gate module is SOURCED into pre-commit, so a bare `set -e` inside it
#         leaks errexit into the rest of the hook; the first zero-match pipeline
#         afterwards (FAIL_LINES extraction in generate_quality_report) then kills
#         the hook after all gates printed PASS -- commit silently never lands
#         (#489, reproduced on consumer repos via the installed npm hooks).
#         The probe must run in a FRESH bash: bats' own `run` suppresses errexit
#         inside the function it calls, which would mask the leak.
# @covers AC-489-01, AC-489-02, AC-489-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

# Source a gate-4 copy with the same stubs gate-4-exit-code.test.bats uses, then
# run the FAIL_LINES-shaped zero-match pipeline WITHOUT `|| true`: if the sourced
# copy enabled errexit, this assignment is where the hook dies (#489 root chain).
probe_gate4_source() {
  local copy="$1"
  (
    set -o pipefail
    set -u
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    has_project_lang() { return 1; }
    PROJECT_LANG="typescript"
    CHANGED_FILES="src/test.ts"
    GATE_4_STATUS=""
    WARNING_COUNT=0
    PRINCIPLES_FILES="src/test.ts"
    PRINCIPLES_DIR="src/principles"
    run_tsx() {
      printf '%s' '{"violations":[],"summary":{"totalViolations":0,"errorCount":0,"warningCount":0}}' > "${PRINCIPLES_JSON:?gate set no output path}"
      return 0
    }
    # shellcheck disable=SC1090
    source "$copy" >/dev/null 2>&1
    case $- in *e*) echo "ERREXIT-ON" ;; *) echo "ERREXIT-OFF" ;; esac
    FAIL_LINES=$(printf 'run v5\n ok\n' | grep -E "^\s*(FAIL|✗)" | sed -n '1,10p' | awk '{print}')
    echo "SURVIVED"
  )
}

@test "AC-489-01: sourcing every shipped gate-4 copy leaves errexit off and survives the zero-match pipeline" {
  for f in githooks/gate-4.sh githooks/adapters/gate-4.sh githooks/gates/gate-4-principles.sh; do
    COPY_PATH="$REPO_ROOT/$f" run bash -c "$(declare -f probe_gate4_source); probe_gate4_source \"\$COPY_PATH\""
    [ "$status" -eq 0 ]
    [[ "$output" == *"ERREXIT-OFF"* ]]
    [[ "$output" == *"SURVIVED"* ]]
  done
}

@test "AC-489-03: the probe reproduces the leak against the old set +e/set -e pairing" {
  LEAK_FIXTURE="$(mktemp)"
  printf 'set +e\ntrue\nPRINCIPLES_EXIT=$?\nset -e\n' > "$LEAK_FIXTURE"
  COPY_PATH="$LEAK_FIXTURE" run bash -c "$(declare -f probe_gate4_source); probe_gate4_source \"\$COPY_PATH\""
  rm -f "$LEAK_FIXTURE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERREXIT-ON"* ]]
  [[ "$output" != *"SURVIVED"* ]]
}

@test "AC-489-02: FAIL_LINES extraction in every shipped pre-commit copy is errexit-safe and head-free" {
  for f in githooks/pre-commit src/npm-package/hooks/pre-commit; do
    grep -A1 'FAIL_LINES=\$(' "$REPO_ROOT/$f" | grep -q '|| true' || {
      echo "$f: FAIL_LINES assignment is not || true-terminated" >&2
      return 1
    }
    if grep -q 'FAIL_LINES=.*| head' "$REPO_ROOT/$f"; then
      echo "$f: FAIL_LINES pipeline still uses | head (v0.9.2 head→sed migration miss)" >&2
      return 1
    fi
  done
}
