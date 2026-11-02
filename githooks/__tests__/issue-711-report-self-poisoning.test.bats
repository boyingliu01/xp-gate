#!/usr/bin/env bats
#
# @test REQ-711 Pre-commit 报告自污染
# @intent pre-commit 把 `git rev-parse` 的输出直接写进 JSON 报告。在没有提交的
#         仓库里，`git rev-parse --abbrev-ref HEAD` 会先打印 "HEAD" 再以非零退出，
#         于是 `$(cmd || echo unknown)` 捕获到的是 "HEAD\nunknown" —— 两行。
#         它被原样写进 `"branch": "HEAD\nunknown"`，而裸换行不能出现在 JSON 字符串
#         里，报告因此是无效 JSON。
#
#         真正的伤害在下一步：Gate 12 在下一次提交时读取那份报告，报
#         "YAML/JSON syntax errors" 并 BLOCK。也就是说，**门禁阻断了自己写出的
#         文件**，而错误信息指向的报告与用户的改动毫无关系。
#
#         每一个刚 `git init` 的消费仓库，第一次提交都会因为一个与它无关的原因
#         失败一次。这是 0.35.20 发布后实测发现的（见 issue #711）。
#
# @covers AC-711-01, AC-711-02
#
# 说明：这些测试针对源码文本而非运行时，因为该缺陷表现为「某个命令组合会产生
# 多行值」。运行时复现需要一个无提交的仓库 + 完整门禁链（约 60s/次），而源码
# 断言能直接锁住出错的那一处，并在有人把 `|| echo` 写回来时立即失败。

setup() {
    REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
    MIRROR="$REPO_ROOT/src/npm-package/hooks/pre-commit"
}

# 把 `$(git ... || echo X)` 这种形态找出来。git 命令在失败前可能已经写过
# stdout，任何 `|| echo` 都会把回退值追加到已有输出之后。
find_or_echo_git_capture() {
    grep -nE '\$\(git [^)]*\|\| echo' "$1" || true
}

@test "AC-711-01: report fields are never built with \$(git ... || echo ...)" {
    # 这条断言是「缺陷形状」的直接检测。它要能失败：把任一修复点改回
    # COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || echo "unknown") 即红。
    run find_or_echo_git_capture "$PRE_COMMIT"
    if [ -n "$output" ]; then
        echo "发现 \$(git ... || echo ...) 形式（会污染 JSON 报告）："
        echo "$output"
        return 1
    fi
}

@test "AC-711-02: branch and commit are newline-stripped before entering the report" {
    # 即使不复用 `|| echo`，一个多行值也必须被清掉才能进 JSON。
    # 用 -F 固定字符串匹配：这个模式的转义层数多，正则在 bats 里容易失配。
    local count
    count=$(grep -cF "tr -d '\r\n'" "$PRE_COMMIT" || true)
    [ "${count:-0}" -ge 3 ] || {
        echo "期望至少 3 处换行清理（CURRENT_BRANCH 两处 + BRANCH 一处），实际 ${count:-0}"
        return 1
    }

    # 报告写入点必须使用清理后的变量，不能直接用 git 输出
    grep -qF '"branch": "$BRANCH"' "$PRE_COMMIT" || {
        echo "报告未使用 \$BRANCH 变量"
        return 1
    }
}

@test "AC-711-03: the npm mirror carries the same fix" {
    # githooks/ 是源头，src/npm-package/hooks/ 是镜像。只改源头会让发布包
    # 继续带着这个缺陷 —— v0.27.3 正是这样漏发的。
    run find_or_echo_git_capture "$MIRROR"
    if [ -n "$output" ]; then
        echo "镜像仍含 \$(git ... || echo ...)："
        echo "$output"
        return 1
    fi
}
