#!/usr/bin/env bats
#
# @test REQ-MIRROR-ARTIFACTS A leftover artefact must not block every push
# @intent Since P1-E the mirror trees are generated and gitignored. A stale copy
#         left behind by an earlier layout -- exactly what `git clean -n` lists --
#         used to trip the file-set assertion, so EVERY push failed with a
#         60-entry list that named nothing the operator could act on.
#
#         Measured 2026-11-26: dropping `hooks/lib/stray-artifact.ts` into the
#         tree made `scripts/check-hook-mirror.sh` exit 1 with
#         "hook mirror file set drifted". The comment beside the enumeration
#         claimed ignored artefacts were filtered "by their directory, not by
#         name", but the code excluded only `__pycache__/*`.
#
#         Two candidate fixes were rejected by measurement:
#
#           * filter by `git check-ignore` -- wrong, because `hooks/lib/` is
#             gitignored BY DESIGN, so the predicate would drop 24 legitimate
#             mirrors and fail in the opposite direction.
#           * filter by artefact SUFFIX (*.bak, *.orig, ...) -- wrong for the
#             actual failure mode. A stale generated `.ts` from an earlier layout
#             is neither an editor backup nor ignored by name; a suffix list only
#             relocates the bug. The first draft of THIS test passed the suffix
#             version by only using suffix artefacts, which is exactly the
#             tautology the Delphi review caught.
#
#         The rule that ships: disk content in the mirror tree that no mirror
#         pair generates is stale, and the message names it.
#
# @covers AC-MIRROR-ARTIFACTS-01 AC-MIRROR-ARTIFACTS-02
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$REPO_ROOT/scripts/check-hook-mirror.sh"
  FIXTURE="$(mktemp -d)"

  local src
  src="$(cat "$SCRIPT")"
  HOOK_FILES="$(printf '%s\n' "$src" | sed -n 's/^HOOK_MIRROR_FILES="\([^"]*\)".*/\1/p' | head -1 | tr '\n' ' ')"
  ROOT_FILES="$(printf '%s\n' "$src" | sed -n 's/^ROOT_MIRROR_FILES="\([^"]*\)".*/\1/p' | head -1 | tr '\n' ' ')"
  [ -n "$HOOK_FILES" ]
}

teardown() {
  rm -rf "$FIXTURE"
}

# A fixture whose mirrors are byte-identical, so a run reaches the set assertion
# rather than failing on a missing prerequisite.
build_clean_fixture() {
  mkdir -p "$FIXTURE/githooks/lib" "$FIXTURE/githooks/adapters/typescript"
  mkdir -p "$FIXTURE/src/npm-package/hooks/lib" "$FIXTURE/src/npm-package/adapters/typescript"
  local rel
  for rel in $HOOK_FILES; do
    mkdir -p "$FIXTURE/githooks/$(dirname "$rel")"
    mkdir -p "$FIXTURE/src/npm-package/hooks/$(dirname "$rel")"
    printf '%s\n' "$rel" > "$FIXTURE/githooks/$rel"
    printf '%s\n' "$rel" > "$FIXTURE/src/npm-package/hooks/$rel"
  done
  printf 'adapter\n' > "$FIXTURE/githooks/adapters/typescript/adapter.sh"
  printf 'adapter\n' > "$FIXTURE/src/npm-package/adapters/typescript/adapter.sh"
  for rel in $ROOT_FILES; do
    mkdir -p "$FIXTURE/githooks/$(dirname "$rel")"
    mkdir -p "$FIXTURE/src/npm-package/$(dirname "$rel")"
    printf '%s\n' "$rel" > "$FIXTURE/githooks/$rel"
    printf '%s\n' "$rel" > "$FIXTURE/src/npm-package/$rel"
  done
  local pair
  for pair in principles mutation mock-policy; do
    mkdir -p "$FIXTURE/src/$pair" "$FIXTURE/src/npm-package/$pair"
    printf 'export const x = 1;\n' > "$FIXTURE/src/$pair/sample.ts"
    printf 'export const x = 1;\n' > "$FIXTURE/src/npm-package/$pair/sample.ts"
  done
}

@test "AC-MIRROR-ARTIFACTS-01: a clean tree passes" {
  build_clean_fixture
  run bash -c "cd '$FIXTURE' && bash '$SCRIPT'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"byte- and mode-identical"* ]]
}

@test "AC-MIRROR-ARTIFACTS-01: a stale generated .ts is named, not lost in a 60-name list" {
  build_clean_fixture
  # The reproducer from the issue: a stale generated .ts left by an earlier
  # layout. A suffix list (*.bak, *.orig) would miss exactly this case, which is
  # why the fix keys on "not in HOOK_MIRROR_FILES" instead.
  printf 'stale\n' > "$FIXTURE/src/npm-package/hooks/lib/stray-artifact.ts"

  run bash -c "cd '$FIXTURE' && bash '$SCRIPT'"

  # The gate still blocks -- a file nobody can account for must not be ignored
  # silently. What changes is that the message says which file it is.
  [ "$status" -ne 0 ]
  [[ "$output" == *"stray-artifact.ts"* ]]
  [[ "$output" == *"no mirror pair generates"* ]]
}

@test "AC-MIRROR-ARTIFACTS-01: cache directories alone do not trip the gate" {
  build_clean_fixture
  mkdir -p "$FIXTURE/src/npm-package/hooks/lib/__pycache__"
  printf 'cache\n' > "$FIXTURE/src/npm-package/hooks/lib/__pycache__/x.pyc"

  run bash -c "cd '$FIXTURE' && bash '$SCRIPT'"
  [ "$status" -eq 0 ]
}

@test "AC-MIRROR-ARTIFACTS-02: the operator is told WHICH file is stale" {
  # The original message printed all 60 expected names and never said which one
  # was found instead. That is the part that made the failure unactionable.
  build_clean_fixture
  printf 'stale\n' > "$FIXTURE/src/npm-package/hooks/lib/stray-artifact.ts"

  run bash -c "cd '$FIXTURE' && bash '$SCRIPT'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"stray-artifact.ts"* ]]
  [[ "$output" == *"no mirror pair generates"* ]]
}

@test "AC-MIRROR-ARTIFACTS-02: a listed mirror missing from disk is still caught" {
  # The set check must not become "anything goes": if the generator skips a
  # listed file, that has to block, and the message must name it.
  build_clean_fixture
  local target
  # shellcheck disable=SC2086  # word splitting IS the intent: HOOK_FILES is a space-separated list
  target="$(printf '%s\n' $HOOK_FILES | head -1)"
  rm -f "$FIXTURE/src/npm-package/hooks/$target"

  run bash -c "cd '$FIXTURE' && bash '$SCRIPT'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"missing"* ]]
  [[ "$output" == *"$target"* ]]
}

@test "AC-MIRROR-ARTIFACTS-02: genuine content drift is still caught" {
  build_clean_fixture
  local target
  # shellcheck disable=SC2086  # word splitting IS the intent: HOOK_FILES is a space-separated list
  target="$(printf '%s\n' $HOOK_FILES | head -1)"
  printf 'drifted\n' > "$FIXTURE/src/npm-package/hooks/$target"

  run bash -c "cd '$FIXTURE' && bash '$SCRIPT'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"differs from canonical"* ]]
}
