# middleware.md — Ralph Loop 迭代控制逻辑（AHE 组件分解）

> **本文是 `skills/ralph-loop/SKILL.md` 中迭代流程的 AHE 对齐展开。**

## 组件职责

定义 Ralph Loop 的状态机：REQ 级迭代控制、熔断机制、中断续传逻辑。

## 状态机

```
REQ N → 加载 learnings → 测试基础设施检查 → [infra missing?] → test_infra_dispatch
     │                              │                             │
     │                              │ infra ready                 │ FAIL (max 2 retry)
     │                              ▼                             ▼
     │                         TDD → 回归测试 ←───────────── BLOCK/fallback
     │                              │
     │ PASS → REQ N+1
     │ FAIL → 重试 (max 3) → BLOCK → 用户决策
     │ ALL_REQS_COMPLETE → 结束，返回控制权给 sprint-flow orchestrator
```

## 测试基础设施状态机

```
test_infra_check → [needs infra?] → test_infra_dispatch → FAIL → retry (max 2)
        │               │                        │                      │
        │               │ infra ready            │ pass                 │ pass
        ▼               ▼                        ▼                      ▼
     in_progress   test_infra_ready ─────────→ TDD → regression     BLOCK/fallback
```

## 熔断机制

| 触发条件 | 动作 |
|---------|------|
| TDD 失败 > 3 次 | BLOCK + 用户决策 |
| Token 使用超阈值 | BLOCK + 用户决策 |
| 回归测试失败 | 记录到 progress.log，通知 sprint-flow orchestrator |
| test-infra dispatch 失败 (max 2 retry) | BLOCK 或 fallback inline 生成（记录 warning）|

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
