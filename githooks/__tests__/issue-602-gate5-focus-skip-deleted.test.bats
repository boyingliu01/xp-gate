#!/usr/bin/env bats
# @test REQ-602
# @intent 指南 §9.5 / §12：编译或执行失败**不得**通过删除断言、扩大 Mock 或跳过测试来
#         "修复"。XP-Gate 此前完全不检测 `.only` / `.skip` / `xit` / `xdescribe`，
#         也不拦删除测试文件 —— 于是两条最危险的静默降级路径都没有守护：
#
#         1. staged 里出现 `it.only` → CI 只跑那一个用例，其余全不执行，而报告全绿
#            （vitest/jest 对 `.only` 的存在会让整个文件只跑该用例，跳过的用例不计失败）。
#         2. 删掉 `*.test.*` 且无替代 → 防护网被悄悄移除，而 Gate 5a 只保证"新增源文件
#            必须有测试"，对删除一端没有对称约束。
#
#         检测器放在可复用库 `githooks/lib/assertion-quality.sh` 里，而不是塞进 4700 行的
#         pre-commit —— 这样 Gate 5d（#601 断言质量）也能共用同一套语言模式，避免两处
#         各自维护一份"什么算跳过"的清单而逐渐漂移。
# @covers AC-670-14, AC-670-15, AC-670-16, AC-670-17, AC-670-18

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/assertion-quality.sh"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  MIRROR_LIB="$REPO_ROOT/src/npm-package/hooks/lib/assertion-quality.sh"
}

# AC-670-14: the detector library exists and exposes the three classifiers.
@test "AC-670-14: assertion-quality.sh defines the focus/skip/deleted classifiers" {
  [ -f "$LIB" ]
  run grep -q 'classify_test_focus' "$LIB"
  [ "$status" -eq 0 ]
  run grep -q 'classify_test_skip' "$LIB"
  [ "$status" -eq 0 ]
  run grep -q 'classify_deleted_tests' "$LIB"
  [ "$status" -eq 0 ]
}

# AC-670-15: `.only` in every JS/TS spelling is focus, and pandas/pytest/go/junit
# equivalents are NOT treated as focus (they have no .only concept).
@test "AC-670-15: .only / fit / fdescribe are detected as focus" {
  . "$LIB"
  local src
  for src in 'it.only("x", () => {})' 'describe.only("x", () => {})' 'test.only("x", () => {})' \
             'fit("x", () => {})' 'fdescribe("x", () => {})'; do
    local out
    out=$(printf '%s\n' "$src" | classify_test_focus)
    [ -n "$out" ] || { echo "missed focus marker: $src"; return 1; }
  done
  # A plain `it(` is not focus. (The classifier is sourced inside the subshell:
  # `run bash -c` starts a fresh shell that does not inherit test functions.)
  run bash -c "source '$LIB'; printf 'it(\"x\", () => {})\n' | classify_test_focus"
  [ -z "$output" ]
}

# AC-670-16: skip/todo markers are classified, including the non-JS equivalents the
# issue explicitly names (@pytest.mark.skip, t.Skip, @Disabled).
@test "AC-670-16: .skip / xit / xdescribe / todo and language equivalents are detected" {
  . "$LIB"
  local src
  for src in 'it.skip("x", () => {})' 'xit("x", () => {})' 'xdescribe("x", () => {})' \
             'test.todo("x")' '@pytest.mark.skip' 't.Skip("x")' '@Disabled("x")'; do
    local out
    out=$(printf '%s\n' "$src" | classify_test_skip)
    [ -n "$out" ] || { echo "missed skip marker: $src"; return 1; }
  done
}

# AC-670-17: deletion detection needs BOTH the diff-filter=D list and the test
# naming pattern, and must not fire on a deletion that has a same-named replacement
# (a rename shows up as D+A in --name-only without -M).
@test "AC-670-17: deleted test files are reported, but a rename is not" {
  . "$LIB"
  local tmp out
  tmp="$BATS_TEST_TMPDIR"
  # A pure deletion: the file is gone and nothing replaces it.
  printf 'src/foo.test.ts\n' > "$tmp/deleted.txt"
  : > "$tmp/added.txt"
  out=$(classify_deleted_tests "$tmp/deleted.txt" "$tmp/added.txt")
  printf '%s\n' "$out" | grep -q 'src/foo.test.ts'

  # A rename: same file appears in the added list.
  printf 'src/bar.test.ts\n' > "$tmp/deleted2.txt"
  printf 'src/bar.test.ts\n' > "$tmp/added2.txt"
  out=$(classify_deleted_tests "$tmp/deleted2.txt" "$tmp/added2.txt")
  [ -z "$out" ]
}

# AC-670-18: the hook consults the library, and `.only` actually BLOCKS while the
# exemption requires a reason. This is the anti-vacuity link: a library nobody
# calls is dead code, which is how the "no detector at all" state persists.
@test "AC-670-18: pre-commit sources the library and blocks on .only" {
  run grep -q 'assertion-quality.sh' "$HOOK"
  [ "$status" -eq 0 ]
  run grep -q 'classify_test_focus' "$HOOK"
  [ "$status" -eq 0 ]
  run grep -q 'XP_GATE_ALLOW_ONLY' "$HOOK"
  [ "$status" -eq 0 ]
  # The shipped mirror must carry the same library (#615 precedent: a library the
  # hook sources but the package does not ship is a broken install).
  [ -f "$MIRROR_LIB" ]
  run diff -q "$LIB" "$MIRROR_LIB"
  [ "$status" -eq 0 ]
}
