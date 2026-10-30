#!/usr/bin/env bats
# @test REQ-601
# @intent 指南 §9.2「断言质量」禁止六类断言反模式，而 XP-Gate 此前对断言本身**零检查**：
#         mock 密度（Gate M2）和 mock 分层（Gate M3）都在看"怎么造替身"，没人看"断言是否
#         真的是断言"。于是 `expect(true).toBe(true)`、`catch {}` 空吞、只断言 mock 自己
#         返回的值——这些让测试恒绿却什么都没验证的写法——一路通行，
#         而 `testing-anti-patterns.md` 里的五条反模式只是文档建议，无法阻断。
#
#         分级是刻意的：恒真断言与空 catch 是**确定**的空测试，直接 BLOCK；只断言
#         `toBeDefined()`、只断言 mock 返回值、过量 `toHaveBeenCalledWith` 则可能是
#         合理写法（结构探测、契约测试），只 WARN 并计入 Gate 5 报告。把可疑但合法的
#         写法也阻断，会训练大家去加白名单注解，注解就失去意义了 —— #602 的
#         `@skip-justified` 是同一个设计意图。
#
#         每条检测都必须能追溯到 `testing-anti-patterns.md` 的一条反模式，这样 reviewer
#         看到门禁消息就知道去查哪一节。检测器复用 #602 的 `assertion-quality.sh`：
#         "什么算跳过"和"什么算空断言"如果各存一份，两份都会漂移而各自看起来都对。
# @covers AC-670-08, AC-670-09, AC-670-10, AC-670-11, AC-670-12, AC-670-13

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/assertion-quality.sh"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  ANTI="$REPO_ROOT/skills/test-driven-development/testing-anti-patterns.md"
}

# AC-670-08: the blocking classifiers exist and are named for the anti-pattern they
# enforce, so a gate message can cite the doc section.
@test "AC-670-08: assertion-quality.sh defines the blocking and warning classifiers" {
  [ -f "$LIB" ]
  run grep -q 'classify_tautological_assertions' "$LIB"
  [ "$status" -eq 0 ]
  run grep -q 'classify_swallowed_errors' "$LIB"
  [ "$status" -eq 0 ]
  run grep -q 'classify_weak_assertions' "$LIB"
  [ "$status" -eq 0 ]
}

# AC-670-09: tautologies are caught in their real spellings, and a real assertion is
# not.
@test "AC-670-09: tautological assertions are detected, real ones are not" {
  . "$LIB"
  local src out
  for src in 'expect(true).toBe(true);' 'expect(1).toBe(1);' 'expect(false).toBeFalsy();' \
             'expect("x").toBeTruthy();' 'expect(0).toBe(0);'; do
    out=$(printf '%s\n' "$src" | classify_tautological_assertions)
    [ -n "$out" ] || { echo "missed tautology: $src"; return 1; }
  done
  # A genuine assertion must pass clean.
  out=$(printf 'expect(result).toBe(42);\n' | classify_tautological_assertions)
  [ -z "$out" ]
}

# AC-670-10: an empty catch inside a test body swallows the failure. A catch that
# asserts or rethrows is legitimate and must not be flagged.
@test "AC-670-10: empty catch is detected, a catch that asserts is not" {
  . "$LIB"
  local out
  out=$(printf 'try { f(); } catch {}\n' | classify_swallowed_errors)
  [ -n "$out" ]
  out=$(printf 'try { f(); } catch (e) { expect(e).toBeDefined(); }\n' | classify_swallowed_errors)
  [ -z "$out" ]
  out=$(printf 'try { f(); } catch (e) { throw e; }\n' | classify_swallowed_errors)
  [ -z "$out" ]
}

# AC-670-11: the warning tier detects a test whose ONLY assertion is a weak one, and
# does not fire when a real assertion accompanies it. This is the "only" in the
# issue's wording: `toBeDefined()` alone is a smell, `toBeDefined()` plus
# `toBe(42)` is normal defensive checking.
@test "AC-670-11: weak-only assertion blocks are warned, mixed ones are not" {
  . "$LIB"
  local out
  out=$(printf 'it("x", () => {\n  expect(fn()).toBeDefined();\n});\n' | classify_weak_assertions)
  [ -n "$out" ]
  out=$(printf 'it("x", () => {\n  expect(fn()).toBeDefined();\n  expect(fn()).toBe(42);\n});\n' | classify_weak_assertions)
  [ -z "$out" ]
}

# AC-670-12: `@assertion-justified: <reason>` mirrors `@mock-justified` semantics --
# the annotation is only an exemption WITH a reason of >= 10 non-space characters.
@test "AC-670-12: @assertion-justified requires a reason, like @mock-justified" {
  . "$LIB"
  run grep -q 'is_assertion_justified' "$LIB"
  [ "$status" -eq 0 ]
  # Too short: not justified.
  run bash -c "source '$LIB'; is_assertion_justified '// @assertion-justified: short'"
  [ "$status" -ne 0 ]
  # No annotation at all: not justified.
  run bash -c "source '$LIB'; is_assertion_justified 'expect(true).toBe(true)'"
  [ "$status" -ne 0 ]
  # A real reason: justified.
  run bash -c "source '$LIB'; is_assertion_justified '// @assertion-justified: asserting the constant is the subject here'"
  [ "$status" -eq 0 ]
}

# AC-670-13: anti-vacuity -- the hook consults the Gate 5d classifiers, only staged
# test files are scanned, and every detector cites the doc it enforces.
@test "AC-670-13: pre-commit wires Gate 5d and only scans changed test files" {
  run grep -q 'Gate 5d' "$HOOK"
  [ "$status" -eq 0 ]
  run grep -q 'classify_tautological_assertions' "$HOOK"
  [ "$status" -eq 0 ]
  # The scan population is the staged set (diff --cached), never the whole tree.
  run grep -q 'diff --cached --name-only' "$HOOK"
  [ "$status" -eq 0 ]
  # Each detector names the anti-pattern doc section it enforces, so a reviewer can
  # trace a block back to the rule.
  [ -f "$ANTI" ]
  run grep -q 'testing-anti-patterns' "$HOOK"
  [ "$status" -eq 0 ]
}
