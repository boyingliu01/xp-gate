#!/usr/bin/env bats
# @test REQ-628
# @intent Gate 4's Java coverage note pointed users at `docs/java-principles-coverage.md`.
#         That file exists in THIS repository but `docs/` is not in the npm package's
#         `files` list, so in every installed project the note referenced a path that
#         does not exist. An explanatory message whose whole purpose is "read this for
#         the details" is worthless if following it lands on a missing file -- and
#         worse than silence, because it reads as if the tool knows the answer.
#
#         The reference must therefore degrade: cite the local path only when the doc
#         is actually present (developer working inside this repo), otherwise cite the
#         upstream URL that is valid regardless of install shape.
# @covers AC-670-36

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-4.sh"
  TMP="$BATS_TEST_TMPDIR"
}

# AC-670-36: the note never names an unpackaged path when run outside the repo.
@test "AC-670-36: the Java coverage note survives a project that has no docs/ directory" {
  [ -f "$GATE" ]

  # Extract the function, then run it in a directory that has no docs/ -- which is
  # what every consumer project looks like after `xp-gate init`.
  local fn
  fn=$(sed -n '/^java_coverage_note()/,/^}/p' "$GATE")
  [ -n "$fn" ] || { echo "java_coverage_note() not found"; return 1; }

  local sandbox="$TMP/consumer"
  mkdir -p "$sandbox"

  run bash -c "cd '$sandbox' && JAVA_COVERAGE_EFFECTIVE=9 JAVA_COVERAGE_TOTAL=14 JAVA_COVERAGE_INERT=5; $fn; java_coverage_note src/Foo.java"
  [ "$status" -eq 0 ]
  # It must still emit the coverage summary -- the fix is about the pointer, not
  # about silencing the note.
  printf '%s\n' "$output" | grep -q '9/14'
  # And it must not name the unpackaged repo-relative path.
  if printf '%s\n' "$output" | grep -q 'see docs/java-principles-coverage.md'; then
    echo "note points at a path absent from the npm package:"
    printf '%s\n' "$output"
    return 1
  fi
  # A reachable pointer must still be offered.
  printf '%s\n' "$output" | grep -qE 'https://|java-principles-coverage' \
    || { echo "note dropped its reference entirely"; return 1; }
}

# AC-670-36 (second half): inside this repo, where the doc really exists, the local
# path is the better pointer and must be kept.
@test "AC-670-36: inside the repo the local doc path is used" {
  local fn
  fn=$(sed -n '/^java_coverage_note()/,/^}/p' "$GATE")
  run bash -c "cd '$REPO_ROOT' && JAVA_COVERAGE_EFFECTIVE=9 JAVA_COVERAGE_TOTAL=14 JAVA_COVERAGE_INERT=5; $fn; java_coverage_note src/Foo.java"
  [ "$status" -eq 0 ]
  printf '%s\n' "$output" | grep -q 'docs/java-principles-coverage.md'
}
