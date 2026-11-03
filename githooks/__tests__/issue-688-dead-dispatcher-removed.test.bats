#!/usr/bin/env bats
#
# @test REQ-716
# @intent 无调用方的死分派器必须被删除，而不是留在仓库里假装存在一条适配器路由链路
# @covers AC-716-01 AC-716-02 AC-716-03 AC-716-04 AC-716-05
#
# #688 的前提是「适配器里有写好的 run_architecture，只是没接上」。实测不成立：
# Gate 6 早已在 pre-commit 里内联实现了 Python import-linter 与 Go arch-go，
# 且比适配器版本更完善（Python 多查 3 种配置载体、工具缺失直接 BLOCK 而非
# `return 0` 静默跳过、Go 用 PIPESTATUS[0] 正确取退出码）。接上适配器版本
# 会是一次行为倒退。
#
# 因此选方案 C：删除死代码，并留下注释说明「Gate 6 已内联实现」。
# 本文件钉住「删除确实发生了」，以及「没有被误删的活代码复活」。
#
# Test names are ASCII on purpose: BATS 1.x cannot parse non-ASCII test names.

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"

# AC-716-01: route_to_adapter 不得再存在于权威源
@test "#688 AC-716-01: adapter-common.sh no longer defines the uncalled route_to_adapter" {
  run grep -n "^route_to_adapter() {" "$REPO_ROOT/githooks/adapter-common.sh"
  [ "$status" -ne 0 ]
}

# AC-716-02: 两个 run_architecture 不得再存在
@test "#688 AC-716-02: python.sh no longer defines the never-invoked run_architecture" {
  run grep -n "^run_architecture() {" "$REPO_ROOT/githooks/adapters/python.sh"
  [ "$status" -ne 0 ]
}

@test "#688 AC-716-02: go.sh no longer defines the never-invoked run_architecture" {
  run grep -n "^run_architecture() {" "$REPO_ROOT/githooks/adapters/go.sh"
  [ "$status" -ne 0 ]
}

# AC-716-03: 删除必须留下理由，否则下一个人会以为是漏掉了
@test "#688 AC-716-03: adapter-common.sh records why route_to_adapter was removed (mentions 688)" {
  run grep -n "688" "$REPO_ROOT/githooks/adapter-common.sh"
  [ "$status" -eq 0 ]
}

@test "#688 AC-716-03: adapters say architecture checks live in Gate 6 instead" {
  run grep -in "Gate 6" "$REPO_ROOT/githooks/adapters/python.sh" "$REPO_ROOT/githooks/adapters/go.sh"
  [ "$status" -eq 0 ]
}

# AC-716-04: 被删除的只是死代码 —— 活函数必须还在
@test "#688 AC-716-04: detect_project_lang is still present (it is a live helper)" {
  run grep -n "^detect_project_lang() {" "$REPO_ROOT/githooks/adapter-common.sh"
  [ "$status" -eq 0 ]
}

@test "#688 AC-716-04: check_if_tool_available is still present" {
  run grep -n "^check_if_tool_available() {" "$REPO_ROOT/githooks/adapter-common.sh"
  [ "$status" -eq 0 ]
}

# AC-716-05: 同步副本必须一致
@test "#688 AC-716-05: githooks and npm-package adapter-common.sh stay byte-identical" {
  run diff "$REPO_ROOT/githooks/adapter-common.sh" "$REPO_ROOT/src/npm-package/adapter-common.sh"
  [ "$status" -eq 0 ]
}

@test "#688 AC-716-05: githooks and npm-package hooks/adapter-common.sh stay byte-identical" {
  run diff "$REPO_ROOT/githooks/adapter-common.sh" "$REPO_ROOT/src/npm-package/hooks/adapter-common.sh"
  [ "$status" -eq 0 ]
}
