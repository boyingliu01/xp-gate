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
#         The fix must NOT go the other way. Filtering by `git check-ignore`
#         would be wrong: the entire `hooks/lib/` subtree is gitignored by
#         design, so that predicate would drop 24 legitimate mirrors and fail in
#         the opposite direction. What is excluded is artefact NAMES; a file the
#         gate has no business comparing and no artefact name still trips the
#         set check, which is the behaviour these tests pin.
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

@test "AC-MIRROR-ARTIFACTS-01: a leftover artefact does not block the push" {
  build_clean_fixture
  # An editor backup, a patch reject and a Python cache: all three are things a
  # generator or an editor leaves behind, none of them is a mirror.
  printf 'stale\n' > "$FIXTURE/src/npm-package/hooks/lib/typecheck.sh.bak"
  printf 'stale\n' > "$FIXTURE/src/npm-package/hooks/lib/patch.rej"
  printf 'stale\n' > "$FIXTURE/src/npm-package/hooks/lib/note.orig"
  mkdir -p "$FIXTURE/src/npm-package/hooks/lib/__pycache__"
  printf 'cache\n' > "$FIXTURE/src/npm-package/hooks/lib/__pycache__/x.pyc"

  run bash -c "cd '$FIXTURE' && bash '$SCRIPT'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"byte- and mode-identical"* ]]
}

@test "AC-MIRROR-ARTIFACTS-02: an unexplained file is still reported" {
  # The set assertion is not decoration: a file the gate has no business
  # comparing, with no artefact name, means an enumeration nobody updated.
  build_clean_fixture
  printf 'mystery\n' > "$FIXTURE/src/npm-package/hooks/lib/unexplained.ts"

  run bash -c "cd '$FIXTURE' && bash '$SCRIPT'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"file set drifted"* ]]
}

@test "AC-MIRROR-ARTIFACTS-02: genuine content drift is still caught" {
  build_clean_fixture
  local target
  target="$(printf '%s\n' $HOOK_FILES | head -1)"
  printf 'drifted\n' > "$FIXTURE/src/npm-package/hooks/$target"

  run bash -c "cd '$FIXTURE' && bash '$SCRIPT'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"differs from canonical"* ]]
}
