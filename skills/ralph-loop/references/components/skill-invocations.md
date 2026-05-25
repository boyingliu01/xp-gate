# skill-invocations.md — Ralph Loop 技能调用（AHE 组件分解）

> **本文是 `skills/ralph-loop/SKILL.md` 中技能调用链的 AHE 对齐展开。**

## 组件职责

提供 Ralph Loop 在每个 REQ 执行中的技能调用链。

## 完整调用链

| 步骤 | Skill | 来源 | 参数 |
|------|-------|------|------|
| 0 | 测试基础设施检查 | 内置 | 检查 test-utils.ts 存在性 + 接口契约（createTestApp, withTestDb）|
| 1 | `test-driven-development` | superpowers | `--lang` 注入 + TDD 铁律 + Mock 边界（覆盖默认策略）|
| 2 | `learn` | gstack | classification: permanent/contextual |
| 3 | `requesting-code-review` | superpowers | REQ 完成后评审 |

## test-infra dispatch 节点

当 test-utils.ts 不存在或接口缺失时：

```
task(category="unspecified-high", load_skills=["test-driven-development"], prompt="生成测试基础设施：createTestApp() + withTestDb()。TDD 铁律：先写测试再实现。")
```

- retry max 2 次
- 仍失败 → BLOCK 或 fallback inline 生成（记录 warning）
- 成功后与业务代码合并为同一 commit

## 上游依赖

从 `specification.yaml` 获取 REQ 列表（由 `to-issues` skill 生成）

## AHE 分类

| 字段 | 值 |
|------|---|
| 组件类型 | Skill Invocation Chain |
| 修改频率预期 | 中 |
