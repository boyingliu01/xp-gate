# memory.md — Ralph Loop 状态与记忆结构（AHE 组件分解）

> **本文是 `skills/ralph-loop/SKILL.md` 中状态管理的 AHE 对齐展开。**

## 组件职责

定义 Ralph Loop 的进度持久化 Schema、learnings 分类结构。

## Progress Log Schema (`progress.log` — YAML)

```yaml
req_progress:
  completed_count: 3
  total_count: 5
  current_req: REQ-XXX-004
  status: running|completed|blocked
  test_infra_status: generated|existing|skipped|fallback

learnings:
  permanent:
    - pattern: "描述持久模式"
      evidence: "来源证据"
  contextual:
    - pattern: "描述当前 REQ 有效模式"
      expires_on: "过期条件"

cost:
  req_number: 3
  tokens_used: 15000
  cumulative_tokens: 85000
  threshold: 200000
```

## Test Infra Status 字段

| 值 | 含义 |
|---|------|
| `generated` | 本 REQ 首次生成 test-utils.ts |
| `existing` | test-utils.ts 已存在且接口完整 |
| `skipped` | 非首次 REQ，跳过 test-infra 检查（缓存结果）|
| `fallback` | test-infra dispatch 失败，使用 inline 生成（含 warning）|

## Learnings 分类

| 类型 | 生命周期 | 持久化 | 示例 |
|------|---------|--------|------|
| `permanent` | 跨所有 REQ | progress.log | "项目使用 ESLint strict 模式" |
| `contextual` | 当前 REQ 内 | progress.log (过期标记) | "REQ 003 使用 Zod 验证 schema" |

## AHE 分类

| 字段 | 值 |
|------|---|
| 组件类型 | Long-Term Memory |
| 修改频率预期 | 低 |
