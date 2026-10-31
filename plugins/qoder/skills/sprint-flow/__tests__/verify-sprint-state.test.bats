#!/usr/bin/env bats
# @test REQ-688
# @intent 验证 sprint-flow 的校验脚本能接受 `xp-gate sprint-init` 自己写出的状态文件
#         ——脚本曾要求 sprint_id/current_phase/phases 这套从未被写入过的键，
#         对 CLI 刚创建的 sprint 恒判失败（#679）
# @covers AC-688-01, AC-688-02
#
# 为什么用真 sprint-init 而不是手写一个 fixture：缺陷的本质是「校验方与生产方对
# schema 的认知不一致」。手写 fixture 会把「我认为 CLI 写什么」固化下来，双方一起
# 错就一起绿。只有让生产方真的产出、校验方真的读，才能发现这类偏差。

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
  VERIFY="$REPO_ROOT/skills/sprint-flow/scripts/verify-sprint-state.sh"
  CLI="$REPO_ROOT/src/npm-package/bin/xp-gate.js"
  WORK="$(mktemp -d)"
}

teardown() {
  rm -rf "$WORK"
}

@test "AC-688-01: accepts state written by xp-gate sprint-init" {
  cd "$WORK"
  git init -q .
  echo '{}' > package.json
  git add -A
  git -c user.email=t@t -c user.name=t commit -q -m init

  run node "$CLI" sprint-init "probe task"
  [ -f ".sprint-state/sprint-state.json" ]

  run bash "$VERIFY"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK:"* ]]
}

@test "AC-688-02: still rejects a state file missing real keys" {
  # The fix must not become "accept anything": a file that lost its task or its
  # phase is genuinely broken and the verifier should say so.
  mkdir -p "$WORK/.sprint-state"
  printf '{"id":"s-1","phase":"BUILD"}\n' > "$WORK/.sprint-state/sprint-state.json"

  cd "$WORK"
  run bash "$VERIFY"
  [ "$status" -eq 1 ]
  [[ "$output" == *"task_description"* ]]
}
