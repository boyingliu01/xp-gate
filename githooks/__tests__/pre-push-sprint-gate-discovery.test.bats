#!/usr/bin/env bats
# @test REQ-685
# @intent 验证 pre-push 的 Gate MS 会去 `~/.config/xp-gate/adapters/` 找
#         sprint-gate.sh——`xp-gate setup-global` 正是装在那里，而旧代码只搜
#         `hooks/`，于是全局安装的机器上这道门从未执行过一次（#678）
# @covers AC-685-01, AC-685-02
#
# 为什么需要单独测：Gate MS 找不到脚本时**静默 SKIP**。SKIP 在输出里长得像
# "这道门不适用于此次推送"，而事实是"这道门从未跑过"。没有任何用例断言过它
# 能找到脚本，所以这个缺口存在了整个全局安装生命周期也没被发现。

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_PUSH="$REPO_ROOT/githooks/pre-push"
  WORK="$(mktemp -d)"
  FAKE_HOME="$WORK/home"
  mkdir -p "$FAKE_HOME/.config/xp-gate/adapters"
}

teardown() {
  rm -rf "$WORK"
}

# Extract the sprint-gate discovery loop so it can be exercised without running
# the whole pre-push (mutation, mock policy, walkthrough …). The loop is pure
# path resolution, which is exactly what regressed.
load_resolution_loop() {
  awk '/^for _sprint_gate_dir in/,/^done$/' "$PRE_PUSH" > "$WORK/loop.sh"
  [ -s "$WORK/loop.sh" ] || { echo "sprint-gate discovery loop not found" >&2; return 1; }
}

@test "AC-685-01: finds sprint-gate.sh under ~/.config/xp-gate/adapters (global install layout)" {
  # This is where copyAdapters() actually puts it -- see src/npm-package/lib/shared-utils.js.
  printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_HOME/.config/xp-gate/adapters/sprint-gate.sh"
  load_resolution_loop

  run bash -c "
    HOME='$FAKE_HOME'
    PROJECT_ROOT='$WORK'   # no githooks/ here, so the repo tier cannot match
    SPRINT_GATE_SCRIPT=''
    . '$WORK/loop.sh'
    printf '%s' \"\$SPRINT_GATE_SCRIPT\"
  "
  [ "$status" -eq 0 ]
  [ "$output" = "$FAKE_HOME/.config/xp-gate/adapters/sprint-gate.sh" ]
}

@test "AC-685-02: still finds it under hooks/ (the tier that already worked)" {
  # Regression guard for the fix itself: adding a tier must not have dropped the
  # one that previously worked for per-project installs.
  mkdir -p "$FAKE_HOME/.config/xp-gate/hooks"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_HOME/.config/xp-gate/hooks/sprint-gate.sh"
  load_resolution_loop

  run bash -c "
    HOME='$FAKE_HOME'
    PROJECT_ROOT='$WORK'
    SPRINT_GATE_SCRIPT=''
    . '$WORK/loop.sh'
    printf '%s' \"\$SPRINT_GATE_SCRIPT\"
  "
  [ "$status" -eq 0 ]
  [ "$output" = "$FAKE_HOME/.config/xp-gate/hooks/sprint-gate.sh" ]
}
