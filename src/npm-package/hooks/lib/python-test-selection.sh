#!/bin/bash
# Python smart test selection (#399) — the Python counterpart of the TypeScript
# selector (#286). Kept in its own file so the strategy truth table and the
# related-test lookup are unit-testable without executing the hook
# (githooks/__tests__/issue-399-python-test-selection.test.bats).
#
# Why: Python pre-commit ran the FULL suite on every commit (2-5min on a
# 1000+-test project). TypeScript already counts changed test files, resolves
# related tests from changed sources, and only falls back to the full suite
# for large batches. Python had no equivalent.
#
# Three tiers, matching the TS implementation:
#   1. changed-tests — only test files changed: run exactly those.
#   2. related      — source files changed, no test files: run the tests that
#                     the path convention maps to them.
#   3. full         — >20 test files changed, dependency files changed, or no
#                     related tests found: run everything with the real
#                     coverage threshold.
# Tier 1/2 run WITHOUT the global coverage threshold (subset coverage is
# meaningless globally); the caller marks the run partial so Stage 2 warns
# instead of blocking.

# Max changed test files before falling back to the full suite. Same value as
# the TypeScript branch (#286) so the two languages behave alike.
PY_MAX_CHANGED_TESTS=20

# Dependency manifests: a change here can break ANY test, so the selector
# always escalates to the full suite regardless of how few tests changed.
PY_DEPENDENCY_PATTERNS='(^|/)(pyproject\.toml|setup\.py|setup\.cfg|requirements[^/]*\.txt)$'

# Decide the strategy from three counts. Pure function — no filesystem access,
# so the truth table is exhaustive and cheap to test.
#
#   $1 test_count  changed test files
#   $2 src_count   changed non-test Python source files
#   $3 deps_changed 1 when a dependency manifest changed, else 0
#
# Echoes exactly one of: full | changed-tests | related | skip
select_python_test_strategy() {
  local test_count="${1:-0}"
  local src_count="${2:-0}"
  local deps_changed="${3:-0}"

  # Dependency changes can break anything -> always the full suite.
  if [ "$deps_changed" = "1" ]; then
    printf '%s' "full"
    return 0
  fi

  # Large batch: the per-file selection loses its point, and the TS branch
  # uses the same cutoff.
  if [ "$test_count" -gt "$PY_MAX_CHANGED_TESTS" ] 2>/dev/null; then
    printf '%s' "full"
    return 0
  fi

  if [ "$test_count" -gt 0 ] 2>/dev/null; then
    printf '%s' "changed-tests"
    return 0
  fi

  if [ "$src_count" -gt 0 ] 2>/dev/null; then
    printf '%s' "related"
    return 0
  fi

  printf '%s' "skip"
}

# Resolve the test files related to one source file, following the conventions
# pytest projects actually use. Echoes one path per line, deduplicated, in
# discovery order. Echoes nothing when no candidate exists — the caller then
# falls back to the full suite (tier 3).
#
#   $1 source path, e.g. src/foo/bar.py
python_related_tests() {
  local src_file="$1"
  [ -n "$src_file" ] || return 0

  local base="${src_file%.*}"
  local filename="${base##*/}"
  local dir
  dir="$(dirname "$src_file")"

  local candidates=""
  # Directory-relative candidates first (most specific), then flat tests/,
  # then the collocated forms. Covers both pytest naming conventions
  # (test_<name>.py and <name>_test.py).
  candidates="$candidates
${dir}/test_${filename}.py
${dir}/${filename}_test.py
${dir}/__tests__/test_${filename}.py
${dir}/__tests__/${filename}_test.py"
  # tests/<dir-surviving-subpath>/… : src/foo/bar.py -> tests/foo/test_bar.py
  local subpath="${dir#src/}"
  [ "$subpath" = "$dir" ] && subpath="$dir"
  candidates="$candidates
tests/${subpath}/test_${filename}.py
tests/${subpath}/${filename}_test.py"
  candidates="$candidates
tests/test_${filename}.py
tests/${filename}_test.py"

  local seen=""
  local candidate
  # IFS-safe iteration over newline-separated candidates.
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    [ -f "$candidate" ] || continue
    # Dedupe: several patterns can resolve to the same file (e.g. a source at
    # repo root has dir='.' so the relative and flat forms coincide).
    case "$seen" in
      *"|$candidate|"*) continue ;;
    esac
    seen="$seen|$candidate|"
    printf '%s\n' "$candidate"
  done <<EOF
$candidates
EOF
}

# True (0) when any of the given paths is a Python dependency manifest.
python_dependency_changed() {
  local path
  for path in "$@"; do
    [ -n "$path" ] || continue
    if echo "$path" | grep -qE "$PY_DEPENDENCY_PATTERNS"; then
      return 0
    fi
  done
  return 1
}
