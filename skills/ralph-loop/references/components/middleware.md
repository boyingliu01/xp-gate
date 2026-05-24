# middleware.md — Ralph Loop 迭代控制逻辑（AHE 组件分解）

> **本文是 `skills/ralph-loop/SKILL.md` 中迭代流程的 AHE 对齐展开。**

## 组件职责

定义 Ralph Loop 的状态机：REQ 级迭代控制、熔断机制、中断续传逻辑。

## 状态机

```
REQ N → 加载 learnings → TDD → 回归测试 → progress.log → 成本检查
     → PASS → REQ N+1
     → FAIL → 重试 (max 3) → BLOCK → 用户决策
     → ALL_REQS_COMPLETE → 结束，返回控制权给 sprint-flow orchestrator
```

## 熔断机制

| 触发条件 | 动作 |
|---------|------|
| TDD 失败 > 3 次 | BLOCK + 用户决策 |
| Token 使用超阈值 | BLOCK + 用户决策 |
| 回归测试失败 | 记录到 progress.log，通知 sprint-flow orchestrator |

## 暂停点

| 暂停点 | 触发条件 | 恢复 |
|--------|---------|------|
| REQ 完成 | 自动暂停等待确认 | 确认后继续下一个 REQ |
| 熔断 | 自动触发 | 用户决策后继续或放弃 |

## AHE 分类

| 字段 | 值 |
|------|---|
| 组件类型 | Middleware |
| 修改频率预期 | 高 |
