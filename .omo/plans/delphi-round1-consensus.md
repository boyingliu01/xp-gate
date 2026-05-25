# Delphi Review — Round 1 Consensus Report

**Document**: `.omo/plans/tdd-enforcement-design.md`
**Mode**: Design Review
**Date**: 2026-05-25

## Expert Verdicts

| Expert | Perspective | Verdict | Confidence |
|--------|------------|---------|------------|
| A | Architecture | REQUEST_CHANGES | 8/10 |
| B | Implementation | REQUEST_CHANGES | 8/10 |
| C | Feasibility | REQUEST_CHANGES | 7/10 |

## Consensus: 13 Issues (All 3 Experts Agree on Direction)

### Critical (Must Fix — 8 issues)

1. **Test-Source 配对多语言覆盖不全** — A✅ B✅ — Go `_test.go`、Java `*Test.java`、Kotlin `*Test.kt` 模式全部缺失
2. **`bc` 依赖不一致** — A✅ B✅ C✅ — 文档说用 awk，代码仍用 bc，且 fallback 导致静默失效
3. **`npx tsx` pre-commit 性能** — A✅ B✅ — 热路径中每个测试文件启动 TSX 子进程
4. **`grep -oP` macOS 不兼容** — B✅ C⚠️ — BSD grep 不支持 `-P`
5. **Test-Source 配对不能验证"测试先写"顺序** — C✅ — 只能验证文件共存，不能验证时间顺序
6. **mock 密度分母定义错误** — A⚠️ C✅ — `mockCount / testLines` 可能 > 100%
7. **`@mock-justified` 注解格式未定义** — B✅ — 需要统一规范格式和内容要求
8. **pre-push 代码片段变量引用错误** — B✅ — `$PUSHED_FILES` 不存在，`xargs grep -l` 用法错误

### Major (Must Address — 5 issues)

9. **Layer 2/3 语义冲突** — A✅ — Gate 5 WARNING vs Gate M ADVISORY 在 30% 阈值不一致
10. **缺少文件排除规则（index/DTO/类型文件）** — A✅ B✅ — 纯聚合文件不应要求配对测试
11. **mock 关键词误报** — A✅ B✅ — `fn()` 和裸词 `mock` 误匹配
12. **`detect-ai-test.ts` 仅支持 TS** — A✅ — Python/Go 测试无法检测
13. **AI agent 会滥用 `@mock-justified`** — C✅ — 需要结构化理由 + audit

### Agreed Fixes

| # | Fix |
|---|-----|
| 1 | 按语言扩展配对：Go `*_test.go`、Java `*Test.java`、Kotlin `*Test.kt`、C++ `*_test.cpp` |
| 2 | 统一用 `awk` 替代 `bc`，删除所有 bc 依赖 |
| 3 | Mock 密度检查改用纯 bash grep（pre-commit），TSX 仅用于 pre-push |
| 4 | `grep -oP` 改为 `grep -o` + `sed` 或 `awk` |
| 5 | 重命名 "TDD VIOLATION" → "TEST PAIRING WARNING"，降级为 WARNING（顺序验证依赖 Agent 引导） |
| 6 | mockDensity = `mockCount / totalNonEmptyNonCommentLines * 100` |
| 7 | 统一格式 `// @mock-justified: <reason>` (min 10 chars) |
| 8 | 修正变量引用为 `$PUSHED_FILES` → 使用 pre-push 实际变量 |
| 9 | 统一语义：Gate 5 30% = ADVISORY, Gate M 30% = ADVISORY, Gate M 50% = BLOCK |
| 10 | 增加排除规则：`index.*`, `types.*`, `*.d.ts`, `interfaces.*`, `constants.*` |
| 11 | 精简 MOCK_KEYWORDS，去除裸词 `mock` 和 `fn()`，改为精确匹配 |
| 12 | 扩展 detect-ai-test.py 到 Python (`unittest.mock`, `MagicMock`, `patch`)，Go 后续 |
| 13 | `@mock-justified` 需要理由文本，Delphi review 时展示所有 justification |
