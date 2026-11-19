#!/usr/bin/env bash

# Incremental Python type-checking helpers for the pre-commit Python branch
# (#534). This is the FAST staged-only pass: pre-commit runs it on just the
# .py/.pyi files that changed, so a large repo doesn't pay full-inference CPU
# on every commit. It complements the FULL mypy pass (githooks/adapters/
# python.sh run_static_analysis, reachable via the adapter CLI / CI), which is
# where cross-module blind spots get caught.
#
# Sourced by githooks/pre-commit (the python) case. Requires CHANGED_FILES
# (space/newline separated, repo-root relative) to be in scope, matching the
# rest of the inline branch.
#
# Shellcheck: functions are the public API used by pre-commit; SC1091 sources
# are intentionally not resolved here (adapter-common not needed).

# Extract the staged .py/.pyi files from CHANGED_FILES, one per line.
# Excludes vendored/ignored trees (.venv, venv, node_modules) that a hook
# should never type-check. Handles whitespace in paths (echo + grep would
# split them).
python_staged_py_files() {
  local f
  while IFS= read -r f || [ -n "$f" ]; do
    case "$f" in
      .venv/*|venv/*|node_modules/*) continue ;;
      *.py|*.pyi) printf '%s\n' "$f" ;;
    esac
  done <<< "$CHANGED_FILES"
}

# Run incremental mypy over the given staged files, returning mypy's REAL exit
# code (never a pipe stage's). Adds --follow-imports=silent so that a change to
# A.py that references an unchanged B.py does not surface B's own pre-existing
# diagnostics — only caller-level signature errors are reported. Callers must
# pass the file list as arguments (already filtered to .py/.pyi).
#
# Scope discipline (same .xp-gate-mypy-scope contract as python.sh): a staged
# file OUTSIDE the declared mypy scope is skipped with a note rather than type-
# checked, keeping the incremental pass consistent with the full pass. Files in
# scope default to "under src/ or scripts/" when no scope file exists.
python_typecheck_incremental() {
  [ "$#" -gt 0 ] || return 0

  # Resolve the declared scope (identical precedence to run_static_analysis):
  #   .xp-gate-mypy-scope (one target per line) wins; else src/ and scripts/
  #   are the implicit default. Any staged .py outside this surface is skipped.
  local -a SCOPE_DIRS=()
  local _declared=0 line target
  if [ -f .xp-gate-mypy-scope ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%%#*}"
      line="${line#"${line%%[![:space:]]*}"}"
      line="${line%"${line##*[![:space:]]}"}"
      [ -z "$line" ] && continue
      _declared=1
      # Normalize trailing slashes (`src/` -> `src`) so the `$target/*` prefix
      # match below never sees a doubled slash (`src//a.py` would never match).
      line="${line%/}"
      SCOPE_DIRS+=("$line")
    done < .xp-gate-mypy-scope
  else
    [ -d src ] && SCOPE_DIRS+=(src)
    [ -d scripts ] && SCOPE_DIRS+=(scripts)
  fi

  # If a scope file is declared but yields nothing, every staged .py is out of
  # scope -> SKIP (exit 0), mirroring the full pass.
  #
  # AN EMPTY SCOPE IS NOT A PASS. Measured 2026-11-19 with the language matrix: a
  # Python project with no src/, no scripts/ and no .xp-gate-mypy-scope, editing a
  # file that does not type-check:
  #
  #     a.py : def f() -> int: return "not an int"
  #     mypy : error: Incompatible return value type (got "str", expected "int")
  #     gate : "PASSED - mypy type checking."
  #     commit ALLOWED
  #
  # The loop below runs only when SCOPE_DIRS is non-empty, so with no declared type
  # surface TYPECHECK_FILES stayed empty, mypy was never invoked, and the final
  # `return 0` was read by Gate 1 as a clean type check. Nothing said "I did not
  # look", which is what made it invisible.
  #
  # Gate 1 prints "PASSED - mypy type checking" on exit 0 and cannot see the
  # difference, so the distinction has to be stated here, loudly, in the log.
  local _in_scope=false
  local -a TYPECHECK_FILES=()
  local f
  if [ "${#SCOPE_DIRS[@]}" -eq 0 ]; then
    # No declared surface: check the staged files themselves.
    #
    # Skipping was the old behaviour and is indefensible here -- these are the
    # exact files the author is asking to commit. Narrowing the scope exists to
    # keep a LARGE repo's pre-commit fast and free of unrelated noise (tests/,
    # vendored code); it was never meant to mean "a small project gets no type
    # checking at all", which is what it did.
    echo "  ⚠ mypy incremental: no type surface declared (no .xp-gate-mypy-scope, no src/ or scripts/)" >&2
    echo "    checking the staged .py files directly; declare .xp-gate-mypy-scope to narrow this" >&2
    TYPECHECK_FILES=("$@")
  else
    for f in "$@"; do
      _in_scope=false
      for target in "${SCOPE_DIRS[@]}"; do
        case "$f" in
          "$target"/*) _in_scope=true ;;
        esac
        [ "$_in_scope" = true ] && break
      done
      if [ "$_in_scope" = true ]; then
        TYPECHECK_FILES+=("$f")
      else
        echo "  ℹ️  mypy incremental: '$f' is outside declared scope — skipped"
      fi
    done
  fi

  [ "${#TYPECHECK_FILES[@]}" -gt 0 ] || return 0

  # Capture mypy's exit code directly. A pipeline like
  #   mypy ... | head -20 | tail -10; rc=$?
  # loses mypy's real status (the pipe stage's rc is used instead), which made
  # the gate pass silently on real type errors. Redirect to a temp file, take
  # mypy's own exit code, then print a truncated view.
  local tmp
  tmp="$(mktemp)"
  echo "Running mypy type checking (incremental)..."
  mypy --follow-imports=silent --ignore-missing-imports "${TYPECHECK_FILES[@]}" > "$tmp" 2>&1
  local _mypy_rc=$?
  head -20 "$tmp"
  tail -10 "$tmp"
  rm -f "$tmp"
  return "$_mypy_rc"
}
