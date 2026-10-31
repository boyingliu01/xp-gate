#!/usr/bin/env bats
# @test REQ-689
# @intent 验证 Gate 13 的 javac 告警计数不会把 Maven reactor summary 的
#         [pom]/[jar] 打包类型当成 lint 类别——多模块工程因此在零告警的代码上
#         被永久阻断，且模块越多"发现"越多（#673）
# @covers AC-689-01, AC-689-02, AC-689-03
#
# 为什么要两个方向都测：#659 把计数规则改成「任意小写方括号类别」是为了 fail-closed
# （javac 的类别集是开放枚举，白名单必然漏）。修复 #673 时最容易犯的错是把排除
# 规则写宽了，重新打开发 fail-open 的洞——所以 AC-689-02 必须证明真实 javac 告警
# 仍然被计数。只测「reactor summary 不再计数」会奖励一个把计数归零的实现。

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE13="$REPO_ROOT/githooks/gate-13-compiler-strictness.sh"
  awk '/^gate13_count_lint_findings\(\) \{/,/^\}/' "$GATE13" > "$BATS_TEST_TMPDIR/fn.sh"
  [ -s "$BATS_TEST_TMPDIR/fn.sh" ]
}

count() {
  bash -c ". '$BATS_TEST_TMPDIR/fn.sh'; gate13_count_lint_findings \"\$1\"" _ "$1"
}

@test "AC-689-01: Maven reactor summary packaging types are not findings" {
  # Verbatim from the issue: 3-module reactor, zero [WARNING] lines, reported 4.
  # Not `run count ...`: bats' `run` cannot call shell functions.
  local out
  out=$'[INFO] whaleaudit-parent                                                  [pom]\n[INFO] whaleaudit-core                                                    [jar]\n[INFO] whaleaudit-demo                                                    [jar]\n[INFO] whaleAudit E2E 验证程序                                             [jar]'
  [ "$(count "$out")" -eq 0 ]
}

@test "AC-689-02: real javac diagnostics are still counted (fail-closed preserved)" {
  # The regression this guards is a fix that zeroes the counter.
  local out
  out=$'[INFO] Building core 1.0\nsrc/Foo.java:12: warning: [unchecked] unchecked call\nsrc/Bar.java:7: warning: [fallthrough] switch fallthrough'
  [ "$(count "$out")" -eq 2 ]
}

@test "AC-689-03: a category on a [WARNING] line survives even when its name is a packaging type" {
  # The exclusion is scoped to [INFO] lines precisely so this cannot be masked:
  # a javac diagnostic never carries Maven's [INFO] banner.
  local out
  out=$'[WARNING] src/Foo.java:[12,5] [pom] some future category'
  [ "$(count "$out")" -eq 1 ]
}
