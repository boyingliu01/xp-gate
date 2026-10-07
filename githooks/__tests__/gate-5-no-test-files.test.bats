#!/usr/bin/env bats
# @test REQ-498
# @intent Gate 5 不能把 vitest 的 "No test files found" 当成测试失败：#454 分类了
#         runner EPERM、#473 分类了 partial 阈值未达，但第三条非失败退出路径没人管 ——
#         没有测试文件的 TS 项目（以及目标全部落在 exclude 里的 partial 运行）让 vitest
#         打印 "No test files found, exiting with code 1" 并退出 1，handle_test_failure
#         落到 fail-closed 分支报 "❌ BLOCKED - Tests FAILED"，提交被一个并没有发生的
#         失败掐断（#498）。githooks/__tests__/gate-5a-block.test.bats 的 14 条用例全部
#         死在 setup 的初始提交上，撞的就是这条。本套件 source 生产 lib 并**执行**判决
#         函数，同时锁住措辞：SKIP 可以，宣称 PASS 不行。
# @covers AC-498-01, AC-498-02, AC-498-03, AC-498-04, AC-498-05

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/test-failure.sh"
  SHIPPED_LIB="$REPO_ROOT/src/npm-package/hooks/lib/test-failure.sh"
}

# vitest 5 (this repo's Windows run) and vitest 1 both print the same marker line.
NO_TESTS_VITEST_5=' RUN  v5.0.3 C:/Users/think/AppData/Local/Temp/tmp.Q4UOVTrr72

No test files found, exiting with code 1

include: **/*.{test,spec}.?(c|m)[jt]s?(x)
exclude:  **/node_modules/**, **/.git/**'

NO_TESTS_VITEST_1='No test files found, exiting with code 1

include: **/*.{test,spec}.?(c|m)[jt]s?(x)
exclude:  **/node_modules/**'

# Bounded verdict markers ("verdict:N:end") rather than a bare "exit=N": a
# missing function returns 127, and an unbounded assertion on "exit=1" would
# read that as the expected verdict and turn a false RED into a false GREEN.

@test "AC-498-01: No test files found is not a test failure" {
  run bash -c "
    source '$LIB'
    is_no_test_files_found \"\$1\"
    echo \"verdict:\$?:end\"
  " bash "$NO_TESTS_VITEST_5"
  [[ "$output" == *"verdict:0:end"* ]]

  run bash -c "
    source '$LIB'
    is_no_test_files_found \"\$1\"
    echo \"verdict:\$?:end\"
  " bash "$NO_TESTS_VITEST_1"
  [[ "$output" == *"verdict:0:end"* ]]
}

@test "AC-498-02: a real failure marker still wins over the no-tests marker" {
  # Fail-closed: a partial run can both fail a test and report no files for
  # another target; the commit must block.
  run bash -c "
    source '$LIB'
    is_no_test_files_found \"\$1\"
    echo \"verdict:\$?:end\"
  " bash "No test files found, exiting with code 1
FAIL  src/foo.test.ts > foo
Tests  1 failed (1)"
  [[ "$output" == *"verdict:1:end"* ]]
}

@test "AC-498-03: ordinary output is not read as no-tests" {
  run bash -c "
    source '$LIB'
    is_no_test_files_found \"\$1\"
    echo \"verdict:\$?:end\"
  " bash 'Test Files  2 passed (2)
Tests  20 passed (20)'
  [[ "$output" == *"verdict:1:end"* ]]

  run bash -c "
    source '$LIB'
    is_no_test_files_found \"\$1\"
    echo \"verdict:\$?:end\"
  " bash ''
  [[ "$output" == *"verdict:1:end"* ]]

  # The marker is vitest's own sentence, not a loose substring: a test title
  # that happens to contain the phrase describes a run that DID collect files.
  run bash -c "
    source '$LIB'
    is_no_test_files_found \"\$1\"
    echo \"verdict:\$?:end\"
  " bash 'Test Files  1 passed (1)
Tests  1 passed (1)
stdout | src/report.test.ts > prints "No test files found" for empty input'
  [[ "$output" == *"verdict:1:end"* ]]
}

@test "AC-498-04: handle_test_failure skips the no-tests exit without claiming PASS" {
  run bash -c "
    source '$LIB'
    TESTS_EXIT_CODE=1
    TESTS_SKIPPED=false
    handle_test_failure \"\$1\" 'full test suite'
    echo \"returned:\$?:end\"
    echo \"skipped:\$TESTS_SKIPPED\"
    echo \"exit_code:\$TESTS_EXIT_CODE\"
  " bash "$NO_TESTS_VITEST_5"
  [[ "$output" == *"returned:0:end"* ]]
  [[ "$output" == *"skipped:true"* ]]
  [[ "$output" == *"exit_code:0"* ]]
  # Never claims the suite passed -- it ran nothing.
  [[ "$output" != *"BLOCKED"* ]]
  [[ "$output" != *"PASSED"* ]]

  # A partial run with the same exit is excused too.
  run bash -c "
    PARTIAL_TEST_RUN=true
    source '$LIB'
    TESTS_EXIT_CODE=1
    handle_test_failure \"\$1\" 'changed test files'
    echo \"returned:\$?:end\"
  " bash "$NO_TESTS_VITEST_1"
  [[ "$output" == *"returned:0:end"* ]]
}

@test "AC-498-05: anti-vacuity -- both shipped copies define, use and match the classifier" {
  for copy in "$LIB" "$SHIPPED_LIB"; do
    [ -f "$copy" ] || { echo "missing $copy" >&2; return 1; }
    grep -q '^is_no_test_files_found()' "$copy" || { echo "no classifier in $copy" >&2; return 1; }
    grep -q 'is_no_test_files_found "\$_out"' "$copy" || { echo "classifier never called in $copy" >&2; return 1; }
  done
  cmp -s "$LIB" "$SHIPPED_LIB" || { echo "shipped copy drifted from canonical" >&2; return 1; }
}
