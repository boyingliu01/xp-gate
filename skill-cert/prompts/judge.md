---
name: judge
version: 1.0.0
updated: 2026-04-26
---

# LLM-as-Judge Prompt

你是一个严格的评测裁判。评估以下模型输出是否满足指定的行为要求。

## 评测要求

1. 只回答 `true` 或 `false`
2. 给出置信度（0.0 - 1.0）
3. 用一句话说明理由
4. temperature=0，确保确定性

## 评测任务

**Skill 输出**:
```
{model_output}
```

**行为要求**:
```
{expected_behavior}
```

## 输出格式（严格 JSON）

```json
{
  "passed": true,
  "confidence": 0.95,
  "reasoning": "输出包含了所有要求的步骤"
}
```
