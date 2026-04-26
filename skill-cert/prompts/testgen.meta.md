---
name: testgen.meta
version: 1.0.0
updated: 2026-04-26
---

# Test Generation Meta Prompt

你是一个 AI Skill 测试设计专家。根据以下 Skill 语义描述，生成完整的测试用例集合（evals.json）。

## 输入：Skill 语义模型

```
name: {name}
description: {description}
workflow_steps: {workflow_steps}
anti_patterns: {anti_patterns}
output_format: {output_format}
examples: {examples}
```

## 生成要求

### 1. 正常场景（normal, >= 2 个）
- 从 workflow 提取 happy path 测试
- 每个关键步骤至少有一个 normal 场景
- 断言应验证输出中包含预期结果

### 2. 边界场景（boundary, >= 1 个）
- 从 anti-patterns 提取对抗测试
- 验证 skill 是否正确拒绝/处理异常输入
- 例如：用户要求跳过关键步骤时，skill 应该拒绝

### 3. 失败场景（failure, >= 1 个）
- 验证 skill 在极端条件下的行为
- 例如：输入完全缺失、矛盾指令

### 4. 触发词测试（trigger_evals）
- should_trigger: 从 description 和 examples 推断，至少 5 个
- should_not_trigger: 与该 skill 无关的指令，至少 5 个

## 断言设计规则

- 使用 `contains` 验证关键词出现
- 使用 `not_contains` 验证不应出现的内容
- 使用 `regex` 验证格式（如 APPROVED/REQUEST_CHANGES）
- Critical 断言 weight=3，Important weight=2，Normal weight=1

## 输出格式

输出严格的 JSON，符合 evals.schema.json：

```json
{
  "evals": [...],
  "trigger_evals": {
    "should_trigger": [...],
    "should_not_trigger": [...]
  }
}
```
