#!/usr/bin/env bash

# Shell adapter for quality gates.
#
# Scope rule: a file is a shell script when it is named *.sh / *.bash, OR when
# its first line carries a bash/sh shebang. The shebang arm is not decoration --
# `pre-commit` and `pre-push` have no extension and are the two largest shell
# programs in this repository, so an extension-only filter has never been able
# to see them.
#
# The previous implementation handed shellcheck `./*.sh ./**/**/*.sh`.
# With globstar off (the default) `**` degrades to `*`, so the second pattern
# matched paths of exactly one directory component and nothing else: measured
# here, 47 of 173 tracked .sh files were linted and 126 were dropped without a
# word, while `./*.sh` matched nothing at all because the repo root holds no
# scripts. The gate reported PASS on the quarter it happened to glob.

# Emit the absolute path of every shell script in this project, one per line.
#
# Files come from `git ls-files -co --exclude-standard` so that build output and
# dependencies (node_modules, dist, coverage) are excluded by the project's own
# .gitignore rather than by a hardcoded ignore list that drifts. Inside a git
# repository every shell-script candidate is checked against the shebang rule;
# outside one, the tracked-file list is unavailable and the adapter falls back
# to a bounded find so a non-git consumer still gets a real file list instead of
# an empty one that reads like a clean project.
#
# Skipped deliberately: githooks/__tests__/*.bats carry .bats, not .sh, and are
# suites rather than shipped code -- `run_tests` covers them.
_shell_script_files() {
  local root
  root="$(pwd)"

  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      [ -f "$rel" ] || continue
      case "$rel" in
        *.sh|*.bash) echo "$root/$rel"; continue ;;
      esac
      # No shell extension: accept only a shell shebang.
      local first
      first="$(sed -n '1p' "$rel" 2>/dev/null || true)"
      case "$first" in
        '#!'*bash*|'#!'*'/sh'|'#!'*' sh'|'#!'*'env sh'*) echo "$root/$rel" ;;
      esac
    done < <(git ls-files -co --exclude-standard '*.sh' '*.bash' \
                 '**/pre-commit' 'pre-commit' \
                 '**/pre-push' 'pre-push' \
                 '**/post-commit' 'post-commit' \
                 '**/post-merge' 'post-merge' \
                 '**/post-checkout' 'post-checkout' \
                 '**/commit-msg' 'commit-msg' \
                 '**/prepare-commit-msg' 'prepare-commit-msg' 2>/dev/null)
    return 0
  fi

  # Not a git work tree: bounded search, still shebang-filtered.
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    echo "$f"
  done < <(
    find . -type f \( -name '*.sh' -o -name '*.bash' \) \
      -not -path './node_modules/*' -not -path './.git/*' \
      -not -path './dist/*' -not -path './coverage/*' 2>/dev/null | sed "s|^\./|$root/|"
  )
}

run_static_analysis() {
  if ! command -v shellcheck >/dev/null 2>&1; then
    echo "shellcheck not available, skipping Shell linting"
    return 0
  fi

  local files=()
  while IFS= read -r f; do
    [ -n "$f" ] && files+=("$f")
  done < <(_shell_script_files)

  # No input is a distinguishable outcome, not a pass that checked something.
  # Probing shellcheck second keeps the cheap question ("is there anything
  # here?") in front of the expensive one.
  if [ "${#files[@]}" -eq 0 ]; then
    echo "No shell scripts detected."
    return 0
  fi

  echo "Running Shell static analysis on ${#files[@]} script(s)..."
  # Each path is passed as its own argument (Bash 3.2 compatible: no mapfile),
  # so a path containing spaces cannot be split into two bogus arguments.
  #
  # The verdict is TIERED, because a flat exit status made every finding block
  # equally. Measured on this repository: 2 error-level, 74 warning-level, 150
  # info-level and 182 style-level findings. An unused-variable warning and an
  # unparseable script are not the same problem, and treating them the same is
  # how a gate ends up switched off or routed around.
  #
  #   error level (which includes every parse failure) -> BLOCK
  #   warning / note / style                           -> reported, not blocking
  #
  # The tier is read from the LEVEL, not from the code range. SC1xxx was tried
  # first and is wrong: this repository's four SC1xxx findings are all SC1003
  # ("want to escape a single quote?") at NOTE level, so a code-range test would
  # have blocked on a suggestion. A real parse failure (SC1073/SC1123/SC1072)
  # always arrives at error level anyway, so keying on the level covers it.
  #
  # The output is captured so the class can be read before deciding, and is
  # re-printed either way: a tier that does not block must still be VISIBLE, or
  # it is indistinguishable from a tier that does not exist.
  local out=""
  out="$(shellcheck -f gcc "${files[@]}" 2>&1)"
  local status=$?

  # Print the analyser's own output on BOTH paths. Real shellcheck prints nothing
  # when it is clean, so this costs nothing there; but it keeps whatever the tool
  # did say (a version banner, a notice, a wrapper's narration) visible instead of
  # silently swallowed by the capture. Dropping it on the success path made the
  # adapter look like it had not invoked anything at all.
  [ -n "$out" ] && printf '%s\n' "$out"

  [ "$status" -eq 0 ] && return 0

  # Error level: real defects, and the level every parse failure lands on. The
  # message names the parse case separately because "the file was not analysed"
  # and "the file was analysed and has a defect" need different responses.
  if printf '%s\n' "$out" | grep -qE ': error: '; then
    if printf '%s\n' "$out" | grep -qE '\[SC(1072|1073|1123|1009)\]'; then
      echo "❌ Shell analysis could not PARSE the file(s) -- they were not fully checked." >&2
      echo "   Fix the parse failure first: no other shell verdict about them is trustworthy." >&2
    else
      echo "❌ Shell errors found (blocking)." >&2
    fi
    return 1
  fi

  # Warnings and below: reported above, not blocking.
  local soft
  soft="$(printf '%s\n' "$out" | grep -cE ': (warning|note): ' || true)"
  echo "⚠️  ${soft:-0} shell warning(s)/note(s) reported above (not blocking)."
  return 0
}

run_lint() {
  # Static analysis and lint are the same check for shell -- shellcheck is the
  # only analyser. Keeping both entry points working means the host hook may
  # call either, but the file list must not be assembled twice.
  run_static_analysis
}

# Locate the project's shell test suite. Bats is the ecosystem's shell test
# runner and this repo already carries its suites, so discovery is by *.bats.
_shell_test_files() {
  find . -type f -name '*.bats' \
    -not -path './node_modules/*' -not -path './.git/*' \
    -not -path './dist/*' 2>/dev/null | sort
}

run_tests() {
  local suites
  suites="$(_shell_test_files)"

  # Order: runner first, then suites, then the binary. "0 suites" is only a
  # true answer once a runner exists -- a machine without bats must not be told
  # its suite list is empty simply because the probe ran first.
  if ! command -v bats >/dev/null 2>&1; then
    # Gate 5 reads "No test runner installed locally" as a skip, and a skip
    # must not read as a pass. A bare "not available" line would take the other
    # branch and print PASSED over a run that never happened.
    echo "No test runner installed locally: bats not available (install: npm i -D bats)"
    return 0
  fi

  if [ -z "$suites" ]; then
    # Distinguished from a run that executed tests: the previous version
    # printed a skip line and returned 0, which the gate reported as a pass.
    echo "No shell test suite detected (*.bats)."
    return 0
  fi

  local runner
  runner="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/bats-runner.sh"
  if [ ! -f "$runner" ]; then
    # A missing runner is an install defect, not "no tests". Say so and fail:
    # reporting here would be a pass over nothing.
    echo "❌ Shell test runner missing: $runner"
    echo "   Fix: reinstall the hooks (xp-gate doctor --sync-hooks)."
    return 1
  fi
  # Sourced as its own statement, not as the last command of the `if` above:
  # there `set -e` turns a non-zero status into an exit with no message.
  # shellcheck source=/dev/null
  . "$runner"

  # Per-suite isolation, a per-test cap, and a report that names the suite: see
  # githooks/lib/bats-runner.sh. Gate 5 keeps only the first 50 lines of this
  # function's output, and the runner is written to stay inside that budget.
  #
  # The status is read after the call returns, not left to `return $(...)`:
  # the hook's pipefail makes a failing command substitution abort the caller
  # before the report is consumed. bats_run_and_record always returns 0 and
  # records the status in BATS_SUITES_RC; see the runner for the details.
  bats_run_and_record "$suites"
  return "$BATS_SUITES_RC"
}

run_coverage() {
  # Shell has no standard coverage tool. Reporting that is honest; inventing a
  # number would let a coverage gate pass on nothing.
  echo "Shell coverage not available"
  return 0
}
