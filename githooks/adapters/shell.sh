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

# Resolve the bats binary the same way typescript.sh resolves its tools.
#
# The previous implementation asked `command -v bats` and nothing else. bats is a
# devDependency, so a real install puts it at node_modules/.bin/bats -- which is
# NOT on PATH when a git hook runs (git does not source the shell profile, and
# npm only adds node_modules/.bin for `npm run` scripts). The probe therefore
# failed on every real commit, the adapter printed "bats not available", returned
# 0, and Gate 5 recorded a PASS for a suite that was installed and never ran.
#
# Measured on this repo: `command -v bats` was empty while
# node_modules/.bin/bats existed and was executable. The existing
# adapter-shell-tests.test.bats could not see this because every case prepends a
# fake bats directory to PATH -- it tested a condition that does not hold in
# production.
#
# Search order mirrors typescript.sh `_local_bin`: the project's own
# node_modules/.bin first, then a bounded walk up through ancestors because npm
# hoists to the workspace root. Then, and only then, PATH -- so a globally
# installed bats still works and explicitly breaking the local one cannot silently
# resolve to something else. Nothing outside the checkout is required.
_shell_resolve_bats() {
  local dir depth=0
  if [ -x "node_modules/.bin/bats" ]; then
    printf '%s\n' "node_modules/.bin/bats"
    return 0
  fi
  dir="$(pwd)"
  while [ "$depth" -lt 6 ]; do
    depth=$((depth + 1))
    [ "$dir" = "/" ] && break
    dir="$(dirname "$dir")"
    if [ -x "$dir/node_modules/.bin/bats" ]; then
      printf '%s\n' "$dir/node_modules/.bin/bats"
      return 0
    fi
  done
  if command -v bats >/dev/null 2>&1; then
    command -v bats
    return 0
  fi
  return 1
}

run_tests() {
  local suites
  suites="$(_shell_test_files)"

  if [ -z "$suites" ]; then
    # Distinguished from a run that executed tests: the previous version
    # printed a skip line and returned 0, which the gate reported as a pass.
    echo "No shell test suite detected (*.bats)."
    return 0
  fi

  local bats_bin
  if ! bats_bin="$(_shell_resolve_bats)"; then
    echo "bats not available, skipping shell test suite (install: npm i -D bats)"
    # Machine-readable skip, read by Gate 5's `_gate5_test_run_skipped`. Returning
    # 0 here is right -- nothing was expected to run and blocking would punish a
    # project for its environment -- but the gate cannot tell "returned 0 because
    # the suite passed" from "returned 0 because nothing ran" without being told.
    # Measured 2026-11-19: a failing .bats suite on a machine with bats installed
    # but not on the hook's PATH produced "PASSED - Unit tests passed."
    echo "XP_GATE_TESTS_SKIPPED"
    return 0
  fi

  local count
  count="$(printf '%s\n' "$suites" | wc -l | tr -d ' ')"
  echo "Running Shell tests (${count} .bats suite(s))..."

  # Report where bats came from: a locally resolved binary is the common case and
  # making it visible is what turns "the gate ran the suite" into something a
  # reader can verify rather than assume.
  case "$bats_bin" in
    /*) ;;
    *) echo "  using ${bats_bin}" ;;
  esac

  # shellcheck disable=SC2086  # word-splitting is the point: one arg per suite
  "$bats_bin" $suites
  return $?
}

run_coverage() {
  # Shell has no standard coverage tool. Reporting that is honest; inventing a
  # number would let a coverage gate pass on nothing.
  echo "Shell coverage not available"
  return 0
}

# Declare that this language's test suite is executed elsewhere (CI), so the
# commit-time gate must not run it.
#
# This is a capability DECLARATION in the #794 sense, not a language-name check
# in the gate: the adapter is the component that knows its own toolchain, and a
# list of names can only ever cover the languages someone remembered.
#
# Why it is needed at all: `run_tests` has no selection. `_shell_test_files`
# discovers every *.bats in the repo -- 284 here, measured -- and bats runs all of
# them. That was invisible because the old `command -v bats` probe failed on every
# real hook run and returned 0 before reaching the run; once the probe was fixed
# (see `_shell_resolve_bats`), a commit touching only shell.sh sat with no output
# for 100s+ and had to be killed, while the same hook on an empty index finished
# in well under 100s.
#
# The suites do still run: CI's `bats-contracts` job, sharded across runners.
# quality-gates.yml is explicit about not wanting a second copy in the local hook
# ("do not re-add a silent copy here"), because running them serially measured
# 18m47s of a 22m24s job. So the gate reports the delegation rather than silently
# dropping the check -- "not checked here" must stay distinguishable from
# "checked and clean", and the reader is told where it IS checked.
#
# Direct callers are unaffected: this only tells the gate whether to call
# `run_tests`; it does not disable the function.
tests_delegated_to_ci() {
  return 0
}

# Where the delegation goes, so the gate can name it instead of saying "skipped".
tests_delegated_to_ci_target() {
  echo "CI bats-contracts job (scripts/run-bats-ci.cjs)"
}
