#!/usr/bin/env bats
# @test REQ-5-ADAPTER-FAILCLOSED
# @intent Gate 5 printed "✅ PASSED ... assuming none to run" in TWO places:
#
#           1. an adapter PATH resolved, but `source` failed (broken install);
#           2. no adapter resolved at all for a language Gate 0 detected or the
#              project declared in .xp-gate-config.json.
#
#         Both arms reported PASS over a test half that executed nothing, which
#         is the same fail-open shape as the missing Rust binding: the gate
#         claimed a verification it never performed. Every language Gate 0 can
#         detect ships an adapter, so a missing one is an incomplete install (or
#         a config naming an unsupported language) -- either way the honest
#         verdict is BLOCK with a way out, not PASS.
#
#         These cases are behaviour, not text: they run the real hook chain and
#         assert the exit status AND the message. A grep-only assertion would keep
#         passing after someone flipped the arm back to `return 0`.
# @covers REQ-5-ADAPTER-FAILCLOSED

SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

# shellcheck source=/dev/null
. "$BATS_TEST_DIRNAME/helpers/install-hook-set.bash"

setup() {
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"

  install_hook_set "$SOURCE_GITHOOKS" "$TEST_DIR/.git/hooks"
  git config core.hooksPath "$TEST_DIR/.git/hooks"

  # Gate 2 and the security gates run before Gate 5 in the chain. Stub them for
  # the same reason the Gate 5a suite does: the fixture exercises Gate 5's
  # adapter arm, not the host toolchain.
  mkdir -p "$TEST_DIR/bin"
  cat > "$TEST_DIR/bin/jscpd" << 'MOCK'
#!/bin/bash
echo '{"duplicates":[]}'
exit 0
MOCK
  cat > "$TEST_DIR/bin/lizard" << 'MOCK'
#!/bin/bash
exit 0
MOCK
  cat > "$TEST_DIR/bin/gitleaks" << 'MOCK'
#!/bin/bash
case "$*" in *--version*) echo "8.0.0"; exit 0 ;; esac
echo "[]"
exit 0
MOCK
  cat > "$TEST_DIR/bin/semgrep" << 'MOCK'
#!/bin/bash
case "$*" in *--version*) echo "1.0.0"; exit 0 ;; esac
echo '{"results":[],"errors":[]}'
exit 0
MOCK
  chmod +x "$TEST_DIR/bin/"*
  export PATH="$TEST_DIR/bin:$PATH"

  echo "init" > README.md
  mkdir -p src
  echo 'export const x = 1;' > src/foo.ts
  printf "import { expect, test } from 'vitest';\ntest('foo', () => { expect(1 + 1).toBe(2); });\n" > src/foo.test.ts
  echo "ignore: []" > .archlint.yaml
  git add . && git commit --no-verify -q -m "init"
  # Hook artifacts from the seed commit must not decide the assertion.
  rm -f .quality-history.jsonl
  rm -rf .xp-gate
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Stage a MODIFIED .ts file: a new one would be claimed by Gate 5a's pairing
# check first, and the assertion would then be about 5a rather than the adapter
# arm under test.
stage_modified_source() {
  cd "$TEST_DIR" || return 1
  echo 'export const x = 2;' > src/foo.ts
  git add src/foo.ts
}

run_fixture_hook() {
  local out
  status=0
  out=$(SKIP_VERSION_CHECK=1 "$TEST_DIR/.git/hooks/pre-commit" 2>&1) || status=$?
  output="$out"
}

@test "a declared language with no adapter BLOCKS instead of passing" {
  echo "nosuchlang" > .xp-gate-lang
  git add .xp-gate-lang
  stage_modified_source
  run_fixture_hook
  [ "$status" -ne 0 ]
  [[ "$output" == *"No nosuchlang adapter found"* ]]
  [[ "$output" != *"assuming none to run"* ]]
  # Status alone does not prove this arm blocked: the coverage stage would also
  # exit non-zero for a language it cannot measure, so dropping the `return 1`
  # here would still leave a red commit behind a misleading message. The arm is
  # proven only by the gate never reaching the coverage stage.
  [[ "$output" != *"Running coverage check"* ]]
}

@test "an adapter that exists but cannot be sourced BLOCKS" {
  echo "brokenlang" > .xp-gate-lang
  git add .xp-gate-lang
  # The project tier (<repo>/githooks/adapters/) is the one a fixture can own:
  # the global tier only wins for names it already ships, and `brokenlang` is
  # not one of them.
  mkdir -p "$TEST_DIR/githooks/adapters"
  printf 'this is ( not valid shell )\n' > "$TEST_DIR/githooks/adapters/brokenlang.sh"
  stage_modified_source
  run_fixture_hook
  [ "$status" -ne 0 ]
  [[ "$output" == *"brokenlang adapter exists but could not be sourced"* ]]
  [[ "$output" != *"assuming none to run"* ]]
  # Same reason as the case above: the verdict must come from this arm.
  [[ "$output" != *"Running coverage check"* ]]
}

@test "anti-vacuity: a real adapter still passes the test half" {
  # Without this, turning Gate 5 off entirely would leave the two cases above
  # green for the wrong reason.
  run_fixture_hook
  [[ "$output" != *"No typescript adapter found"* ]]
  [[ "$output" != *"Could not source typescript adapter"* ]]
}
