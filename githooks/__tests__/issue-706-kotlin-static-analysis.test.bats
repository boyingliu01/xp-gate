#!/usr/bin/env bats
# @test REQ-706
# @intent kotlin-gate 的夹具缺 hook-module-resolution.sh 和整个 lib/，hook 在跑进任何
#         gate 之前就 FATAL，断言只能靠 skip 通过；补上之后又暴露了更深的一层：
#         adapter 在构建工具失败时提前 return，把能独立工作的 detekt 一起吞掉。
#
#         三层，按依赖顺序：
#         1. 夹具缺 hook-module-resolution.sh → FATAL，一个 gate 都没跑；
#         2. 夹具缺 lib/ → FATAL: cannot load .../lib/now-ms.sh；
#         3. run_static_analysis 在 Gradle/Maven 编译失败时 `return 1`，检测器
#            detekt（不依赖构建，直接读 .kt）从未被调用，而 hook 把这一状态
#            报成「SKIPPED - tools unavailable」——检测器没运行，与「没有违规」
#            无法区分。此外 ktlint 在 1.8.0 下 `**/*.kt` 匹配不到文件却 exit 0，
#            `elif` 链因此让 detekt 永远轮不到。
#
#         测试用 PATH shim 精确控制「哪些工具可用、可用到什么程度」，因此结论
#         不依赖跑测试的机器上装了什么——这正是原测试在 CI 上一直 skip、在装了
#         detekt 的机器上才暴露的原因。
#
# @covers AC-706-01, AC-706-02, AC-706-03, AC-706-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/kotlin.sh"
  ORIG_PATH="$PATH"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/shim"
  cd "$WORK" || return 1
}

teardown() {
  cd /
  rm -rf "$WORK"
}

# 造一个可执行的假工具：$1=名字，$2=退出码，$3=标准输出。
make_shim() {
  local name="$1" rc="$2" out="${3:-}"
  {
    printf '#!/bin/sh\n'
    [ -n "$out" ] && printf 'printf "%%s\\n" %s\n' "$(printf '%q' "$out")"
    printf 'exit %s\n' "$rc"
  } > "shim/$name"
  chmod +x "shim/$name"
}

# 运行 adapter 的 run_static_analysis，PATH 只含 shim + 基础工具。
# 用 source 而不是调用 hook：被测的是 adapter 的判定，不是 hook 的编排。
run_adapter() {
  PATH="$WORK/shim:$ORIG_PATH" bash -c "source '$ADAPTER'; run_static_analysis; echo \"__RC=\$?\""
}

@test "AC-706-01: a failed build does not stop an independent analyzer from running" {
  # 这是 #706 第 3 层的核心：构建失败 ≠ 所有检查都做不了。
  # gradle 失败，detekt 发现了真实违规 —— detekt 必须被调用，结论必须被采纳。
  printf 'plugins { id "org.jetbrains.kotlin.jvm" version "1.9.0" }\n' > build.gradle
  printf 'fun bad() {\n    val x = 12345\n}\n' > BadCode.kt
  make_shim gradle 1 "BUILD FAILED"
  make_shim detekt 1 "BadCode.kt:2:13: This expression contains a magic number. [MagicNumber]"

  run run_adapter
  # detekt 的发现必须在输出里，且判定为非 0（会阻断）。
  [[ "$output" == *"MagicNumber"* ]]
  [[ "$output" == *"__RC=1"* ]]
}

@test "AC-706-02: a ktlint that matches no files does not silence detekt" {
  # ktlint 1.8.0 对 `**/*.kt` 报 "No files matched" 且 exit 0。旧实现用 elif 链，
  # 于是「命令存在但一个文件都没看」被当成「代码干净」，detekt 永远轮不到。
  printf 'plugins { id "org.jetbrains.kotlin.jvm" version "1.9.0" }\n' > build.gradle
  printf 'fun bad() {\n    val x = 12345\n}\n' > BadCode.kt
  make_shim gradle 0 ""
  make_shim ktlint 0 "No files matched [**/*.kt]"
  make_shim detekt 1 "BadCode.kt:2:13: magic number. [MagicNumber]"

  run run_adapter
  [[ "$output" == *"MagicNumber"* ]]
  [[ "$output" == *"__RC=1"* ]]
}

@test "AC-706-03: when no analyzer can reach a verdict the result is SKIP, not PASS" {
  # 零工具时必须明确说出「没检查」，而不是返回 0 让人以为通过了。
  # PATH 收窄到 shim 目录 + 系统基础路径，确保本机装的 detekt/ktlint 不参与，
  # 否则这个断言只是在测「我这台机器装了什么」。
  printf 'plugins { id "org.jetbrains.kotlin.jvm" version "1.9.0" }\n' > build.gradle
  printf 'fun ok() {}\n' > Good.kt
  make_shim gradle 0 ""

  run env PATH="$WORK/shim:/usr/bin:/bin" bash -c "source '$ADAPTER'; run_static_analysis; echo \"__RC=\$?\""
  [[ "$output" == *"No Kotlin lint tools"* ]]
}

@test "AC-706-04: a clean detekt run still passes" {
  # 反向守护：不能把「构建失败」变成永久 BLOCK。
  # 构建成功且 detekt 无违规时，判定必须是 0。
  printf 'plugins { id "org.jetbrains.kotlin.jvm" version "1.9.0" }\n' > build.gradle
  printf 'fun ok() {}\n' > Good.kt
  make_shim gradle 0 ""
  make_shim detekt 0 ""

  run run_adapter
  [[ "$output" == *"__RC=0"* ]]
}
