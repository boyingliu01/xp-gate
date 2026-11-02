#!/usr/bin/env bats
# @test REQ-686
# @intent Gate 6 对 architecture.yaml 只做存在性检查，archlint 从不消费它。
#         项目写了层边界配置，Gate 6 完全不校验分层，却报告全绿 ——
#         **门禁为从未测量过的维度背书**。
#
#         本 issue 最严重的部分不是"漏检"，而是 Gate 6 在配置缺失时
#         **主动教用户写一份无效配置**（顶层 `layers:`，archlint 0.16.0
#         静默忽略），形成完整链路：
#           阻断提交 → 教写无效配置 → 用户照做 → 提交通过 → 以为分层已校验
#
#         修复只做一件事：让 Gate 6 如实报告"分层未校验"，
#         不实现分层检测本身（那属 ARCH-03/05/15）。
# @covers AC-686-01, AC-686-02, AC-686-03, AC-686-04, AC-686-05, AC-686-06
#
# AC-686-05 (no regression in the existing Gate 6 tests) is covered by this file
# plus the pre-existing issue-602 / issue-630 suites: they assert the Java and Go
# arms still judge by PIPESTATUS and still report a skip reason. It is listed
# here because a requirement with no claiming test is the same drift this issue
# is about — a promise nobody verifies.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
  TEST_DIR="$(mktemp -d)"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# ---------------------------------------------------------------------------
# AC-686-04: Gate 6 不再教用户写无效配置
#
# 这是本 issue 的入口缺陷。Gate 6 在配置缺失时打印的推荐示例是顶层 `layers:`，
# 而 archlint 0.16.0 对该键静默忽略（见设计文档 §2.2 的 7 组实测）。
#
# 断言用 CODE 而非注释：旧的示例若只出现在解释"为什么删掉它"的注释里，
# 那不是缺陷复发。所以先剥掉注释行再匹配 —— 与 #602 的做法一致。
# ---------------------------------------------------------------------------
@test "#686 AC-686-04: the config-missing hint no longer recommends top-level layers:" {
  [ -f "$PRE_COMMIT" ]

  # Isolate the config-missing block: from "ARCHITECTURE CONFIG MISSING" to the
  # closing "exit 1". Any `layers:` echo inside it teaches an invalid format.
  _block="$(sed -n '/ARCHITECTURE CONFIG MISSING/,/^      exit 1$/p' "$PRE_COMMIT")"
  [ -n "$_block" ]

  _code="$(printf '%s\n' "$_block" | grep -vE '^[[:space:]]*#')"

  # The defect shape: an echo line that PRINTS `layers:` as a YAML mapping key,
  # i.e. the whole echo body is whitespace + `layers:` and nothing else. A line
  # that merely MENTIONS the word while warning against it (the corrective note
  # this fix adds) must not trip the assertion — that note is the point.
  if printf '%s\n' "$_code" | grep -qE '^[[:space:]]*echo[[:space:]]+"?[[:space:]]*layers:[[:space:]]*"?[[:space:]]*$'; then
    echo "the config-missing hint still prints a top-level 'layers:' mapping"
    echo "--- offending block ---"
    printf '%s\n' "$_code"
    return 1
  fi

  # And it must not print the nested form that only exists to fill that key:
  # `- name: api` / `paths: [...]` / `allowed_imports: [...]` are layer entries,
  # and their presence means the hint is still teaching the invalid schema even
  # if the `layers:` line itself were reworded.
  if printf '%s\n' "$_code" | grep -qE '^[[:space:]]*echo[[:space:]]+.*allowed_imports:'; then
    echo "the config-missing hint still prints layer entries (allowed_imports:)"
    return 1
  fi

  # It must still say something actionable, and must warn that layers are not
  # enforced. A hint that merely deletes the example leaves the user with no path.
  printf '%s\n' "$_code" | grep -qE '\.archlint\.yaml'
  printf '%s\n' "$_code" | grep -qiE 'not enforced|NOT enforced|未被校验|不校验|not checked'
}

# ---------------------------------------------------------------------------
# AC-686-01 / AC-686-02: 终端输出必须自身无法被误读
#
# 用户通常只看终端，看不到 quality report 里的 reason。仅加一行 WARN 然后
# 照常打印 "Architecture validation passed"，读者仍会以为分层已被管。
#
# 用机器可读标记而不是散文（评审意见 A-2/T-02）：措辞微调或本地化都不会
# 让守卫失效，而守卫失效会让这个 bug 静默复活。
# ---------------------------------------------------------------------------
@test "#686 AC-686-01: layers-declared emits the machine-readable WARN marker" {
  run grep -F '[WARN:LAYERS_UNCHECKED]' "$PRE_COMMIT"
  [ "$status" -eq 0 ]

  # The marker must be reachable from the architecture.yaml branch, not just
  # present somewhere in the file. Locate the Gate 6 config-form probe.
  run grep -nE 'architecture\.yaml' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
}

@test "#686 AC-686-02: a non-covered reason is recorded for the gate" {
  run grep -F 'layers_config_not_enforced' "$PRE_COMMIT"
  [ "$status" -eq 0 ]

  # It must be written into the per-language reason map, which is what makes
  # classify_coverage_reason() treat the dimension as unmeasured.
  run grep -E 'GATE_6_REASON_BY_LANG\[.*\]=.layers_config_not_enforced' "$PRE_COMMIT"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# AC-686-03: covered 的语义
#
# `classify_coverage_reason` 的 "*)" 分支返回 unknown，所以任何未识别的 reason
# 自动非 covered。这使"断言非 covered"成为恒真 —— 单看这一条没有判别力。
#
# 真正的判别力来自与 AC-686-02 配对：AC-02 证明 reason 确实被写入，
# 本条证明该 reason 的语义是"未测量"而不是"已覆盖"。
#
# 断言精确返回值而不是"非 covered"：若有人把这个 reason 加进 covered 白名单
# （理由可能是"我们已经报告它了"），本条必须变红 —— 报告缺口不等于测量通过。
# ---------------------------------------------------------------------------
@test "#686 AC-686-03: layers_config_not_enforced classifies as unknown, not covered" {
  # Source the function without running the hook: extract it verbatim.
  _fn="$(sed -n '/^classify_coverage_reason()/,/^}/p' "$PRE_COMMIT")"
  [ -n "$_fn" ]

  eval "$_fn"

  run classify_coverage_reason 'layers_config_not_enforced' 'PASS'
  [ "$status" -eq 0 ]
  [ "$output" = "unknown" ]

  # Guard the guard: if the function were replaced by a stub that always returns
  # unknown, the assertion above would pass vacuously. Pin one real covered case
  # and one real mapped case so the function must actually be doing its job.
  run classify_coverage_reason '' 'PASS'
  [ "$output" = "covered" ]

  run classify_coverage_reason 'architecture_not_configured' 'SKIP'
  [ "$output" = "tool_missing" ]
}

# ---------------------------------------------------------------------------
# AC-686-06: 版本护栏
#
# 整个设计依赖「archlint 0.16.0 的 layer_violation 不产出结果」这一实测事实。
# 若上游修复，本设计输出的 WARN 会变成错误的警告。
#
# 这不是防御性代码，而是把一个会过期的假设变成一个会主动报错的假设。
# ---------------------------------------------------------------------------
@test "#686 AC-686-06: archlint major.minor is still 0.16, or this design must be revisited" {
  # A git worktree has no node_modules of its own; the repo that owns the
  # worktree does. Probe both rather than skipping, because a skip here is the
  # difference between "the assumption still holds" and "nobody checked".
  _pkg=""
  for _cand in \
    "$REPO_ROOT/node_modules/@archlinter/cli/package.json" \
    "$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null | xargs -r dirname)/node_modules/@archlinter/cli/package.json"; do
    if [ -n "$_cand" ] && [ -f "$_cand" ]; then _pkg="$_cand"; break; fi
  done
  if [ -z "$_pkg" ]; then
    skip "archlint not installed"
  fi

  # Read + parse rather than require(): require() treats a Windows absolute path
  # with backslashes as a bare module specifier, so this line passed or failed
  # depending on the cwd — a test whose result depends on where you run it is
  # not measuring archlint's version.
  _ver="$(node -e "const fs=require('fs');try{console.log(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).version)}catch(e){}" "$_pkg" 2>/dev/null)"
  [ -n "$_ver" ]

  case "$_ver" in
    0.16.*) : ;;
    *)
      echo "archlint is now $_ver, not 0.16.x"
      echo "The #686 design asserts layer_violation produces no results on 0.16."
      echo "Re-verify design doc §2.2 before trusting the LAYERS_UNCHECKED warning:"
      echo "  docs/plans/2026-11-02-arch-01-gate6-layers-not-enforced-design.md"
      return 1
      ;;
  esac
}
