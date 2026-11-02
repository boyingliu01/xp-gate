#!/usr/bin/env bats
# @test REQ-703
# @intent JaCoCo 在含非 ASCII 字符的构建路径下静默不写执行数据（不抛异常、不写文件），
#         Maven 侧只看到「文件不存在」，于是打印
#             [INFO] Skipping JaCoCo execution due to missing execution data file.
#         并 BUILD SUCCESS 退出 0。Gate 5 于是阻断，并建议
#             Run 'mvn verify' or 'gradle jacocoTestReport'
#         —— 而这条建议是死路：同一路径下 mvn verify 同样静默跳过，跑一百次也一样。
#
#         门禁阻断本身是对的（没有数据就不能证实 80% 下限），错的是它把「环境问题」
#         当成「代码问题」来告警，并给出了一个在此环境下必然无效的补救动作。用户照做
#         无效之后，只剩下 --no-verify 一条路——正好撞上本项目的硬性准则。
#
#         判定标准不是「文案变长了」，而是：
#           1. 诊断必须点出真实原因（执行数据缺失 / 路径编码），而不是让人再跑一次；
#           2. 在非 ASCII 路径下必须明确说「mvn verify 在此路径下无效」；
#           3. ASCII 路径下的既有文案不得被改坏（不能为了新场景牺牲老场景）。
#
# @covers AC-703-01, AC-703-02, AC-703-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
  WORK="$(mktemp -d)"
  cd "$WORK" || return 1
}

teardown() {
  cd /
  rm -rf "$WORK"
}

# 从 pre-commit 里抽取「No JaCoCo report found」这个失败分支做纯文本断言。
# 按标记定位而不是固定行号：行号会在任何一次无关编辑后失效，失效的测试会
# 悄悄断言一段错误的代码（这正是本仓库 #592 类的教训）。
extract_jacoco_missing_block() {
  awk '
    /no report at all is the fail-open path/ { grab = 1 }
    grab { print }
    grab && /^      fi$/ && ++closing == 1 { exit }
  ' "$PRE_COMMIT"
}

@test "AC-703-01: the missing-report diagnosis names the real cause, not just the symptom" {
  # 「No JaCoCo report found」是症状。真实原因在 Maven 日志里：
  # "Skipping JaCoCo execution due to missing execution data file"——
  # 即 agent 没写出 jacoco.exec，而不是报告生成步骤失败。
  local block
  block=$(extract_jacoco_missing_block)

  # 诊断里必须出现「执行数据」这一层，否则用户只会去查报告插件配置。
  [[ "$block" == *"execution data"* ]] || [[ "$block" == *"jacoco.exec"* ]] \
    || [[ "$block" == *"执行数据"* ]]
}

@test "AC-703-02: on a non-ASCII build path the hint says mvn verify will not help" {
  # 这是 #703 的核心：非 ASCII 路径下 'mvn verify' 是死路，必须说出来。
  # 不能只写「再跑一次 mvn verify」——那正是把人引向无效动作的原文案。
  local block
  block=$(extract_jacoco_missing_block)

  # 必须存在一条针对非 ASCII 路径的指引，且明确 `mvn verify` 在此路径无效。
  [[ "$block" == *"non-ASCII"* ]] || [[ "$block" == *"非 ASCII"* ]]
  [[ "$block" == *"will not help"* ]] || [[ "$block" == *"无效"* ]] \
    || [[ "$block" == *"does not help"* ]]
}

@test "AC-703-03: the ASCII-path guidance is preserved" {
  # 反向守护：不能为了讲清楚非 ASCII 的情况，把 ASCII 下的正常建议删掉。
  local block
  block=$(extract_jacoco_missing_block)

  [[ "$block" == *"mvn verify"* ]] || [[ "$block" == *"gradle jacocoTestReport"* ]]
}
