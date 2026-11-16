#!/usr/bin/env bats

# @test REQ-TDD-004
# @intent Gate 5a must accept a singular `test/` directory as a test-pairing
#         candidate. The candidate list only knew `tests/` (plural), so a repo
#         using the equally standard `test/` layout was hard-BLOCKED on a file
#         that already had its test — measured on the 2026-11-15 triage (#787).
# @covers AC-787-01
# @covers AC-787-02
# @covers AC-787-03
#
# The bug was asymmetric in a way that made it look like a user error rather
# than a gate defect: the identical content under `tests/` passed, and only the
# path spelling decided the verdict. Both directory names are conventional, so
# "did you mean tests/" is not actionable advice.

SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

# shellcheck source=/dev/null
. "$BATS_TEST_DIRNAME/helpers/install-hook-set.bash"

setup() {
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"
  git config core.hooksPath .git/hooks

  mkdir -p "$TEST_DIR/bin"
  cat > "$TEST_DIR/bin/jscpd" << 'MOCK'
#!/usr/bin/env bash
echo '{"statistics":{"total":{"percentage":0}}}'
exit 0
MOCK
  chmod +x "$TEST_DIR/bin/jscpd"
  export PATH="$TEST_DIR/bin:$PATH"

  install_hook_set "$SOURCE_GITHOOKS" "$TEST_DIR/.git/hooks"

  # Gate 6 blocks a commit outright when no architecture config exists (#686).
  # That is correct behaviour for a real repo, but this fixture exists only to
  # exercise Gate 5a's pairing logic, so it declares a minimal one.
  echo "ignore: []" > .archlint.yaml
}

teardown() {
  cd /
  rm -rf "$TEST_DIR"
}

# Invoking the fixture's hook directly (rather than `git commit --no-verify`)
# is what makes the assertions meaningful: --no-verify would disable the very
# hook under test. SKIP_VERSION_CHECK=1 takes Gate 0's escape hatch, because a
# throwaway fixture repo never bumps VERSION and Gate 0 would otherwise decide
# the outcome of every case here.
run_fixture_hook() {
  local out
  status=0
  out=$(SKIP_VERSION_CHECK=1 "$TEST_DIR/.git/hooks/pre-commit" 2>&1) || status=$?
  output="$out"
}

# A test file that vitest can actually collect AND that Gate 5d accepts. Two
# traps here, both of which block for reasons unrelated to the pairing logic:
#   - vitest defaults to `globals: false` and this fixture ships no config, so a
#     bare test() is a ReferenceError at collection time;
#   - Gate 5d rejects tautological assertions like `expect(1).toBe(1)`, since a
#     test that cannot fail verifies nothing.
write_test_file() {
  local dest="$1"
  local import_from="${2:-../src/foo}"
  printf "import { expect, test } from 'vitest';\nimport { x } from '%s';\ntest('foo', () => { expect(x).toBe(1); });\n" "$import_from" > "$dest"
}

# ── AC-787-01: singular test/ at the repo root ───────────────────────

@test "AC-787-01: a singular top-level test/ directory satisfies the pairing" {
  mkdir -p src test
  echo "export const x = 1;" > src/foo.ts
  write_test_file test/foo.test.ts
  git add src/foo.ts test/foo.test.ts
  run_fixture_hook
  # Assert the PAIRING verdict, not the hook's overall exit status. Later gates
  # legitimately fail in a throwaway fixture (Gate 5 can BLOCK on a missing
  # coverage/coverage-summary.json, which has nothing to do with pairing), so
  # `[ "$status" -eq 0 ]` made this case pass locally and fail on CI -- the
  # environment, not the fix, decided the outcome.
  [[ "$output" != *"without corresponding test"* ]]
  [[ "$output" != *"without corresponding tests"* ]]
  # Anti-vacuity: Gate 5 must actually have run. Without this, a hook that
  # aborted before the pairing check would satisfy the two assertions above.
  [[ "$output" == *"Gate 5"* ]]
}

# ── AC-787-02: the plural form must keep working (no regression) ─────

@test "AC-787-02: the plural tests/ directory still satisfies the pairing" {
  mkdir -p src tests
  echo "export const x = 1;" > src/foo.ts
  write_test_file tests/foo.test.ts
  git add src/foo.ts tests/foo.test.ts
  run_fixture_hook
  # Same reasoning as AC-787-01: the pairing verdict is the subject here.
  [[ "$output" != *"without corresponding test"* ]]
  [[ "$output" != *"without corresponding tests"* ]]
  [[ "$output" == *"Gate 5"* ]]
}

# ── AC-787-03: anti-vacuity — a genuinely test-less file still BLOCKS ─

# Widening the candidate list must not turn the gate off. Without this case a
# fix that simply stopped reporting would pass AC-787-01 and AC-787-02.
@test "AC-787-03: a new file with no test anywhere is still BLOCKED" {
  mkdir -p src test
  echo "export const lonely = 1;" > src/lonely.ts
  # The test directory exists and even holds a test file -- just not one named
  # after src/lonely.ts. This is what keeps the widening honest.
  write_test_file test/something-else.test.ts ../src/something-else
  git add src/lonely.ts test/something-else.test.ts
  run_fixture_hook
  [ "$status" -ne 0 ]
  [[ "$output" == *"without corresponding test"* ]]
}
