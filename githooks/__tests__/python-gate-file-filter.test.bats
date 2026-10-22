#!/usr/bin/env bats

# ============================================================================
# Issue #412: Python ruff/mypy gates must filter staged files to *.py
#
# Before the fix, Gate 1 (Python) handed the raw staged-file list to ruff/mypy:
#   ruff check "$CHANGED_FILES"                          (quoted -> one arg;
#                                                        non-.py parsed as Py)
#   mypy ... $(echo "$CHANGED_FILES" | grep "\.py$" || echo ".")
#                                                        (no .py staged -> scans
#                                                         the WHOLE project)
# Either one BLOCKS a docs/YAML/config-only commit with false errors.
#
# The fix filters to *.py and skips the tool when none are staged, matching the
# format/debug/shell gates.
#
# #599: the mypy half of this file went red because it asserted on the hook's
# SPELLING:
#     grep -F '*.py|*.pyi) MYPY_ARGS+=("$staged_file")'
#     grep -F 'mypy --ignore-missing-imports "${MYPY_ARGS[@]}"'
# The incremental type-check was later extracted into
# githooks/lib/python-incremental-typecheck.sh (#534), which filters with a
# `case` statement and calls mypy with --follow-imports=silent. The BEHAVIOUR
# the issue is about — never hand a non-.py path to ruff/mypy — is unchanged and
# still correct; only the text moved.
#
# These cases now exercise the real filter functions with a real CHANGED_FILES
# list and assert on what the tool would RECEIVE. Source checks are kept only
# where the thing asserted really is a wiring fact (that pre-commit calls the
# helper at all, and that the buggy forms are gone).
# ============================================================================

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GITHOOKS_HOOK="$REPO_ROOT/githooks/pre-commit"
  NPM_HOOK="$REPO_ROOT/src/npm-package/hooks/pre-commit"
  LIB="$REPO_ROOT/githooks/lib/python-incremental-typecheck.sh"
}

# The buggy invocations must stay gone from both shipped copies.
check_buggy_forms_absent() {
  local hook="$1"
  [ -f "$hook" ] || { echo "missing: $hook"; return 1; }

  # ruff must never receive the raw list.
  if grep -qF 'ruff check "$CHANGED_FILES"' "$hook"; then
    echo "$hook still passes the raw staged list to ruff"
    return 1
  fi
  # mypy must never fall back to scanning the whole project.
  if grep -qF 'mypy --ignore-missing-imports $(echo' "$hook"; then
    echo "$hook still has the whole-project mypy fallback"
    return 1
  fi
}

@test "Issue #412: neither hook passes the raw staged list to ruff or mypy" {
  check_buggy_forms_absent "$GITHOOKS_HOOK"
  check_buggy_forms_absent "$NPM_HOOK"
}

@test "Issue #412: the ruff gate still filters to *.py before invoking ruff" {
  # Filtering fact, asserted on the shipped hook: a *.py|*.pyi case guard feeds
  # an array that ruff consumes (rather than "$CHANGED_FILES").
  grep -qF '*.py|*.pyi) RUFF_ARGS+=("$staged_file")' "$GITHOOKS_HOOK" || {
    echo "githooks/pre-commit no longer builds RUFF_ARGS from a *.py|*.pyi guard"
    return 1
  }
  grep -qF 'ruff check "${RUFF_ARGS[@]}"' "$GITHOOKS_HOOK" || {
    echo "githooks/pre-commit no longer invokes ruff with RUFF_ARGS"
    return 1
  }
  # The npm mirror must carry the same wiring (it is a byte mirror).
  cmp -s "$GITHOOKS_HOOK" "$NPM_HOOK" || {
    echo "npm-package/hooks/pre-commit has drifted from githooks/pre-commit"
    return 1
  }
}

@test "Issue #412: pre-commit feeds mypy through the incremental helper" {
  grep -q 'python_typecheck_incremental' "$GITHOOKS_HOOK" || {
    echo "pre-commit no longer calls python_typecheck_incremental"
    return 1
  }
  [ -f "$LIB" ] || {
    echo "the helper library is missing: $LIB"
    return 1
  }
}

@test "Issue #412: the mypy filter yields ONLY .py/.pyi files" {
  # Behaviour, not spelling: feed a mixed staged list to the real filter.
  run bash -c "
    set -eu
    source '$LIB'
    CHANGED_FILES='README.md
src/app.py
docs/guide.md
package.json
src/types.pyi
web/index.ts
.venv/lib/python3.12/site-packages/vendored.py
src/config.yaml'
    python_staged_py_files
  "
  [ "$status" -eq 0 ] || {
    echo "python_staged_py_files failed: $output"
    return 1
  }
  echo "filtered:"; printf '%s\n' "$output"

  # Exactly the two source files, and nothing else.
  [ "$(printf '%s\n' "$output" | grep -c .)" -eq 2 ] || {
    echo "expected exactly 2 python files, got:"
    printf '%s\n' "$output"
    return 1
  }
  [[ "$output" == *"src/app.py"* ]]
  [[ "$output" == *"src/types.pyi"* ]]

  # Every line must end in .py or .pyi — a markdown/JSON/YAML path reaching
  # mypy is precisely the #412 bug.
  local bad
  bad="$(printf '%s\n' "$output" | grep -vE '\.(py|pyi)$' || true)"
  [ -z "$bad" ] || {
    echo "non-python paths leaked into the mypy argument list:"
    echo "$bad"
    return 1
  }
}

@test "Issue #412: mypy is skipped entirely when no .py is staged" {
  # The whole-project fallback is what made a docs-only commit scan everything.
  run bash -c "
    set -eu
    source '$LIB'
    CHANGED_FILES='README.md
docs/guide.md
package.json'
    out=\$(python_staged_py_files)
    [ -z \"\$out\" ] && echo EMPTY || printf '%s\n' \"\$out\"
  "
  echo "output: [$output]"
  [ "$output" = "EMPTY" ] || {
    echo "a docs-only change produced mypy arguments instead of skipping"
    return 1
  }
}
