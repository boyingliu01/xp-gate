#!/usr/bin/env bats
# @test REQ-490
# @intent Gate 10 passed the newline-joined staged-file list to semgrep as ONE
#         quoted argument, so staging >=2 supported files handed semgrep an
#         illegal path like $'a.ts\nb.ts' and semgrep died with "Invalid
#         scanning root" -- silently killing the whole commit. Single-file
#         commits worked by accident (no newline in the string), which is why
#         this looked intermittent (#475's field reports).
# @covers AC-490-01, AC-490-02, AC-490-03, AC-490-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-10.sh"
  TEST_DIR="$(mktemp -d)"

  mkdir -p "$TEST_DIR/bin"
  cd "$TEST_DIR" || return 1
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  # Without this, the machine-wide core.hooksPath runs the real gate suite on every
  # fixture commit.
  git config core.hooksPath .git/hooks
  echo "seed" > README.md
  git add README.md
  git commit --no-verify -q -m "seed"
  echo "export const value = 1;" > app.ts
  echo "export const other = 2;" > lib.ts
  git add app.ts lib.ts
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Sources gate-10.sh with a stub semgrep that records its exact argv (one line
# per argument) into $SEMGREP_STUB_ARGV and exits 0 with clean JSON.
run_gate_with_argv_stub() {
  local argv_path="$1"
  (
    set -u
    cd "$TEST_DIR" || exit 1
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    GATE_10_STATUS=""
    HOME="$TEST_DIR/no-home"
    PATH="$TEST_DIR/bin:$PATH"
    export SEMGREP_STUB_ARGV="$argv_path"
    # shellcheck disable=SC1091
    source "$GATE"
    printf 'STATUS=%s' "$GATE_10_STATUS"
  )
}

write_argv_semgrep_stub() {
  cat > "$TEST_DIR/bin/semgrep" << STUB
#!/bin/sh
printf '%s\n' "\$@" > "\$SEMGREP_STUB_ARGV"
echo '{"results":[],"errors":[],"paths":{"scanned":["app.ts"]}}'
exit 0
STUB
  chmod +x "$TEST_DIR/bin/semgrep"
}

@test "AC-490-01: 2 staged .ts files reach semgrep as separate arguments, none joined" {
  write_argv_semgrep_stub
  run run_gate_with_argv_stub "$TEST_DIR/argv.txt"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=PASS"* ]]
  # #543 changed the target FORM (dirs + --include basenames instead of file
  # paths) but not the defect this pins: every staged file must contribute its
  # own argv entries — no newline-joined mega-argument anywhere.
  ! grep -q $'\n' "$TEST_DIR/argv.txt"
  # Basenames ride in --include=<basename> arguments (one per staged file).
  grep -qxF -- '--include=app.ts' "$TEST_DIR/argv.txt"
  grep -qxF -- '--include=lib.ts' "$TEST_DIR/argv.txt"
}

@test "AC-490-02: a multi-file commit PASSes and reports the scanned file count" {
  write_argv_semgrep_stub
  run run_gate_with_argv_stub "$TEST_DIR/argv.txt"
  # The gate counts the staged files it handed to semgrep, not semgrep's argv
  # length (#543 turned one file into two arguments: --include + value).
  [[ "$output" == *"files scanned: 2"* ]]
  [[ "$output" != *"Invalid scanning root"* ]]
}

@test "AC-490-03 anti-vacuity: every shipped gate-10 copy expands the array, not the quoted list" {
  for f in githooks/gate-10.sh src/npm-package/gate-10.sh src/npm-package/hooks/gate-10.sh; do
    grep -q -- '"\${SEMGREP_ARGS\[@\]}"' "$REPO_ROOT/$f" || {
      echo "$f: does not expand SEMGREP_ARGS array" >&2
      return 1
    }
    if grep -q -- 'disable-version-check "\$SEMGREP_FILES"' "$REPO_ROOT/$f"; then
      echo "$f: still passes the quoted newline-joined SEMGREP_FILES as one argument" >&2
      return 1
    fi
  done
}

# Round 1 review (technical MC-01): an array element that begins with '-' is a
# valid repo path (`git add -- ./-o.ts`) but semgrep reads it as an option, so a
# single hostile or misnamed file could rewrite the scan it was supposed to run.
#
# #543/#558 changed the SHAPE the security property is delivered in, not the
# property itself: semgrep now gets a DIRECTORY target plus one
# `--include=<basename>` per staged file. A root-level staged file has no
# directory of its own, so #558 targets "." and the leading-dash name rides
# purely as an `--include=` VALUE, where no argument parser can mistake it for
# an option. This test previously asserted './-o.ts' appeared as a bare argv
# entry, which #543/#558 made impossible to satisfy (#560) — it was red while
# the gate was safe. It now pins the shipped form, still fail-closed: any
# refactor that lets a filename reach argv as its own entry turns this red.
@test "AC-490-04: a staged path starting with '-' reaches semgrep as a path, not an option" {
  write_argv_semgrep_stub
  echo "export const negative = 1;" > ./-o.ts
  git add -- ./-o.ts

  run run_gate_with_argv_stub "$TEST_DIR/argv.txt"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=PASS"* ]]
  # The leading-dash basename is delivered as an --include= VALUE ...
  grep -qxF -- '--include=-o.ts' "$TEST_DIR/argv.txt"
  # ... and a root-level file contributes the repo root as its target (#558).
  grep -qxF -- '.' "$TEST_DIR/argv.txt"
  # The security property: the hostile name is NEVER a standalone argv entry,
  # in either spelling. This is the line that fails if the gate regresses to
  # passing file paths directly.
  ! grep -qx -- '-o.ts' "$TEST_DIR/argv.txt"
  ! grep -qx -- './-o.ts' "$TEST_DIR/argv.txt"
}

# git prints both of these names unquoted, so an unquoted array expansion would
# split "./with space.ts" into two arguments while the leading-dash name would
# still read as an option.
@test "AC-490-04: a space and a leading '-' in the same name arrive untouched" {
  write_argv_semgrep_stub
  echo "export const spaced = 1;" > "./with space.ts"
  echo "export const both = 1;" > "./- dash.ts"
  git add -- "./with space.ts" "./- dash.ts"

  run run_gate_with_argv_stub "$TEST_DIR/argv.txt"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=PASS"* ]]
  # #543 form: basenames ride in --include values, dirs as targets. The defect
  # this pins is argv splitting: a space must never split an argument, and a
  # leading '-' must never read as an option (dir targets carry ./).
  grep -qxF -- '--include=with space.ts' "$TEST_DIR/argv.txt"
  grep -qxF -- '--include=- dash.ts' "$TEST_DIR/argv.txt"
  ! grep -qxF './with' "$TEST_DIR/argv.txt"
  ! grep -qxF 'space.ts' "$TEST_DIR/argv.txt"
}
