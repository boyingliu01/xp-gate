#!/usr/bin/env bats
# @test REQ-GATE-MATRIX-DERIVED
#
# @intent The gate × language matrix must be READ FROM THE CODE, never typed into
# a document. Three sources once disagreed about how many languages Gate 4 covers:
# a hardcoded string in `gate-list` said 9, `src/principles/adapters/` held 14,
# and a doc said 14. A hand-written matrix is a second source of truth and is
# always the stalest one.
#
# These cases assert the properties that make the generated output trustworthy:
# it runs, it names the adapters that actually exist, and it separates "has an
# adapter" from "the adapter declares what it covers" -- because a green Gate 4
# row over an undeclared adapter is a partial verdict, not a complete one.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  MATRIX="$REPO_ROOT/scripts/gate-matrix.cjs"
}

# @covers the script parses and runs
@test "the matrix script runs and reports adapters" {
  run node "$MATRIX"
  [ "$status" -eq 0 ]
  [[ "$output" == *"GATE × LANGUAGE AVAILABILITY MATRIX"* ]]
  [[ "$output" == *"language adapters"* ]]
}

# @covers language count comes from the directory, not a literal
#
# The printed count must equal the number of `.sh` files under adapters/ that are
# not gate scripts. If someone types the number in, this fails the moment an
# adapter is added.
@test "the language count matches the adapter directory" {
  local actual expected
  actual=$(cd "$REPO_ROOT/githooks/adapters" && ls -1 *.sh 2>/dev/null | grep -vE '^gate-' | wc -l | tr -d ' ')
  expected=$(node "$MATRIX" | grep -oE '[0-9]+ language adapters' | grep -oE '[0-9]+')
  [ "$actual" -eq "$expected" ]
}

# @covers the two claims are kept apart
@test "the output states that the matrix does not prove blocking" {
  run node "$MATRIX"
  [[ "$output" == *"THIS MATRIX SAYS A BRANCH EXISTS, NOT THAT IT WORKS"* ]]
  [[ "$output" == *"gate-language-probe.sh"* ]]
}

# @covers a coverage step that does not run tests is not reported as a double run
#
# Measured: cpp, iac, objectivec, powershell and shell have run_coverage functions
# that never start a test runner. Reporting them as "does not subsume tests" reads
# as a double-run risk that does not exist.
@test "a non-test-running coverage step is not a double-run finding" {
  run node "$MATRIX"
  [ "$status" -eq 0 ]
  [[ "$output" == *"(none)"* ]] || [[ "$output" != *"double run): cpp"* ]]
}

# @covers known gaps are named rather than silently omitted
@test "languages with no principles adapter are listed" {
  run node "$MATRIX"
  [[ "$output" == *"Gate 4 has no principles adapter for:"* ]]
}

# @covers an adapter that does not declare its rule scope is visibly partial
@test "undeclared rule scope is reported" {
  run node "$MATRIX"
  [[ "$output" == *"does not declare rule scope"* ]]
  # base.ts defaults the flag to false, so the script must say what silence means.
  [[ "$output" == *"silence is \"unknown\""* ]]
}
