#!/usr/bin/env bats
# @test REQ-701
# @intent #673 的 reactor summary 排除规则在非 ASCII 模块名下失效，导致含中文模块名的
#         Maven 工程在零告警的代码上被永久阻断——修复不完整，#673 只把假发现从 N 降到 1。
#
#         根因：排除规则是 `/^\[INFO\].*\[(pom|jar|...)\][[:space:]]*$/`，其中 `.*`
#         在 UTF-8 locale 下的 gawk 无法跨越非法 UTF-8 字节序列。Windows 中文环境下
#         Maven 重定向到文件时用 GBK 写 stdout，模块名里的中文是非法的 UTF-8 字节
#         （「验证程序」= d1 e9 d6 a4 b3 cc d0 f2），于是 `.*` 匹配失败，整条排除规则
#         失配，行落到下面的开放类别规则上被计成一条 lint 发现。
#
#         为什么测试要显式设 locale：本缺陷的可见性**完全取决于** LC_ALL/LANG。
#         默认走 C locale 的机器（容器、CI）上它一直是绿的，所以只在开发者机器上
#         复现——这正是它能活到 issue 里的原因。测试钉的是「行为与环境无关」，
#         因此必须同时断言两种 locale 下结论一致，而不是只断言当前环境的结果。
#
# @covers AC-701-01, AC-701-02, AC-701-03, AC-701-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE13="$REPO_ROOT/githooks/gate-13-compiler-strictness.sh"
  awk '/^gate13_count_lint_findings\(\) \{/,/^\}/' "$GATE13" > "$BATS_TEST_TMPDIR/fn.sh"
  [ -s "$BATS_TEST_TMPDIR/fn.sh" ]
}

# 在指定 locale 下调用计数函数。locale 是这个 bug 的触发开关，必须显式控制。
count_in_locale() {
  local loc="$1" payload="$2"
  LC_ALL="$loc" bash -c ". '$BATS_TEST_TMPDIR/fn.sh'; gate13_count_lint_findings \"\$1\"" _ "$payload"
}

# 3 模块 reactor，其中一个模块 <name> 为中文（GBK 字节，逐字取自 issue 的 hexdump）：
#   [INFO] whaleAudit E2E d1e9 d6a4 b3cc d0f2  [jar]
# 用 $'...' 的 \x 转义写原始字节，避免测试文件本身的编码影响结果。
gbk_reactor_output() {
  printf '[INFO] whaleaudit-parent                                                  [pom]\n'
  printf '[INFO] whaleaudit-core                                                    [jar]\n'
  printf '[INFO] whaleaudit-demo                                                    [jar]\n'
  printf '[INFO] whaleAudit E2E \xd1\xe9\xd6\xa4\xb3\xcc\xd0\xf2                     [jar]\n'
}

@test "AC-701-01: GBK reactor summary is not counted as findings under a UTF-8 locale" {
  # 这个断言是 issue 的直接复现：0.35.22 上它返回 1。
  local out
  out=$(gbk_reactor_output)
  [ "$(count_in_locale C.UTF-8 "$out")" -eq 0 ]
}

@test "AC-701-02: the verdict does not depend on the caller's locale" {
  # 同一个输入在 C 与 C.UTF-8 下必须给同一个答案。修复前是 0 与 1 的分歧，
  # 而分歧本身比任何一个具体的错值都更难排查。
  local out c_utf8 c_locale
  out=$(gbk_reactor_output)
  c_utf8=$(count_in_locale C.UTF-8 "$out")
  c_locale=$(count_in_locale C "$out")
  [ "$c_utf8" -eq "$c_locale" ]
}

@test "AC-701-03: real javac diagnostics stay double-counted-once on a non-ASCII line" {
  # fail-closed 守护：修复不能靠「遇到非 ASCII 就不计数」实现，否则含中文路径的
  # 真实 javac 告警会被一起放过。这里一条中文路径的真实告警必须仍然计 1。
  local out expected=1
  out=$'[INFO] Building core 1.0\nsrc/\xe4\xb8\xad\xe6\x96\x87/Foo.java:12: warning: [unchecked] unchecked call'
  [ "$(count_in_locale C.UTF-8 "$out")" -eq "$expected" ]
}

@test "AC-701-04: a GBK reactor line carrying a real category is still a finding" {
  # 排除规则只认 packaging 类型的闭合枚举。若某天 Maven 在 [INFO] 行上打出一个
  # 真类别，它必须仍被计数——证明修复没有把整类 [INFO] 行无差别丢掉。
  local out
  out=$'[INFO] whaleAudit E2E \xd1\xe9\xd6\xa4\xb3\xcc\xd0\xf2   [unchecked]'
  [ "$(count_in_locale C.UTF-8 "$out")" -eq 1 ]
}
