#!/usr/bin/env bats
# @test REQ-681
# @intent 验证 pre-commit 在不经过 npx 的情况下启动仓库本地已安装的 Node 工具，
#         否则每次提交都要为一个本机已存在的二进制多付约 1.5 s 的 npm 解析开销
# @covers AC-681-01, AC-681-02, AC-681-03
#
# Why a property and not a smoke test: `npx <tool>` and `node node_modules/<tool>`
# run the same program, so any assertion on the tool's OUTPUT passes under both and
# proves nothing about which path ran. These cases assert the path itself -- that
# npx is never consulted when the local entry exists, and IS consulted when it does
# not (a globally-installed toolchain is still a supported setup).

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  TMPDIR_TEST="$(mktemp -d)"
  # A stand-in project: PROJECT_ROOT is what run_node_bin resolves against.
  export PROJECT_ROOT="$TMPDIR_TEST/project"
  mkdir -p "$PROJECT_ROOT/node_modules/faketool/lib"
  # Record every invocation so the assertions can prove which binary ran, rather
  # than inferring it from output that both paths would produce.
  cat > "$PROJECT_ROOT/node_modules/faketool/lib/cli.js" <<'STUB'
require('node:fs').appendFileSync(process.env.CALL_LOG, 'local\n');
STUB
  export CALL_LOG="$TMPDIR_TEST/calls.log"
  : > "$CALL_LOG"
  # An npx on PATH that records its own invocation and then fails loudly, so a
  # fallback that should not happen is both visible and cannot pass silently.
  mkdir -p "$TMPDIR_TEST/bin"
  cat > "$TMPDIR_TEST/bin/npx" <<'STUB'
#!/usr/bin/env bash
echo "npx" >> "$CALL_LOG"
exit 97
STUB
  chmod +x "$TMPDIR_TEST/bin/npx"
  export PATH="$TMPDIR_TEST/bin:$PATH"
}

teardown() {
  rm -rf "$TMPDIR_TEST"
}

# Source only the function under test. The hook is a script, not a library: running
# it would execute every gate. Extract the definition block instead, which also
# fails loudly if the definition disappears.
load_run_node_bin() {
  awk '/^  run_node_bin\(\) \{/,/^  \}$/' "$HOOK" > "$TMPDIR_TEST/fn.sh"
  [ -s "$TMPDIR_TEST/fn.sh" ] || { echo "run_node_bin definition not found in pre-commit" >&2; return 1; }
  # shellcheck disable=SC1090
  . "$TMPDIR_TEST/fn.sh"
}

@test "AC-681-01: uses the repo-local entry and never calls npx when it exists" {
  load_run_node_bin
  run run_node_bin faketool faketool/lib/cli.js --some-arg
  [ "$status" -eq 0 ]
  [ "$(cat "$CALL_LOG")" = "local" ]
}

@test "AC-681-02: falls back to npx when the local entry is missing" {
  rm -rf "$PROJECT_ROOT/node_modules/faketool"
  load_run_node_bin
  run run_node_bin faketool faketool/lib/cli.js
  # The stub npx exits 97: reaching it proves the fallback happened.
  [ "$status" -eq 97 ]
  [ "$(cat "$CALL_LOG")" = "npx" ]
}

@test "AC-681-03: does not depend on a local entry being executable" {
  # `node <entry>` never needs the +x bit, which is what lets a package-manager
  # install work regardless of how it unpacked the file. Pin that, because
  # switching to direct execution (`"$PROJECT_ROOT/node_modules/..."`) would look
  # equivalent and break exactly this case.
  chmod -x "$PROJECT_ROOT/node_modules/faketool/lib/cli.js"
  load_run_node_bin
  run run_node_bin faketool faketool/lib/cli.js
  [ "$status" -eq 0 ]
  [ "$(cat "$CALL_LOG")" = "local" ]
}
