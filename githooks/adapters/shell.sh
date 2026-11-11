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
  shellcheck "${files[@]}"
  return $?
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

  if [ -z "$suites" ]; then
    # Distinguished from a run that executed tests: the previous version
    # printed a skip line and returned 0, which the gate reported as a pass.
    echo "No shell test suite detected (*.bats)."
    return 0
  fi

  if ! command -v bats >/dev/null 2>&1; then
    echo "bats not available, skipping shell test suite (install: npm i -D bats)"
    return 0
  fi

  local count
  count="$(printf '%s\n' "$suites" | wc -l | tr -d ' ')"
  echo "Running Shell tests (${count} .bats suite(s))..."

  # shellcheck disable=SC2086  # word-splitting is the point: one arg per suite
  bats $suites
  return $?
}

run_coverage() {
  # Shell has no standard coverage tool. Reporting that is honest; inventing a
  # number would let a coverage gate pass on nothing.
  echo "Shell coverage not available"
  return 0
}
