#!/usr/bin/env bats
# @test REQ-600
# @intent Gate 5 只比较**全局**覆盖率。一个只改 5 行、而这 5 行完全没有测试的提交，
#         只要全局数字没跌破地板就能过 —— 门禁对这次改动唯一度量过的东西，是仓库里
#         其他所有代码的平均值。指南 §10.1/§10.3 要的是三个 XP-Gate 从未算过的数：
#         变更行覆盖率（≥90%）、变更分支覆盖率（≥85%）、模块覆盖率不得下降。
#
#         这里用构造的 coverage-final.json + 构造的变更范围来测，而不是跑真实的
#         vitest —— 差分覆盖率的正确性只取决于两件事：区间归属算得对不对、不可度量时
#         会不会伪装成通过。用真实覆盖率跑这两件事，既慢又会让测试随源码漂移。
#
#         fail-closed 沿用的是 #570 的教训：没有覆盖率文件、JSON 读不动、变更文件在
#         报告里找不到，都属于"没测到"，而"没测到"永远不能渲染成"通过"。唯一的正当
#         缺席是"该文件没有任何可执行语句"（纯常量模块 / .d.ts），它报 n/a 而不是
#         0% —— 记成 0% 会让每一个常量模块都被判失败。
# @covers AC-670-19, AC-670-20, AC-670-21, AC-670-22

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/diff-coverage.sh"
  TMP="$BATS_TEST_TMPDIR"
  . "$LIB"
}

# Build a minimal v8-shaped coverage entry for `lines` (1-based statement starts),
# all hit `hit` times, and a branch on the first line with counts `bcounts`.
mk_entry() {
  local path="$1" hit="$2" nlines="$3" bcounts="$4"
  node -e '
    const [p, hit, n, bc] = process.argv.slice(1);
    const statements = {}, s = {};
    for (let i = 0; i < Number(n); i++) {
      statements[String(i)] = { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 1 } };
      s[String(i)] = Number(hit);
    }
    const branchMap = { "0": { type: "branch", line: 1, loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } } } };
    const b = { "0": bc.split(",").map(Number) };
    console.log(JSON.stringify({ [p]: { path: p, statementMap: statements, s, branchMap, b, fnMap: {}, f: {} } }));
  ' "$path" "$hit" "$nlines" "$bcounts"
}

# AC-670-19: a fully-covered change passes with the documented thresholds.
@test "AC-670-19: changed lines above threshold pass" {
  local cov="$TMP/cov.json" chg="$TMP/chg.txt"
  mk_entry "/abs/repo/src/a.ts" 1 10 "1,1" > "$cov"
  printf 'src/a.ts 1 10\n' > "$chg"
  run compute_diff_coverage "$cov" "$chg" 90 85
  [ "$status" -eq 0 ]
  printf '%s\n' "$output" | grep -q 'RESULT 10 10 100'
}

# AC-670-20: an untested change BLOCKS, and the message names the exact lines so the
# developer does not have to guess which part of the diff failed.
@test "AC-670-20: uncovered changed lines block and are listed individually" {
  local cov="$TMP/cov.json" chg="$TMP/chg.txt"
  # 10 changed lines, 5 executed -> 50%, below the 90% default.
  node -e '
    const statements = {}, s = {};
    for (let i = 0; i < 10; i++) {
      statements[String(i)] = { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 1 } };
      s[String(i)] = i < 5 ? 1 : 0;
    }
    console.log(JSON.stringify({ "/a/src/a.ts": { path: "/a/src/a.ts", statementMap: statements, s, branchMap: {}, b: {}, fnMap: {}, f: {} } }));
  ' > "$cov"
  printf 'src/a.ts 1 10\n' > "$chg"
  run compute_diff_coverage "$cov" "$chg" 90 85
  [ "$status" -eq 1 ]
  printf '%s\n' "$output" | grep -q 'RESULT 5 10 50'
  # Every uncovered line is named.
  printf '%s\n' "$output" | grep -q 'UNCOVERED src/a.ts 6 7 8 9 10'
}

# AC-670-21: only changed lines count. A file with 100 statements where only line 50
# changed must be judged on line 50 alone -- otherwise the gate is measuring the
# repo average again, which is the defect.
@test "AC-670-21: only the changed line ranges are scored, not the whole file" {
  local cov="$TMP/cov.json" chg="$TMP/chg.txt"
  # Statement 50 (line 50) is covered; everything else is not.
  node -e '
    const statements = {}, s = {};
    for (let i = 1; i <= 100; i++) {
      statements[String(i)] = { start: { line: i, column: 0 }, end: { line: i, column: 1 } };
      s[String(i)] = i === 50 ? 1 : 0;
    }
    console.log(JSON.stringify({ "/a/src/a.ts": { path: "/a/src/a.ts", statementMap: statements, s, branchMap: {}, b: {}, fnMap: {}, f: {} } }));
  ' > "$cov"
  printf 'src/a.ts 50 50\n' > "$chg"
  run compute_diff_coverage "$cov" "$chg" 90 85
  [ "$status" -eq 0 ]
  printf '%s\n' "$output" | grep -q 'RESULT 1 1 100'
}

# AC-670-22: fail-closed. Missing coverage, unparsable coverage, and a changed file
# the report does not know are all "not measured" -> never a pass. And a file with
# no executable statements is n/a, not 0%.
@test "AC-670-22: unmeasurable inputs fail closed; a non-executable file is n/a, not 0%" {
  local cov="$TMP/cov.json" chg="$TMP/chg.txt"

  # (a) No coverage file at all.
  printf 'src/a.ts 1 5\n' > "$chg"
  run compute_diff_coverage "$TMP/nope.json" "$chg" 90 85
  [ "$status" -eq 2 ]
  printf '%s\n' "$output" | grep -q 'ERROR no_coverage_data'

  # (b) Unparsable JSON.
  printf 'not json' > "$cov"
  run compute_diff_coverage "$cov" "$chg" 90 85
  [ "$status" -eq 2 ]
  printf '%s\n' "$output" | grep -q 'ERROR unparsable_coverage'

  # (c) Changed file absent from the report -> MISSING, and the aggregate has no
  # evidence, so it must not silently pass on 0/0.
  mk_entry "/a/src/other.ts" 1 3 "1,1" > "$cov"
  run compute_diff_coverage "$cov" "$chg" 90 85
  printf '%s\n' "$output" | grep -q 'MISSING src/a.ts'

  # (d) A file with zero statements in the changed range is n/a: scoring it 0% would
  # block every constants module.
  # Keyed BY PATH, like the real coverage-final.json (a bare entry object would
  # make every lookup miss and turn this case into a redundant MISSING check).
  printf '{"%s":{"path":"%s","statementMap":{},"s":{},"branchMap":{},"b":{},"fnMap":{},"f":{}}}'     "/a/src/const.ts" "/a/src/const.ts" > "$cov"
  printf 'src/const.ts 1 5\n' > "$chg"
  run compute_diff_coverage "$cov" "$chg" 90 85
  [ "$status" -eq 0 ]
  printf '%s\n' "$output" | grep -q 'NA src/const.ts'
}

# Thresholds come from test-profile.yaml, falling back to the 指南 defaults (90/85).
@test "AC-670-19b: thresholds default to 90/85 and can be overridden by the profile" {
  cd "$TMP"
  [ "$(diff_coverage_threshold diff_coverage_lines 90)" = "90" ]
  [ "$(diff_coverage_threshold diff_coverage_branches 85)" = "85" ]
  mkdir -p .xp-gate
  printf 'diff_coverage_lines: 70\ndiff_coverage_branches: 60\n' > .xp-gate/test-profile.yaml
  [ "$(diff_coverage_threshold diff_coverage_lines 90)" = "70" ]
  [ "$(diff_coverage_threshold diff_coverage_branches 85)" = "60" ]
  # A malformed value falls back rather than becoming 0 (which would pass anything).
  printf 'diff_coverage_lines: not-a-number\n' > .xp-gate/test-profile.yaml
  [ "$(diff_coverage_threshold diff_coverage_lines 90)" = "90" ]
}
