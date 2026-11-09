#!/usr/bin/env bats
#
# @test REQ-GATE-INTEGRITY TypeScript adapter's Biome branch must propagate Biome's verdict
# @intent The Biome arm of run_lint() ended a command with `| head -50` and then
#         read `$?` on the next line. In a POSIX pipeline `$?` is the exit status
#         of the LAST command -- `head` -- not of the tool in front of the pipe,
#         so the status was always 0. `if [ $EXIT_CODE -ne 0 ]` could therefore
#         never fire, and a project whose Biome check failed was told
#         "✅ PASSED - Biome check."
#
#         This repo has no biome.json, so its own commits take the ESLint arm and
#         the bug is invisible here. It bites every DOWNSTREAM project that uses
#         Biome, which is exactly the population the adapter exists to serve --
#         the same shape as #717: a gate that reports success because nothing was
#         ever read.
#
# @covers AC-GATE-INTEGRITY-01
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/typescript.sh"
}

@test "AC-GATE-INTEGRITY-01: the Biome arm does not pipe the tool into head" {
  # The failure has two halves: piping into head, and reading $? afterwards. The
  # pipe is the cause, so it is asserted on its own.
  #
  # Comment lines are excluded on purpose. The fix records the buggy form in a
  # comment so the next reader sees why the capture-then-print shape exists, and
  # a bare grep would then report the explanation as the defect -- flagging the
  # fix for describing what it fixed.
  run bash -c "grep -vE '^[[:space:]]*#' '$ADAPTER' | grep -nE 'biome check .*\\| *head'"
  [ "$status" -ne 0 ]
}

@test "AC-GATE-INTEGRITY-01: a failing Biome run makes run_lint() fail, not print PASSED" {
  # Executes the adapter's real run_lint() against a fake `npx` that reports a
  # Biome failure. A green assertion here means the adapter's exit status now
  # comes from the tool rather than from head.
  local work
  work="$(mktemp -d)"
  printf '{}' > "$work/biome.json"
  mkdir -p "$work/bin"
  cat > "$work/bin/npx" <<'STUB'
#!/usr/bin/env bash
# Pretend Biome found violations.
echo "src/a.ts:1:1 lint/suspicious/noDoubleEquals"
echo "Found 1 error."
exit 1
STUB
  chmod +x "$work/bin/npx"

  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$PATH'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER'
    run_lint
  "
  rm -rf "$work"

  # Non-zero exit AND no false PASSED line.
  [ "$status" -ne 0 ]
  [[ "$output" != *"PASSED - Biome check"* ]]
}

@test "AC-GATE-INTEGRITY-01: a clean Biome run still passes" {
  # The fix must not turn the arm fail-closed for everyone -- a passing project
  # has to keep passing.
  local work
  work="$(mktemp -d)"
  printf '{}' > "$work/biome.json"
  mkdir -p "$work/bin"
  cat > "$work/bin/npx" <<'STUB'
#!/usr/bin/env bash
echo "Checked 3 files in 12ms. No fixes applied."
exit 0
STUB
  chmod +x "$work/bin/npx"

  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$PATH'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER'
    run_lint
  "
  rm -rf "$work"

  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED - Biome check"* ]]
}
