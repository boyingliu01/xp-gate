#!/usr/bin/env bats

# Push-rhythm reminder in pre-commit.
#
# Gate MW binds walkthrough evidence to a COMMIT and expires it in one hour, and a
# review takes at most 40 KB of source per expert. Cost therefore GROWS with how long
# a branch stays local: measured 2026-11-26, an unpushed branch 300 commits deep
# needed ~27 reviews and could not be pushed at all.
#
# This is a REMINDER, and the assertions below are mostly about what it must NOT do:
#
#   - it must never change a commit's outcome (always exit 0);
#   - it must stay silent on main/master, where Gate MW is skipped by design;
#   - it must stay silent below the threshold, or it becomes noise nobody reads;
#   - it must say WHY (the first push reviews the whole branch), not just print a count.

setup() {
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR" || exit 1
  git init -q -b feature .
  # A throwaway repository: the machine's global hooks must not run here.
  git config core.hooksPath /dev/null
  git config user.email t@example.com
  git config user.name t
  git init -q --bare "$TEST_DIR/remote.git"
}

teardown() {
  cd /
  rm -rf "$TEST_DIR"
}

# commit_n <n> [tag] — create n commits; the tag keeps successive calls from
# reusing the same filenames (which silently produces no commit at all).
commit_n() {
  local n="$1" tag="${2:-a}" i f
  for i in $(seq 1 "$n"); do
    f="${tag}$i.txt"
    printf '%s\n' "$i" > "$f"
    git add "$f"
    git commit -qm "commit $tag$i" --no-verify
  done
}

# Apply the hook's function without running the whole gate chain.
run_note() {
  eval "$(sed -n '/^_xp_gate_push_rhythm_note()/,/^}/p' "$SOURCE_HOOK")"
  _xp_gate_push_rhythm_note
}

setup_file() {
  SOURCE_HOOK="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/pre-commit"
  export SOURCE_HOOK
}

@test "the reminder is defined in the hook" {
  grep -q '^_xp_gate_push_rhythm_note()' "$SOURCE_HOOK"
}

@test "it is invoked before the hook exits" {
  # Defined but never called is the failure shape this repository keeps finding.
  local calls
  calls="$(grep -c '^_xp_gate_push_rhythm_note$' "$SOURCE_HOOK")"
  [ "$calls" -eq 1 ]
}

@test "a branch with no upstream warns about the FIRST push" {
  commit_n 12
  run run_note
  [ "$status" -eq 0 ]
  [[ "$output" == *"NO upstream"* ]]
  [[ "$output" == *"WHOLE branch"* ]]
}

@test "the no-upstream count is the BRANCH's commits, not the whole history" {
  # `git rev-list --count HEAD` counted every commit ever and reported 2473 for a
  # branch with 284 (measured). The count must be from the merge-base.
  git remote add origin "$TEST_DIR/remote.git"
  commit_n 3 base
  git push -q -u origin feature
  git checkout -q -b second
  commit_n 12 more
  run run_note
  [ "$status" -eq 0 ]
  [[ "$output" == *"12 commit(s)"* ]]
  [[ "$output" != *"15 commit(s)"* ]]
}

@test "a branch under 10 commits with no upstream stays silent" {
  commit_n 3
  run run_note
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "main is skipped: Gate MW does not run on it" {
  git checkout -q -b main
  commit_n 12
  run run_note
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "a synced branch stays silent" {
  git remote add origin "$TEST_DIR/remote.git"
  commit_n 2
  git push -q -u origin feature
  run run_note
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "a few unpushed commits stay silent, more than the threshold warns" {
  git remote add origin "$TEST_DIR/remote.git"
  commit_n 1 a
  git push -q -u origin feature
  commit_n 2 b
  run run_note
  [ "$status" -eq 0 ]
  [ -z "$output" ]

  commit_n 5 c
  run run_note
  [ "$status" -eq 0 ]
  [[ "$output" == *"unpushed on feature"* ]]
  [[ "$output" == *"1 hour"* ]]
}
