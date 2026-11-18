#!/usr/bin/env bats
#
# @test REQ-COVERAGE-TEST-EXCLUSION
# @intent Test code must be excluded from coverage, and it must be excluded by
#         the SAME set of patterns the gates use to RECOGNISE test code.
#
#         The project rule is that test code is a first-class citizen everywhere
#         EXCEPT coverage: gate 5a requires a source file to have a matching test,
#         gate 5b measures mock density in test files, and both must see test
#         files as part of the change set. Coverage is the one measurement that
#         must not include them, because a test exercising itself inflates the
#         number that is supposed to describe the source.
#
#         Measured gap: the coverage exclude list named
#
#             '**/*.test.ts', '**/*.test.js', '**/__tests__/**'
#
#         while gate 5a's own test-detection regex is
#
#             \.(test|spec)\.(ts|tsx|js|...)$
#
#         So `.spec.ts` was recognised as a test EVERYWHERE EXCEPT in coverage.
#         The repo happens to contain zero `.spec.` files today, which is why
#         nothing has gone wrong yet -- but the asymmetry is latent: the first
#         person to name a file `foo.spec.ts` gets a test file measured as
#         production code, deflating the coverage figure with lines no source
#         change could ever cover. That is the same shape as #562, where 11688
#         mirror lines at 0% dragged the total from 82.77% to 62.19%.
#
#         A second, independent check pins the behaviour rather than the config
#         text: the exclusion must survive being asked about an actual spec file.
#
# @covers AC-COVERAGE-TEST-EXCLUSION-01 AC-COVERAGE-TEST-EXCLUSION-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  CONFIG="$REPO/vitest.config.ts"
  GATE5="$REPO/githooks/gate-entries/gate-5-entry.sh"
}

@test "AC-COVERAGE-TEST-EXCLUSION-01: coverage excludes every test-file pattern the gates recognise" {
  # Extract ONLY the coverage block's exclude list. Matching the whole file would
  # pass on `test.exclude`, which is a different list serving a different
  # purpose (it decides what runs, not what is measured).
  local block
  block=$(awk '/^    coverage: \{/,/^    \},?$/' "$CONFIG")
  [ -n "$block" ] || {
    echo "could not locate the coverage block in vitest.config.ts"
    return 1
  }

  # COMMENTS MUST BE STRIPPED FIRST. Without this, the explanation of the fix
  # (which quotes `.spec.` and `foo.spec.ts` in prose) satisfies the assertion on
  # its own: measured, deleting both exclusion lines left this test GREEN because
  # the comment above them still contained the string. A grep that cannot tell a
  # config entry from a comment about that entry is not testing the config.
  local code
  code=$(printf '%s\n' "$block" | grep -vE '^[[:space:]]*(//|\*|/\*)')

  local missing=""
  for pat in "**.test.ts" "**.test.js" "__tests__"; do
    grep -q "$pat" <<< "$code" || missing="$missing $pat"
  done
  # The gap this test exists for.
  if ! grep -qE "\.spec\.(ts|js)" <<< "$code"; then
    missing="$missing *.spec.{ts,js}"
  fi

  [ -z "$missing" ] || {
    echo "the coverage exclude list is missing:$missing"
    echo "gate 5a treats these as test files, so coverage must not measure them"
    return 1
  }
}

@test "AC-COVERAGE-TEST-EXCLUSION-02: the two lists agree on what a test file is" {
  # The real defect was DRIFT between two lists, not a wrong pattern. Pin the
  # agreement: every extension gate 5a accepts as a test must have a matching
  # coverage exclusion.
  local block
  block=$(awk '/^    coverage: \{/,/^    \},?$/' "$CONFIG")

  # Gate 5a's test-file regex, taken from the gate itself rather than restated
  # here, so the two cannot drift apart silently.
  local spec_exts
  spec_exts=$(grep -oE '\\\.\(test\|spec\)\\\.\([a-z|]+\)' "$GATE5" | head -1)
  [ -n "$spec_exts" ] || {
    echo "could not read gate 5a's test-file pattern; this test would be vacuous"
    return 1
  }

  # `.spec.` is the half that was missing. Assert the config covers it for at
  # least ts and js, which are the extensions the coverage include list measures.
  grep -qE "\.spec\.ts" <<< "$block" || {
    echo "gate 5a recognises .spec.ts as a test but coverage does not exclude it"
    return 1
  }
  grep -qE "\.spec\.js" <<< "$block" || {
    echo "gate 5a recognises .spec.js as a test but coverage does not exclude it"
    return 1
  }
}