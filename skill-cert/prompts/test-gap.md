---
name: test-gap
version: 1.0.0
updated: 2026-04-26
---

# Test Gap Filling Prompt

你是一个 AI Skill 测试设计专家。根据以下缺口清单，生成补充测试用例。

## 缺口清单

```
{gap_report}
```

## Skill 语义模型

```
{skill_spec}
```

## 现有测试用例

```
{existing_evals}
```

## 生成要求

- 只生成填补指定缺口的测试，不重复已有测试
- 每个缺口至少生成 1 个测试用例
- 断言必须具体可验证
- 优先级：critical workflow steps > anti-patterns > output format

## 输出格式（严格 JSON）

```json
{
  "new_evals": [
    {
      "id": 5,
      "name": "gap-test-name",
      "category": "normal|boundary|failure",
      "prompt": "...",
      "assertions": [{"name": "...", "type": "contains", "value": "...", "weight": 2}]
    }
  ],
  "gaps_filled": ["gap-1", "gap-2"]
}
```
