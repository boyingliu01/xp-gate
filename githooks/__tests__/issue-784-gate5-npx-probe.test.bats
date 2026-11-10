#!/usr/bin/env bats
#
# @test REQ-GATE-INTEGRITY Gate 5's vitest availability probe must not fall back to npx
# @intent The adapter-level fix (adapter-typescript-npx-probe.test.bats) covered
#         `run_tests()` / `run_coverage()`, but this project's own Gate 5 does not
#         go through those functions. pre-commit has an inlined TypeScript branch
#         that detected vitest with:
#
#             run_without_git_context run_node_bin vitest vitest/vitest.mjs --version
#
#         and `run_node_bin` ends with `npx "$_tool" "$@"` when the local entry
#         file is missing. So the same defect survived one layer up: the probe
#         downloaded vitest from the registry, always succeeded, and Gate 5 then
#         ran `vitest run --coverage` -- which failed on a missing
#         @vitest/coverage-v8 and was reported as "TESTS FAILED".
#
#         Measured on dsh-aot-runner (no vitest in node_modules at all): after the
#         adapter fix the hook still printed
#
#             MISSING DEPENDENCY  Cannot find dependency '@vitest/coverage-v8'
#             ❌ BLOCKED - Tests FAILED in full test suite
#
#         because this path never touches adapters/typescript.sh.
#
#         The fix adds a `--probe` mode to `run_node_bin` that returns 127 instead
#         of reaching npx. These tests pin BOTH halves: the probe mode behaves,
#         and the call site actually uses it.
#
# @covers AC-NPX-PROBE-05 run_node_bin --probe never reaches the registry
# @covers AC-NPX-PROBE-06 a present local entry file is still used
# @covers AC-NPX-PROBE-07 Gate 5's vitest detection uses the probe mode
# @covers AC-NPX-PROBE-08 "no runner installed" is SKIP, not a coverage failure
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/bin" "$WORK/node_modules/vitest"
  # npx stub records every call and pretends `--version` succeeds, exactly like
  # real npx after downloading the package.
  cat > "$WORK/bin/npx" <<'STUB'
#!/bin/sh
echo "npx $*" >> "$NPX_LOG"
case "$*" in
  *--version*) echo "vitest/5.1.0 stub"; exit 0 ;;
esac
exit 0
STUB
  chmod +x "$WORK/bin/npx"
  export NPX_LOG="$WORK/npx.log"
  : > "$NPX_LOG"
}

teardown() {
  rm -rf "$WORK"
}

# Extracts only the `run_node_bin` definition from the hook, then runs it with the
# arguments under test. Located by name, not by line number: the definition has
# already moved once when an explanatory comment was added above it, and a
# hardcoded range turned that harmless edit into a confusing 127.
_call_run_node_bin() {
  local stub_path="$WORK/bin:$PATH"
  run bash -c "
    export PATH='$stub_path'
    export NPX_LOG='$NPX_LOG'
    export PROJECT_ROOT='$WORK'
    cd '$WORK'
    eval \"\$(awk '/^if ! declare -F run_node_bin/,/^fi\$/' '$HOOK')\"
    run_node_bin $*
  "
}

@test "AC-NPX-PROBE-05: --probe returns 127 without reaching npx" {
  # node_modules/vitest exists but vitest.mjs does not: the un-probed form fell
  # through to npx, which downloads the package just to answer "--version".
  # `run -127` tells bats that 127 is the EXPECTED status (it is the shell's
  # "command not found", which is exactly what --probe returns on purpose).
  run -127 bash -c "
    export PATH='$WORK/bin:\$PATH'
    export NPX_LOG='$NPX_LOG'
    export PROJECT_ROOT='$WORK'
    cd '$WORK'
    eval \"\$(awk '/^if ! declare -F run_node_bin/,/^fi\$/' '$HOOK')\"
    run_node_bin --probe vitest vitest/vitest.mjs --version
  "
  run grep -c 'npx' "$NPX_LOG"
  [ "$output" = "0" ]
}

@test "AC-NPX-PROBE-05: --probe never prints a downloaded tool's version" {
  run -127 bash -c "
    export PATH='$WORK/bin:\$PATH'
    export NPX_LOG='$NPX_LOG'
    export PROJECT_ROOT='$WORK'
    cd '$WORK'
    eval \"\$(awk '/^if ! declare -F run_node_bin/,/^fi\$/' '$HOOK')\"
    run_node_bin --probe vitest vitest/vitest.mjs --version
  "
  [[ "$output" != *"vitest/5.1.0 stub"* ]]
}

@test "AC-NPX-PROBE-06: --probe still runs a genuinely local entry file" {
  printf 'console.log("LOCAL_VITEST_MJS");\n' > "$WORK/node_modules/vitest/vitest.mjs"
  _call_run_node_bin --probe vitest vitest/vitest.mjs --version
  # The fix must not achieve "no npx" by refusing to run an installed runner --
  # that would silently disable Gate 5 wherever vitest IS present.
  [ "$status" -eq 0 ]
  [[ "$output" == *"LOCAL_VITEST_MJS"* ]]
}

@test "AC-NPX-PROBE-06: without --probe the npx fallback is unchanged" {
  # Real runs may legitimately rely on a global toolchain; only DETECTION must
  # stay local. Removing the fallback outright would break those setups.
  _call_run_node_bin vitest vitest/vitest.mjs --version
  [ "$status" -eq 0 ]
  run grep -q 'npx' "$NPX_LOG"
  [ "$status" -eq 0 ]
}

@test "AC-NPX-PROBE-07: Gate 5's vitest detection uses the probe mode" {
  # The behavioural tests above prove the mechanism; this one proves the call
  # site adopted it. Without this assertion the fix would be available but
  # unused -- the exact false-green shape #717 was about.
  run bash -c "grep -nE 'run_node_bin +vitest +vitest/vitest\.mjs +--version' '$HOOK'"
  [ "$status" -ne 0 ]
  run bash -c "grep -cE 'run_node_bin +--probe +vitest' '$HOOK'"
  [ "$output" -ge 1 ]
}

@test "AC-NPX-PROBE-08: an uninstalled runner marks the run SKIPPED, not passed" {
  # The adapter returns 0 when no runner is installed (nothing was measured). If
  # the hook read that as "all tests passed", the coverage arm further down would
  # find no report and block with "coverage/coverage-summary.json not found" --
  # blaming a missing artifact for a runner that was never installed.
  #
  # Both call sites must set TESTS_SKIPPED. Asserted statically because each sits
  # inside a ~6000-line branch that needs a full project fixture to reach; the
  # dynamic proof is the end-to-end run on dsh-aot-runner (#21), which went from
  # BLOCKED to exit 0.
  run bash -c "grep -c 'No test runner installed locally' '$HOOK'"
  [ "$output" -ge 2 ]
  run bash -c "grep -n -A4 'No test runner installed locally' '$HOOK' | grep -c 'TESTS_SKIPPED=true'"
  [ "$output" -ge 2 ]
}
