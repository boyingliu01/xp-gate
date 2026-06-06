# tool-descriptions.md — Ralph Loop 各步骤工具链（AHE 组件分解）

> **本文是 `skills/ralph-loop/SKILL.md` 中构建步骤的 AHE 对齐展开。**

## 组件职责

描述 Ralph Loop 中每个 REQ 执行的具体工具链：TDD 流、回归测试、成本监控。

## 构建步骤

| 步骤 | 动作 | 说明 |
|------|------|------|
| 1 | 加载当前 REQ | 从 specification.yaml 获取下一个 READY REQ |
| 2 | 加载 learnings | 从 progress.log 加载 permanent + contextual learnings |
| 3 | 测试基础设施检查 | 检查 test-utils.ts 是否存在且导出 createTestApp()、withTestDb()。不存在 → dispatch test-infra subagent，retry max 2，失败 → BLOCK/fallback |
| 4 | TDD (RED→GREEN→REFACTOR) | test-driven-development skill（含 TDD 铁律 + Mock 边界注入）|
| 5 | 全量回归测试 | 运行全部现有测试 |
| 6 | 测试先行比率检查 (L1b) | 新增测试行数 / (新增测试 + 新增实现) ≥ 40% |
| 7 | 记录 progress.log | 将 learnings 分类存储 (permanent/contextual) |
| 8 | 成本检查 | token 使用量是否超阈值 |
| 9 | 完成/继续 | 所有 REQ 完成 → 结束；否则 → 下一个 REQ |

## 语言特定

通过 `--lang` 注入对应 TDD skill: `springboot-tdd`, `django-tdd`, `golang-testing`

## AHE 分类

| 字段 | 值 |
|------|---|
| 组件类型 | Tool Description |
| 修改频率预期 | 高 |
