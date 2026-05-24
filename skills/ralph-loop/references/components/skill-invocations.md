# skill-invocations.md — Ralph Loop 技能调用（AHE 组件分解）

> **本文是 `skills/ralph-loop/SKILL.md` 中技能调用链的 AHE 对齐展开。**

## 组件职责

提供 Ralph Loop 在每个 REQ 执行中的技能调用链。

## 完整调用链

| 步骤 | Skill | 来源 | 参数 |
|------|-------|------|------|
| 1 | `test-driven-development` | superpowers | `--lang` 注入 |
| 2 | `learn` | gstack | classification: permanent/contextual |
| 3 | `requesting-code-review` | superpowers | REQ 完成后评审 |

## 上游依赖

从 `slices-manifest.json` 获取 REQ 列表（由 `to-issues` skill 生成）

## AHE 分类

| 字段 | 值 |
|------|---|
| 组件类型 | Skill Invocation Chain |
| 修改频率预期 | 中 |
