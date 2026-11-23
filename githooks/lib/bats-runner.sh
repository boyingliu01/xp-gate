#!/bin/bash
# Bats runner for the Shell adapter's test arm: one suite at a time, every test
# bounded, every failure named.
#
# Sourced by githooks/adapters/shell.sh; kept in its own file so the judgement
# below is unit-testable without executing the hook (top of
# githooks/__tests__/adapter-shell-tests.test.bats).
#
# WHY A RUNNER AND NOT THREE LINES IN THE ADAPTER
#   "Run the tests" is one sentence, but this repository's suite has four
#   outcomes per file that must not be conflated:
#     passed                    -> next suite
#     a test failed             -> stop, block, say what failed
#     bats could not run it     -> stop, say why (install or runner fault)
#     ran but produced no verdict -> stop, say why (the runner itself broke)
#   The last two were once spelled "warn and continue", which turned a broken
#   suite into a slower run of every remaining suite and hid the cause behind a
#   summary line. Stopping at the first suite that is not green is also all a
#   pre-commit needs to know: one red suite must not be reported as every later
#   suite failing too.
#
# WHY THE LOG IS A FILE
#   Gate 5 captures this runner's output inside a command substitution and
#   prints only its first 50 lines. A shell variable also cannot carry NUL bytes
#   and grows without bound on a noisy suite. So each suite writes to a temp
#   file: the verdict is read from the file, the failure is reported from the
#   file (only the lines that explain it, so the verdict stays inside those 50),
#   and the full log is left in a directory the host owns and names.
#
# ASCII only.

# XP_GATE_BATS_TEST_TIMEOUT      per-test cap in seconds (default 300)
# XP_GATE_BATS_LOG_LINES         lines of a passing suite to echo (default 15)
# XP_GATE_BATS_MISSING_LOG_LINES lines echoed when a suite names no log (default 25)

# _bats_positive_int <value> <default>
#
# A knob that is unset, empty, non-numeric or <= 0 must fall back, never reach
# `tail -0` (prints nothing) or `tail -abc` (syntax error) or bats (which reads a
# bad BATS_TEST_TIMEOUT as a crash).
_bats_positive_int() {
  case "$1" in
    ''|*[!0-9]*) printf '%s\n' "$2"; return 0 ;;
  esac
  if [ "$1" -le 0 ]; then
    printf '%s\n' "$2"
  else
    printf '%s\n' "$1"
  fi
}

# _bats_log_path <suite> <dir-or-empty>
_bats_log_path() {
  local name
  if [ -z "$2" ]; then
    return 1
  fi
  name="$(printf '%s' "$1" | sed -e 's|^\./||' -e 's|[^A-Za-z0-9._-]|_|g')"
  printf '%s\n' "$2/$name.tap"
}

# _bats_suite_phase <log>
#
# Classify WHY a suite is not green, from its log. Order matters: `not ok` is a
# verdict about a test and wins over the rest.
#
#   failed   a test reported `not ok`, or bats declared the plan skipped
#   timeout  the per-test cap fired
#   crashed  the runner exited with output but no verdict (panic, abort, kill)
#   missing  the log carries nothing, i.e. bats never started a test
_bats_suite_phase() {
  if grep -qE '^not ok |^1\.\.0 # SKIP' "$1" 2>/dev/null; then
    printf '%s\n' failed
  elif grep -qE 'timeout after [0-9]+s' "$1" 2>/dev/null; then
    printf '%s\n' timeout
  elif grep -q '[^[:space:]]' "$1" 2>/dev/null; then
    # Whitespace alone is no output: `[ -s ]` counted a lone newline as a crash
    # and then reported a tail of blank lines as the explanation.
    printf '%s\n' crashed
  else
    printf '%s\n' missing
  fi
}

# _bats_print_capped <max-lines> <line>...
#
# Print at most <max-lines> lines, and say so when the list was longer: a report
# that silently ends mid-list reads like the whole story.
_bats_print_capped() {
  local max="$1" total i=0 line
  shift
  total=$#
  for line in "$@"; do
    i=$((i + 1))
    [ "$i" -le "$max" ] || continue
    printf '   %s\n' "$line"
  done
  if [ "$total" -gt "$max" ]; then
    printf '   ... (%s more line(s) not shown)\n' "$((total - max))"
  fi
}

# _bats_skip_all_note <suite> <rc>
#
# Name a fully skipped plan and why it blocks. Reached from two places because
# bats makes both reachable: it exits 0 when every test in the file was skipped
# (so the green arm is the usual one) and non-zero when a skip plan arrives with
# a failure. A suite that verifies nothing must not count as green -- otherwise
# deleting every test body behind one `skip` is a one-line bypass of the gate --
# but the message must not send the reader hunting for a failure that is absent.
_bats_skip_all_note() {
  echo "   Every test in this suite was skipped (bats exit $2)."
  echo "   A commit gate cannot count a suite that verifies nothing as green:"
  echo "   remove the skip, or delete the suite if it should not run here."
}

# _bats_report_failure <log> <phase>
#
# Print the lines that explain a failure. A failing suite is never dumped whole:
# Gate 5 keeps the first 50 lines of this runner's output, so the explanation
# has to arrive BEFORE the cut.
_bats_report_failure() {
  local log="$1" phase="$2"
  local -a picked=()
  local line
  case "$phase" in
    failed|timeout)
      while IFS= read -r line; do
        picked+=("$line")
      done < <(grep -E '^not ok |^# |^1\.\.|timeout after [0-9]+s' "$log" 2>/dev/null)
      ;;
    crashed)
      while IFS= read -r line; do
        picked+=("$line")
      done < <(grep -E 'not ok|Error|error:|panic|Bail out' "$log" 2>/dev/null)
      # No recognisable error line: show the tail, where a crash usually says
      # what it was doing last, deduplicated so a spinner cannot fill the slot.
      if [ "${#picked[@]}" -eq 0 ]; then
        while IFS= read -r line; do
          picked+=("$line")
        done < <(awk '!seen[$0]++' "$log" 2>/dev/null | tail -20)
      fi
      ;;
  esac
  _bats_print_capped 20 "${picked[@]}"
}

# _bats_wait <pid> <seconds>
#
# Wait for one child, but not forever: `kill -0` alone is unbounded, so a runner
# that is alive yet wedged holds the commit open with no output to explain it.
# Returns the child's own status, or 124 when it had to be killed.
_bats_wait() {
  local pid="$1" limit="$2" i=0
  while kill -0 "$pid" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -gt "$limit" ]; then
      # Group kill first: bats starts each test in its own process group, so a
      # wedged test can outlive a kill of the runner pid.
      kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 124
    fi
    sleep 1
  done
  wait "$pid"
}

# _bats_run <suite> <cap> <log> <wall-limit>
#
# Start bats for one suite with its output in <log> and wait, bounded. Puts the
# exit status in BATS_RUN_RC because the caller needs the log to decide what the
# status meant, and a function returning a status would deliver that status only
# after its own report.
_bats_run() {
  # `|| BATS_RUN_RC=$?` rather than a bare call: under `set -e` a bare failing
  # command exits the whole adapter before the log is classified.
  run_without_git_context env BATS_TEST_TIMEOUT="$2" bats --abort --tap "$1" > "$3" 2>&1 &
  BATS_RUN_RC=0
  _bats_wait $! "$4" || BATS_RUN_RC=$?
  return 0
}

# run_bats_suite <suite> <cap> <log-dir>
#
# Run one suite. Returns 0 only when the suite passed; every other outcome
# prints why the run stops there.
run_bats_suite() {
  local suite="$1" cap="$2" log_dir="$3"
  local log rc phase tail_lines
  log="$(_bats_log_path "$suite" "$log_dir")"
  if [ -n "$log" ]; then
    : > "$log"
    _bats_run "$suite" "$cap" "$log" \
      "$(_bats_positive_int "${XP_GATE_BATS_SUITE_WALL_LIMIT_S:-}" 3600)"
    rc="$BATS_RUN_RC"
  else
    # No directory to write a log into (running outside the hook): keep the
    # output in a variable. The NUL caveat is documented above; the report then
    # names no log instead of pointing at a path that does not exist.
    #
    # `|| rc=0` is load-bearing: this branch runs in the caller's shell under
    # `set -e`, where a bare failing assignment exits before anything is said.
    local out rc=0
    out="$(run_without_git_context env BATS_TEST_TIMEOUT="$cap" bats --abort --tap "$suite" 2>&1)" || rc=$?
    if [ "$rc" -eq 0 ] && [[ "$out" == *"1..0 # SKIP"* ]]; then
      printf '%s\n' "$out"
      echo "❌ ${suite} FAILED: bats exit 0 with the whole plan skipped"
      _bats_skip_all_note "$suite" "$rc"
      return 1
    fi
    if [ "$rc" -eq 0 ]; then
      printf '%s\n' "$out" | tail -"$(_bats_positive_int "${XP_GATE_BATS_LOG_LINES:-}" 15)"
      return 0
    fi
    printf '%s\n' "$out"
    # Captured in a variable here, so the text above is what a shell variable can
    # hold: NUL bytes are already lost and a very noisy suite may be cut. Say
    # both, so the reader does not treat this copy as the complete log.
    echo "   (full TAP log not persisted: XP_GATE_BATS_LOG_DIR is unset;"
    echo "    this copy went through a shell variable, so NUL bytes are lost and a very noisy suite may be cut)"
    return 1
  fi
  if [ "$rc" -eq 0 ]; then
    # bats exits 0 for a plan it declared skipped outright. Checked before the
    # green return, because that is the only path a fully skipped suite takes.
    tail_lines="$(_bats_positive_int "${XP_GATE_BATS_LOG_LINES:-}" 15)"
    tail -"$tail_lines" "$log"
    if grep -qE '^1\.\.0 # SKIP' "$log" 2>/dev/null; then
      echo "❌ ${suite} FAILED: bats exit 0 with the whole plan skipped"
      _bats_skip_all_note "$suite" "$rc"
      echo "   Log: $log"
      return 1
    fi
    return 0
  fi
  if [ "$rc" -eq 124 ]; then
    echo "❌ ${suite} was killed after the wall-clock limit (${XP_GATE_BATS_SUITE_WALL_LIMIT_S:-3600}s)"
    echo "   Raise XP_GATE_BATS_SUITE_WALL_LIMIT_S only if the suite is genuinely slower."
    echo "   Log: $log"
    return 1
  fi
  phase="$(_bats_suite_phase "$log")"
  _bats_report_failure "$log" "$phase"
  case "$phase" in
    failed)
      echo "❌ ${suite} FAILED (bats exit ${rc}, per-test cap ${cap}s)"
      # A skip plan can also arrive with a non-zero exit; the green arm already
      # named the common case.
      if ! grep -qE '^not ok ' "$log" 2>/dev/null \
        && grep -qE '^1\.\.0 # SKIP' "$log" 2>/dev/null; then
        _bats_skip_all_note "$suite" "$rc"
      fi
      ;;
    timeout)
      echo "❌ ${suite} FAILED: a test exceeded ${cap}s and was killed (bats exit ${rc})"
      echo "   A wedged test is a failing test, not a slow one. Raise XP_GATE_BATS_TEST_TIMEOUT"
      echo "   only if this test is genuinely slower than that."
      ;;
    crashed)
      echo "❌ ${suite} DID NOT RUN: bats exited ${rc} with no test verdict"
      echo "   No test was judged, so this is a runner fault, not a test failure."
      ;;
    *)
      echo "❌ ${suite} DID NOT RUN: bats exited ${rc} without starting a test"
      echo "   Check that the path exists and bats is installed."
      ;;
  esac
  echo "   Log: $log"
  return 1
}

# run_bats_suites <suite-list>
#
# Run every suite named in <suite-list> (one path per line) until the first one
# that is not green. Returns non-zero for that suite, naming it: the caller must
# not have to guess which of hundreds failed.
run_bats_suites() {
  local suites="$1" cap log_dir count n f
  cap="$(_bats_positive_int "${XP_GATE_BATS_TEST_TIMEOUT:-}" 300)"
  log_dir="${XP_GATE_BATS_LOG_DIR:-}"
  count=0
  n=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    count=$((count + 1))
  done <<EOF
$suites
EOF
  if [ -n "$log_dir" ]; then
    # Logs go straight into the gate-owned directory rather than a child made by
    # mktemp: the gate makes one directory per commit, and a child would leave
    # that parent empty on every run, green ones included. A directory that is
    # gone or readonly falls back to the no-directory branch, which says the log
    # was not persisted instead of naming a path nobody can open.
    if [ ! -d "$log_dir" ] || [ ! -w "$log_dir" ]; then
      log_dir=""
    fi
  fi
  echo "Running Shell tests (${count} .bats suite(s), per-test cap ${cap}s)..."
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    n=$((n + 1))
    # Guarded directly, not through `$?`: as the last command of an `&&` list the
    # status is swallowed and a failure reads as green.
    if ! run_bats_suite "$f" "$cap" "$log_dir"; then
      echo ""
      echo "   ${n} of ${count} suite(s) reached; stopped at '${f}'."
      # "Reached" does not say whether the rest ran. Say it: a reader who takes
      # the remaining suites as passed is reading a green report that never
      # happened.
      if [ "$n" -lt "$count" ]; then
        echo "   $((count - n)) suite(s) after it were NOT run."
      fi
      # Last line on purpose: Gate 5 re-prints a short trailer taken from the
      # report, and this is the summary a reader needs when the log is long.
      echo "❌ Shell tests FAILED at suite ${n}/${count}"
      return 1
    fi
  done <<EOF
$suites
EOF
  echo "✅ Shell tests passed (${count} suite(s))"
  return 0
}

# Report the outcome to the caller.
#
# The hook (pre-commit, then the gate entries) runs under `set -o pipefail`, and
# gate-5 captures the adapter's output with a command substitution, so a bare
# `run_bats_suites` there would abort the caller on failure before the report
# was read. This is the exit point: it always returns 0 so a report cannot
# become a silent exit, and it puts the exit status in BATS_SUITES_RC.
bats_run_and_record() {
  # Exported because the caller reads it: shellcheck cannot see across the
  # source and would otherwise report the assignment as dead.
  export BATS_SUITES_RC=0
  run_bats_suites "$@" || BATS_SUITES_RC=$?
  return 0
}
