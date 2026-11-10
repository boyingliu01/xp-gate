#!/usr/bin/env bats
#
# @test REQ-GATE-PROBE-SHORTCUT Local tool detection must not consult the registry
# @intent #21 / issue-784 收口后的第三条尾巴。`npx --no-install <tool> --version`
#         looks like the safe form of a probe: `--no-install` really does prevent
#         the package from being installed (unlike the plain `npx <tool>` probes
#         that shipped a downloaded vitest into Gate 5). But it still ASKS the
#         registry every single time:
#
#           $ npx --no-install --loglevel=verbose stryker --version
#           npm http fetch GET 200 https://.../stryker 697ms (cache miss)
#           Error: npx canceled due to missing packages and no YES option
#
#         Measured in an empty directory with only an empty package.json. So the
#         verdict is correct (rc=1, "not installed") but the cost is a network
#         round trip -- 697 ms on a cache miss, 105 ms revalidating on a hit --
#         paid by every gate that asks "is this tool here?". Offline it blocks
#         until npm's own timeout, inside a pre-commit hook.
#
#         Worse, the vitest case showed the answer can be corrupted rather than
#         merely slow: once any earlier misuse populates the npx cache, the same
#         probe returns rc=0 and a version string (see
#         docs/incidents/2026-11-09-command-could-not-run-instead-of-found-problems.md).
#
#         Detection therefore consults local artefacts only: PATH, the .exe
#         suffix, XP_GATE_<TOOL>_BIN, and the project's own node_modules/.bin.
#
# @covers AC-PROBE-LOCAL-01 a --version probe never reaches npx
# @covers AC-PROBE-LOCAL-02 a tool present in node_modules/.bin is still found
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  COMMON="$REPO_ROOT/githooks/adapter-common.sh"
  TOOLCHAIN="$REPO_ROOT/githooks/lib/toolchain-path.sh"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/bin"
  # npx stub: records every invocation so a probe that calls out is visible.
  cat > "$WORK/bin/npx" <<'STUB'
#!/bin/sh
echo "npx $*" >> "$NPX_LOG"
exit 1
STUB
  chmod +x "$WORK/bin/npx"
  export NPX_LOG="$WORK/npx.log"
  : > "$NPX_LOG"
  # Keep the real PATH so bash builtins used by the probe still resolve.
  STUB_PATH="$WORK/bin:$PATH"
}

teardown() {
  rm -rf "$WORK"
}

@test "AC-PROBE-LOCAL-01: require_tool does not probe through npx" {
  run bash -c "
    export PATH='$STUB_PATH'
    export NPX_LOG='$NPX_LOG'
    cd '$WORK'
    source '$COMMON'
    require_tool definitely-not-installed-tool GateX >/dev/null 2>&1 || true
  "
  # A missing tool may legitimately SKIP/BLOCK; what it must not do is ask the
  # registry. Asserting on the log (not on its emptiness alone) keeps a broken
  # harness from passing this silently.
  run grep -c 'npx' "$NPX_LOG"
  [ "$output" = "0" ]
}

@test "AC-PROBE-LOCAL-01: detect_mutation_testable does not probe stryker through npx" {
  printf '{"name":"x"}\n' > "$WORK/package.json"
  run bash -c "
    export PATH='$STUB_PATH'
    export NPX_LOG='$NPX_LOG'
    cd '$WORK'
    source '$COMMON'
    detect_mutation_testable >/dev/null 2>&1 || true
  "
  run grep -c 'npx' "$NPX_LOG"
  [ "$output" = "0" ]
}

@test "AC-PROBE-LOCAL-02: a tool in node_modules/.bin is still detected" {
  # The fix must not turn every probe into "not installed": a project-local
  # toolchain is exactly what these functions exist to find.
  mkdir -p "$WORK/node_modules/.bin"
  cat > "$WORK/node_modules/.bin/localtool" <<'STUB'
#!/bin/sh
echo "1.0.0"
exit 0
STUB
  chmod +x "$WORK/node_modules/.bin/localtool"
  run bash -c "
    export PATH='$STUB_PATH'
    export NPX_LOG='$NPX_LOG'
    cd '$WORK'
    source '$COMMON'
    require_tool localtool GateX
  "
  [ "$status" -eq 0 ]
  run grep -c 'npx' "$NPX_LOG"
  [ "$output" = "0" ]
}

@test "AC-PROBE-LOCAL-01: resolve_tool_path does not probe through npx" {
  run bash -c "
    export PATH='$STUB_PATH'
    export NPX_LOG='$NPX_LOG'
    cd '$WORK'
    source '$TOOLCHAIN'
    resolve_tool_path definitely-not-installed-tool >/dev/null 2>&1 || true
  "
  run grep -c 'npx' "$NPX_LOG"
  [ "$output" = "0" ]
}

@test "AC-PROBE-LOCAL-02: stryker declared in package.json is still detected" {
  printf '{"devDependencies":{"@stryker-mutator/core":"^9.0.0"}}\n' > "$WORK/package.json"
  run bash -c "
    export PATH='$STUB_PATH'
    export NPX_LOG='$NPX_LOG'
    cd '$WORK'
    source '$COMMON'
    detect_mutation_testable
  "
  [ "$status" -eq 0 ]
  run grep -c 'npx' "$NPX_LOG"
  [ "$output" = "0" ]
}
