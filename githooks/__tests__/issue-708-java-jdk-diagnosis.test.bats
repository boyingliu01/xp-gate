#!/usr/bin/env bats
# @test REQ-708
# @intent Java 构建失败有一个极其常见且极易误判的成因：用错了 JDK。
#         构建工具把真实原因藏在 `tail -20` 的构建输出里，而 Gate 9 自己的判定行
#         只打印「❌ Java build failed (exit 1)」，不含任何环境线索。
#
#         实测教训：pom 里写 maven.compiler.release=8，用 JDK 8 构建时 maven 把
#         --release 8 传给 javac，而 --release 是 JDK 9 才引入的开关，于是失败信息是
#         「无效的标记: --release」。这句话指向编译器参数、指向项目配置，实际上指向
#         环境里的 JDK —— 三者之间需要一次推理，而推理的起点（判定行）恰恰什么都没说。
#         排查者因此先怀疑 release 配置、再怀疑 plugin 版本、再怀疑 .mvn/jvm.config，
#         全是错的，真正的解法只是换一个 JDK。
#
#         判定标准：失败时「是不是 JDK 的问题」必须是第一个能看到的假设。
#
#         测试直接调用诊断函数并断言其**输出**，不断言源码文本——断言源码只能证明
#         那句话被写进了文件，不能证明用户会在失败时看到它。
#
# @covers AC-708-01, AC-708-02, AC-708-03, AC-708-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
  WORK="$(mktemp -d)"
  cd "$WORK" || return 1
  # 抽取诊断函数本体（按函数边界，不按行号——行号会被无关编辑悄悄挪走）。
  awk '/^java_bi_report_jdk_context\(\) \{/{f=1} f{print} f&&/^\}$/{exit}' "$PRE_COMMIT" \
    > "$WORK/jdk_diag.sh"
  [ -s "$WORK/jdk_diag.sh" ]
}

teardown() {
  cd /
  rm -rf "$WORK"
}

# 在给定构建输出下运行诊断，返回其 stdout。
diag() {
  bash -c ". '$WORK/jdk_diag.sh'; java_bi_report_jdk_context \"\$1\"" _ "$1"
}

@test "AC-708-01: a failed Java build reports the JDK actually in use" {
  # 最低限度：失败分支必须让用户看到「当前用的是哪个 JDK」，
  # 让「是不是 JDK 的问题」成为第一个能看到的假设，而不是最后一个。
  run diag "BUILD FAILURE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"JDK in use"* ]]
  [[ "$output" == *"JAVA_HOME"* ]]
}

@test "AC-708-02: the project's declared JDK floor is read and shown" {
  # 光知道「当前是什么」不够，还要知道「项目要什么」。两者一起打印，用户才能
  # 自己完成那次推理。Maven 侧读 maven.compiler.release（其次 source）。
  cat > pom.xml <<'POM'
<project>
  <properties>
    <maven.compiler.release>8</maven.compiler.release>
  </properties>
</project>
POM

  run diag "BUILD FAILURE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Project requires"* ]]
  [[ "$output" == *"maven.compiler.release=8"* ]]
}

@test "AC-708-03: a --release rejection names the JDK 9 floor explicitly" {
  # 「无效的标记: --release」的成因是 JDK 8 及以下不支持 --release。构建输出里
  # 出现这个特征时，直接给出结论性提示，而不是让用户自己去搜。
  cat > pom.xml <<'POM'
<project><properties><maven.compiler.release>8</maven.compiler.release></properties></project>
POM

  run diag "[ERROR] Fatal error compiling: 无效的标记: --release"
  [ "$status" -eq 0 ]
  [[ "$output" == *"--release"* ]]
  # 必须点名 JDK 9 这个下限（而不是含糊地说「版本太低」）。
  [[ "$output" == *"JDK 9"* ]]
}

@test "AC-708-04: a failure unrelated to the JDK does not claim a JDK problem" {
  # 反向守护：不能把每一次构建失败都说成 JDK 问题，否则这条提示会变成噪音，
  # 用户学会忽略它——比不打印更糟。
  cat > pom.xml <<'POM'
<project><properties><maven.compiler.release>17</maven.compiler.release></properties></project>
POM

  run diag "[ERROR] cannot find symbol: class Foo"
  [ "$status" -eq 0 ]
  [[ "$output" != *"JDK 9"* ]]
  # 但 JDK 上下文本身仍应打印（用户仍可能是在排查环境）。
  [[ "$output" == *"JDK in use"* ]]
}
