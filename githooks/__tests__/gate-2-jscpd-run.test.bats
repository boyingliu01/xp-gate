#!/usr/bin/env bats
# @test REQ-477
# @intent Gate 2 handed jscpd a --config path it never verified, and read any non-zero
#         exit as "duplicates found". A missing config produced a scary os error 2 and
#         then a fabricated duplicate report; a genuine duplicate report that exits 0
#         was reported as a clean pass. Neither message described what actually
#         happened. These tests pin the config probe and the three-way outcome split.
# @covers AC-477-01, AC-477-02, AC-477-03, AC-477-04, AC-477-05, AC-477-06, AC-477-07, AC-477-08, AC-477-09, AC-477-10

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/jscpd-run.sh"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  TEST_DIR="$(mktemp -d)"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# jscpd's own words, taken from the consumer-repo run in #477 and from the CLI here.
CONFIG_ERROR_OUTPUT='Using config from jscpd.conf.json
config file jscpd.conf.json: 系统找不到指定的文件 (os error 2)'

CLONES_OUTPUT='Clone found (typescript)
 - a.ts [1:1 - 30:2]
Found 1 clones.'

CLEAN_OUTPUT='Glob matched 2 files
Found 0 clones.'

@test "AC-477-01: the config is found at the repo root when the hook stands in a subdirectory" {
  mkdir -p "$TEST_DIR/web/src"
  printf '{"ignore":[]}' > "$TEST_DIR/jscpd.conf.json"
  cd "$TEST_DIR/web"
  run bash -c "PROJECT_ROOT='$TEST_DIR'; source '$LIB'; resolve_jscpd_config"
  [ "$status" -eq 0 ]
  [ "$output" = "$TEST_DIR/jscpd.conf.json" ]
}

@test "AC-477-02: no config anywhere resolves to an empty answer, so no --config is passed" {
  mkdir -p "$TEST_DIR/web"
  cd "$TEST_DIR/web"
  run bash -c "PROJECT_ROOT='$TEST_DIR'; source '$LIB'; resolve_jscpd_config"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "AC-477-03: a config error is an error, never a duplicate finding" {
  run bash -c "source '$LIB'; classify_jscpd_run 1 '$CONFIG_ERROR_OUTPUT'"
  [ "$output" = "error" ]
}

@test "AC-477-04: a clone report is a duplicate finding even when jscpd exits 0" {
  # The default CLI exits 0 after reporting clones, so the old non-zero test called
  # this a clean pass.
  run bash -c "source '$LIB'; classify_jscpd_run 0 '$CLONES_OUTPUT'"
  [ "$output" = "duplicates" ]
}

@test "AC-477-05: 'Found 0 clones' is clean whatever the exit code" {
  run bash -c "source '$LIB'; classify_jscpd_run 0 '$CLEAN_OUTPUT'"
  [ "$output" = "clean" ]
}

@test "AC-477-06: a non-zero exit with no report is an error" {
  run bash -c "source '$LIB'; classify_jscpd_run 2 'TypeError: something broke'"
  [ "$output" = "error" ]
}

@test "AC-477-07: exit 0 with an unrecognised report stays clean (no invented blocking)" {
  # Reclassifying this as an error would turn unknown jscpd formats into SKIP noise and
  # is not what #477 asked for; the issue is about honesty, not about new blocks.
  run bash -c "source '$LIB'; classify_jscpd_run 0 'some future reporter output'"
  [ "$output" = "clean" ]
}

@test "AC-477-08 anti-vacuity: the Gate 2 typescript branch uses both helpers" {
  grep -q 'resolve_jscpd_config' "$HOOK"
  grep -q 'classify_jscpd_run' "$HOOK"
  grep -q 'source "${AUDIT_SCRIPT_DIR}/lib/jscpd-run.sh"' "$HOOK"
}

@test "AC-477-08 anti-vacuity: no unconditional --config jscpd.conf.json remains anywhere" {
  ! grep -rn -- '--config jscpd.conf.json' \
    "$REPO_ROOT/githooks/pre-commit" "$REPO_ROOT/githooks"/adapters/*.sh "$REPO_ROOT/githooks"/gates/*.sh
}

@test "AC-477-08 anti-vacuity: a run error is branched on inside Gate 2" {
  # Wiring, not wording: the 'error' outcome must be tested inside the hook itself.
  local n
  n=$(awk '/Gate 2: Duplicate code detection/,/record_gate_audit "gate-2"/' "$HOOK" \
    | grep -c 'JSCPD_OUTCOME" = "error"')
  [ "$n" -ge 1 ]
}

# Runs the wired typescript branch itself, lifted out of pre-commit, against a stub
# named jscpd. Grepping proves the call sites exist; this proves they do the right
# thing once a real run finishes.
run_wired_branch() {
  local fake_output="$1" fake_exit="$2" with_config="$3"
  (
    set -u
    source "$LIB"
    mkdir -p "$TEST_DIR/web"
    if [ "$with_config" = "yes" ]; then
      printf '{"ignore":[]}' > "$TEST_DIR/jscpd.conf.json"
    fi
    PROJECT_ROOT="$TEST_DIR"
    cd "$TEST_DIR/web" || exit 1
    CHANGED_FILES="web/a.ts"
    GATE_2_STATUS="PASS"
    FAKE_OUT="$fake_output"
    FAKE_EXIT="$fake_exit"
    jscpd() {
      printf '%s\n' "$FAKE_OUT"
      return "$FAKE_EXIT"
    }
    # The branch's closing `fi` sits past the extracted range, so it is re-added.
    branch=$(awk '/JSCPD_CONFIG=\$\(resolve_jscpd_config\)/,/PASSED - jscpd duplicate code check completed/' "$HOOK")
    eval "$branch
    fi"
    printf 'STATUS=%s' "$GATE_2_STATUS"
  )
}

@test "AC-477-09: the wired branch reports a run error honestly, never as duplicates" {
  run run_wired_branch "$CONFIG_ERROR_OUTPUT" 1 "no"
  [[ "$output" == *"SKIPPED - Duplicate code (jscpd run error)"* ]]
  [[ "$output" == *"STATUS=SKIP"* ]]
  [[ "$output" != *"found duplicated code"* ]]
  [[ "$output" != *"✅ PASSED"* ]]
  # The missing config is now named as missing instead of being handed to jscpd.
  [[ "$output" == *"No jscpd.conf.json found"* ]]
}

@test "AC-477-09: the config error itself reaches the user" {
  run run_wired_branch "$CONFIG_ERROR_OUTPUT" 1 "no"
  [[ "$output" == *"os error 2"* ]]
}

@test "AC-477-10: the wired branch reports clones that exit 0 as duplicates, not a pass" {
  run run_wired_branch "$CLONES_OUTPUT" 0 "yes"
  [[ "$output" == *"found duplicated code"* ]]
  [[ "$output" != *"✅ PASSED"* ]]
  [[ "$output" == *"STATUS=PASS"* ]]
}

@test "AC-477-10: a clean report still passes and passes the resolved config through" {
  run run_wired_branch "$CLEAN_OUTPUT" 0 "yes"
  [[ "$output" == *"✅ PASSED - jscpd duplicate code check completed."* ]]
  [[ "$output" == *"STATUS=PASS"* ]]
  [[ "$output" != *"No jscpd.conf.json found"* ]]
}
