#!/usr/bin/env bats
#
# @test REQ-SHELL-SEVERITY The shell arm blocks on danger and reports the rest
# @intent `run_static_analysis` ends with a bare `shellcheck "${files[@]}"` and
#         returns its exit status, so EVERY finding blocks equally. Measured on
#         this repository: 2 error-level, 74 warning-level, 150 info-level and
#         182 style-level findings. Treating an unused-variable warning the same
#         as an unparseable script is why the shell arm is either switched off or
#         worked around -- a gate that fires on everything teaches people to
#         ignore it.
#
#         The tiering this pins:
#
#           SC1xxx parse/structural  -> BLOCK. The file cannot be analysed; any
#                                       "clean" verdict about it is false.
#           error level              -> BLOCK. These are real defects.
#           warning level            -> NOT a hard block on its own; reported.
#           info / style             -> reported, never block.
#
#         The dangerous mistake here is the OPPOSITE of the usual one: making the
#         gate quieter by accident. So the tests below pin BOTH directions --
#         a real defect still blocks, and a cosmetic finding still does not.
#
# @covers AC-SHELL-SEVERITY-01
# @covers AC-SHELL-SEVERITY-02
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/shell.sh"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/bin" "$WORK/proj"

  # A shellcheck stand-in whose verdict the test controls, so the adapter's
  # classification is tested rather than shellcheck's opinion. It reads
  # FAKE_MODE and emits a realistic gcc-format line plus the matching status.
  #
  # Arguments are parsed the way the real tool parses them: the adapter passes
  # `-f gcc <files>`, so a stub that used `$1` as the filename reported `-f:1:1`
  # and made the parse-failure test fail for a reason unrelated to the code.
  cat > "$WORK/bin/shellcheck" <<'STUB'
#!/usr/bin/env bash
target=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -f) shift 2 ;;
    -*) shift ;;
    *) target="$1"; shift ;;
  esac
done
[ -n "$target" ] || target="<no-file>"
case "${FAKE_MODE:-clean}" in
  parse)   echo "$target:1:1: error: Couldn't parse this then clause. [SC1073]" ; exit 1 ;;
  error)   echo "$target:2:1: error: 'local' is only valid in functions. [SC2168]" ; exit 1 ;;
  warning) echo "$target:3:1: warning: X appears unused. [SC2034]" ; exit 1 ;;
  info)    echo "$target:4:1: note: Double quote to prevent globbing. [SC2086]" ; exit 1 ;;
  clean)   exit 0 ;;
esac
STUB
  chmod +x "$WORK/bin/shellcheck"

  printf '#!/usr/bin/env bash\necho hi\n' > "$WORK/proj/a.sh"
}

teardown() {
  [ -n "${WORK:-}" ] && [ -d "$WORK" ] && rm -rf "$WORK"
}

# Run the adapter's static-analysis entry point against the fixture with the
# stubbed analyser in FAKE_MODE. Written once here so each test states only the
# verdict it expects, and the harness cannot drift between tests.
run_in_mode() {
  env FAKE_MODE="$1" PATH="$WORK/bin:$PATH" bash -c '
    cd "'"$WORK"'/proj"
    # shellcheck disable=SC1090
    source "'"$ADAPTER"'"
    run_static_analysis'
}

@test "AC-SHELL-SEVERITY-01: a parse failure blocks" {
  run run_in_mode parse
  [ "$status" -ne 0 ]
}

@test "AC-SHELL-SEVERITY-01: an error-level finding blocks" {
  run run_in_mode error
  [ "$status" -ne 0 ]
}

@test "AC-SHELL-SEVERITY-01: a warning-level finding does not block but is reported" {
  run run_in_mode warning
  [ "$status" -eq 0 ]
  # Silence would be worse than noise: the finding must still be visible.
  [[ "$output" == *"SC2034"* ]] || {
    echo "the warning was swallowed instead of reported: $output" >&2
    false
  }
}

@test "AC-SHELL-SEVERITY-02: info and style findings never block" {
  run run_in_mode info
  [ "$status" -eq 0 ]
}

@test "AC-SHELL-SEVERITY-02: a clean file passes quietly" {
  run run_in_mode clean
  [ "$status" -eq 0 ]
}

@test "AC-SHELL-SEVERITY-02: a NOTE-level SC1xxx finding does not block" {
  # Regression pin for a real mistake made while implementing this: the first
  # version blocked on any `SC1xxx` code. That range contains SC1003 ("want to
  # escape a single quote?") at NOTE level, and this repository has four of them
  # -- so the gate would have blocked on a suggestion while claiming to catch
  # parse failures.
  #
  # The tier comes from the LEVEL. A genuine parse failure (SC1073/SC1123/
  # SC1072) always arrives at error level, so keying on the level still catches
  # it; keying on the code range does not, and adds false blocks.
  local stub="$WORK/bin/shellcheck"
  cat > "$stub" <<'STUB'
#!/usr/bin/env bash
echo "$1:1:1: note: Want to escape a single quote? [SC1003]"
exit 1
STUB
  chmod +x "$stub"

  run run_in_mode note
  [ "$status" -eq 0 ]
}

@test "AC-SHELL-SEVERITY-01: a parse failure is reported as a parse failure, not as a style issue" {
  # The two responses differ: "fix the syntax" vs "fix the defect". The message
  # must say which, or the operator debugs the wrong thing.
  run run_in_mode parse
  [ "$status" -ne 0 ]
  [[ "$output" == *"PARSE"* ]] || {
    echo "a parse failure must be labelled as one; got: $output" >&2
    false
  }
}