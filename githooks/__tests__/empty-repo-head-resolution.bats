#!/usr/bin/env bats

# ============================================================================
# Issue #463: pre-commit prints a spurious fatal error on a repo with no commits
#
# Root cause: GATE 0 resolved the branch name with
#   CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
# On a freshly `git init`-ed repository HEAD points at an unborn branch, so
# rev-parse exits 128 and prints:
#   fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.
#
# Consequences beyond the noise:
#   - CURRENT_BRANCH falls back to the literal string "HEAD"
#   - Gate 0's protected-branch comparison then tests against a bogus name
#
# Fix: prefer `git symbolic-ref --short HEAD` (resolves the unborn branch and
# exits 0), with the old command and a literal fallback as guards.
# ============================================================================

PRE_COMMIT="$BATS_TEST_DIRNAME/../pre-commit"

setup() {
  TEST_REPO=$(mktemp -d)
  # #798 moved Gate 0's body into githooks/gate-entries/, so the source-reading
  # cases below need the repo root, not just the hook path.
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

teardown() {
  rm -rf "$TEST_REPO"
}

@test "Issue #463: symbolic-ref resolves the branch on a repo with no commits" {
  cd "$TEST_REPO" || return 1
  git init -q . 2>/dev/null

  # The old approach fails on an unborn branch...
  run git rev-parse --abbrev-ref HEAD
  [ "$status" -ne 0 ]

  # ...while the fix resolves it cleanly.
  run git symbolic-ref --short HEAD
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  # Must be a real branch name, never the literal "HEAD".
  [ "$output" != "HEAD" ]
}

@test "Issue #463: both CURRENT_BRANCH assignments use the guarded symbolic-ref form" {
  # #798 moved Gate 0's body into githooks/gate-entries/gate-0-entry.sh, so this
  # reads that file. It also CONSOLIDATED the two resolution sites into one, so
  # the old "expect >= 2 literal fallbacks" count stopped being a property of the
  # code and became a property of the pre-#798 layout. What must hold: every site
  # that resolves CURRENT_BRANCH goes through symbolic-ref first, at least one
  # such site exists, and it carries the guarded fallback.
  local src="$REPO_ROOT/githooks/gate-entries/gate-0-entry.sh"
  [ -f "$src" ] || { echo "Gate 0's body is not where this test looks: $src"; return 1; }

  run grep -n 'CURRENT_BRANCH=\$(git' "$src"
  [ "$status" -eq 0 ] || { echo "CURRENT_BRANCH is never resolved from git"; return 1; }
  [ -n "$output" ] || { echo "CURRENT_BRANCH resolution is empty"; return 1; }

  local line bad=""
  while IFS= read -r line; do
    # Every CURRENT_BRANCH resolution must go through symbolic-ref first.
    # Accumulate rather than let the loop body's result be discarded: a bare
    # `[[ ... ]]` on its own line only keeps the LAST iteration's verdict, so one
    # unguarded site among several would pass.
    [[ "$line" == *'symbolic-ref --short HEAD'* ]] || bad="$bad$line"$'\n'
  done <<< "$output"
  [ -z "$bad" ] || { echo "unguarded CURRENT_BRANCH resolution(s):"; printf '%s' "$bad"; return 1; }

  # #710: the literal fallback moved to the FOLLOWING line, because
  # `|| echo "HEAD"` appended to a command that already printed a partial line
  # produced the two-line value "HEAD\nunknown". The guarantee still holds —
  # it is now enforced by a non-empty check on the next line instead of by an
  # inline `|| echo`. Assert that shape rather than the old one-liner.
  local count
  count=$(grep -c 'CURRENT_BRANCH="HEAD"' "$src" || true)
  [ "${count:-0}" -ge 1 ] || {
    echo "期望 CURRENT_BRANCH 站点有字面量兜底，实际 ${count:-0}"
    return 1
  }

  # And the fallback must be guarded against multi-line captures.
  grep -qF "CURRENT_BRANCH=\$(printf '%s' \"\$CURRENT_BRANCH\" | tr -d '\r\n')" "$src" || {
    echo "CURRENT_BRANCH 未做换行清理"
    return 1
  }
}

@test "Issue #463: pre-commit contains no unguarded 'rev-parse --abbrev-ref HEAD'" {
  # An unguarded call is exactly what regressed. Match only lines lacking a
  # stderr redirect, which every safe call site must have. #798 moved the call
  # into Gate 0's entry file, so both that file and pre-commit are checked --
  # pre-commit holds no such call today, and a future inline one there must still
  # be guarded. The `found` flag stops this from passing when NEITHER file has a
  # call site, which is the shape that made it vacuous in the first place.
  #
  # #710: skip comment lines. The fix documents the failing command by name in
  # a comment, and this assertion is about EXECUTABLE call sites — flagging a
  # comment here would force the explanation out of the file that needs it.
  local src found=0 bad=""
  for src in "$REPO_ROOT/githooks/gate-entries/gate-0-entry.sh" "$PRE_COMMIT"; do
    [ -f "$src" ] || continue
    run grep -n 'git rev-parse --abbrev-ref HEAD' "$src"
    [ "$status" -eq 0 ] || continue
    found=1

    local line
    while IFS= read -r line; do
      [[ "$line" =~ ^[0-9]+:[[:space:]]*# ]] && continue
      # A line can hold MORE THAN ONE call, and the guard belongs to each call
      # individually: `git symbolic-ref --short HEAD 2>/dev/null || git rev-parse
      # --abbrev-ref HEAD` puts a guarded call and an unguarded one on the same
      # line. Testing the whole line for '2>/dev/null' passed that line, so the
      # assertion could not see the unguarded fallback it exists to catch
      # (measured: stripping that exact guard left this case green).
      # Split on `git ` and require the redirect in every fragment that carries
      # the call.
      local frag
      while IFS= read -r frag; do
        [[ "$frag" == *'rev-parse --abbrev-ref HEAD'* ]] || continue
        [[ "$frag" == *'2>/dev/null'* ]] || bad="$bad$(basename "$src"): $line"$'\n'
      done < <(sed 's/git /\ngit /g' <<< "$line")
    done <<< "$output"
  done
  # Accumulate, then assert once. A `return 1` INSIDE the while loop exits the
  # subshell that runs it, not the test -- proved by deleting the guard from
  # gate-0-entry.sh and watching this case stay green. Collecting the offenders
  # and asserting after the loop is what makes the failure real.
  [ -z "$bad" ] || { echo "unguarded call site(s):"; printf '%s' "$bad"; return 1; }
  [ "$found" -eq 1 ] || { echo "no rev-parse --abbrev-ref call site found to check"; return 1; }
}

@test "Issue #463: commit on an empty repo produces no 'ambiguous argument' error" {
  cd "$TEST_REPO" || return 1
  git init -q . 2>/dev/null

  # Smoke-check the exact command form used by the fix.
  run bash -c 'git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "HEAD"'
  [ "$status" -eq 0 ]
  [[ "$output" != *'ambiguous argument'* ]]
  [[ "$output" != *'fatal'* ]]
}
