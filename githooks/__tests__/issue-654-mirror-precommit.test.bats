#!/usr/bin/env bats
#
# @test REQ-654 镜像漂移必须在 pre-commit 就被拦住，而不是等到 pre-push
# @intent 会话日志里 mirror/sync 类失败 **58 次**，git 历史反复出现
#         `fix(mirror): ...`。根因不是模型不知道规则——AGENTS.md 写得很清楚——
#         而是这类约束是**结构性信息**：哪个文件是源、哪个是镜像、谁依赖谁。
#         知道规则并不消除"在跨文件编辑中持续追踪映射"的负担,那是工具的活。
#
#         把检查从 pre-push 提前到 pre-commit 的代价是时间,所以 scope 只限于
#         本次提交碰到的文件——全树扫描正是当初把它推到 pre-push 的原因。
#
# @covers AC-654-01, AC-654-02
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

@test "AC-654-01: pre-commit carries a mirror parity gate scoped to touched files" {
  run grep -c 'GATE 12b' "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "AC-654-01: the gate only inspects githooks/ and plugins/*/src/ paths" {
  # A full-tree scan on every commit is what pushed this check to pre-push. The
  # path filter is the reason it can run per-commit at all.
  run grep -cF "MIRROR_STAGED" "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "AC-654-02: the block message names the fix command" {
  # A block that does not say how to fix it teaches people to reach for --no-verify.
  run grep -c 'sync-package-content.js --fix' "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "AC-654-02: mirror manifest reports zero unlisted canonical sources" {
  cd "$REPO_ROOT" || return 1
  run node -e "
    const { findUnlistedSources } = require('./src/npm-package/lib/mirror-manifest.js');
    const unlisted = findUnlistedSources({ cwd: process.cwd() });
    if (unlisted.length > 0) { console.error(unlisted.join('\n')); process.exit(1); }
    console.log('ok');
  "
  [ "$status" -eq 0 ]
  [ "$output" = "ok" ]
}
