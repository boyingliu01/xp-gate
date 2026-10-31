#!/usr/bin/env bats
# @test REQ-687
# @intent 验证 Gate 13 的判决会进入评分循环、汇总数字与控制台表格——它此前只写进
#         JSON 的 gates 对象，于是 `overall.gatesWarned` 为 0、表停在 Gate 12，
#         而 "编译器从未检查" 与 "编译器零告警" 在人眼里一模一样（#680）
# @covers AC-687-01, AC-687-02, AC-687-03
#
# 为什么是静态断言而不是跑整个 generate_quality_report：
# 那个函数要真实的 git 状态、13 个全局 GATE_* 变量和一整套报告脚手架，端到端
# 跑一次的成本与它守的东西不成比例。真正的回归形态很具体——某处又写死一个门数
# 字面量——那正是一行 grep 能抓住的东西，而且抓得比端到端更准（端到端只会在
# Gate 13 恰好 WARN 时才红）。

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
}

@test "AC-687-01: the gate list is defined once and includes 13" {
  # One literal list drives TOTAL_GATES, the scoring loop, the table and the JSON.
  run bash -c "grep -c 'ALL_GATE_NUMBERS=\"' '$PRE_COMMIT'"
  [ "$output" -eq 1 ]

  run bash -c "grep -o 'ALL_GATE_NUMBERS=\"[^\"]*\"' '$PRE_COMMIT'"
  [[ "$output" == *"13"* ]]
  [[ "$output" != *"11 12 13 14"* ]]
}

@test "AC-687-02: no hardcoded gate count survives in the scoring path" {
  # The regression is exactly a stale literal. Two shapes existed before the fix.
  run bash -c "grep -n 'local TOTAL_GATES=12' '$PRE_COMMIT' || true"
  [ -z "$output" ]

  run bash -c "grep -n 'for gate in 1 2 3 4 5 6 7 8 9 10 11 12;' '$PRE_COMMIT' || true"
  [ -z "$output" ]
}

@test "AC-687-03: the console table has a Gate 13 row" {
  # The table is what a human reads; a gate absent from it reads as non-existent.
  run bash -c "grep -c '\"Gate 13: Compiler Strictness\"' '$PRE_COMMIT'"
  [ "$output" -eq 1 ]
}

@test "AC-687-03: the scoring loop derives its range from the single list" {
  # If the loop stops reading $ALL_GATE_NUMBERS it silently drops back to whatever
  # literal it names -- the original defect.
  run bash -c "grep -c 'for gate in \$ALL_GATE_NUMBERS; do' '$PRE_COMMIT'"
  [ "$output" -eq 1 ]
}
