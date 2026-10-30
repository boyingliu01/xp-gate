#!/usr/bin/env bats
# @test REQ-661 Gate 4 检查器自身故障时不得报为通过
# @intent Gate 4 有意区分三种退出码：0 干净 / 1 有 ERROR 级违规 / ≥2 工具故障。
#         但 ≥2 分支的处理是 `GATE_4_STATUS="SKIP"`，而 pre-commit 把 SKIP 当成
#         不阻塞 —— 于是**工具崩溃被吸收成了绿灯**。
#
#         这正是 issue 报告里的现象：检查器因路径错误起不来
#         （`Cannot find module 'C:\c\Users\...'`），门禁仍印
#         `✅ PASSED - Principles checker (no errors found).`
#
#         路径转换的修复（to_native_path）只治了**这一个**起因。真正的形状问题是：
#         任何让检查器起不来的原因（缺 tsx、模块损坏、OOM、未来又一个路径 bug）
#         都会得到同一个结论。工具故障必须 fail-closed —— 这和 Gate 8 一致：
#         **一个跑不起来的门禁不能报成功。**
#
#         注意这里不能用 SKIP 就完事：SKIP 是给"语言不适用/工具未安装"用的，
#         而"检查器存在但崩了"是故障，不是不适用。
# @covers AC-661-01, AC-661-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE4="$REPO_ROOT/githooks/adapters/gate-4.sh"
  TEST_TMP="$(mktemp -d)"
}

teardown() {
  rm -rf "$TEST_TMP"
}

@test "AC-661-01: gate 4 must not report PASSED when the checker exits >=2" {
  run grep -n 'GATE_4_STATUS="SKIP"' "$GATE4"
  # The old shape: a tool failure settles on SKIP, which the caller reads as
  # non-blocking. Assert the fix by requiring the branch to block instead.
  run grep -n 'PRINCIPLES_EXIT.*-ge 2' -A 10 "$GATE4"
  [ "$status" -eq 0 ]
  # It must NOT merely mark SKIP inside the tool-failure branch.
  if printf '%s' "$output" | grep -q 'GATE_4_STATUS="SKIP"'; then
    printf 'Gate 4 still absorbs a checker crash as non-blocking SKIP:\n%s\n' "$output" >&3
    return 1
  fi
}

@test "AC-661-02: tool-fault branch documents the same fail-closed rule as gate 8" {
  # A crash is a fault, not a non-applicable language. The reasoning has to be
  # written down where the next person will edit, or it gets "fixed" back to SKIP.
  run grep -nE 'fail.?closed|跑不起来|cannot report success|must not report' "$GATE4"
  [ "$status" -eq 0 ]
}
