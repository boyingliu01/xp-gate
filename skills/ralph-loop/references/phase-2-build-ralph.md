# Ralph Loop — Phase 2 BUILD 集成文档

> 本文档定义 ralph-loop 模式下 Sprint-Flow Phase 2 的替代执行流程。

## 模式切换

### 触发条件

```bash
/sprint-flow "需求描述" --mode story-iterative
```

当启用 ralph-loop 模式时，Phase 2 从默认的 `dispatching-parallel-agents` 切换为 **逐 REQ 迭代 + 全量回归** 模式。

## 核心差异

| 维度 | 默认模式 (parallel) | ralph-loop 模式 (iterative) |
|------|---------------------|----------------------------|
| 需求源 | specification.yaml | specification.yaml |
| 执行方式 | 一次性并行 dispatch | 逐 REQ 串行迭代 |
| 上下文 | 共享 session，线性增长 | 每个 REQ 独立 dispatch，干净上下文 |
| 验证范围 | 关联测试 | **全量测试**（含跨 REQ 回归） |
| AGENTS.md 更新 | subagent 写 | **orchestrator 统一写** |
| 依赖排序 | 无 | 拓扑排序 + 同层 priority |

## 流程

```
默认模式:                          ralph-loop 模式:
┌──────────────────────┐           ┌──────────────────────────┐
│ dispatching-parallel │           │ 读取 specification.yaml  │
│ -agents              │           │ 构建依赖图                │
│                      │           │ 拓扑排序 (Kahn's algo)    │
│ 一次性 dispatch 所有  │           └──────────┬───────────────┘
│ 共享同一 session      │                      ▼
└──────────┬───────────┘           ┌──────────────────────────┐
           │                       │ 迭代循环:                │
           ▼                       │  取 next READY REQ       │
┌──────────────────────┐           │  dispatch 独立 subagent  │
│ verification +       │           │  (clean context)         │
│   commit             │           │  L1: typecheck+lint      │
└──────────────────────┘           │  L2: 全量测试 ← 回归检测 │
                                   │  L3: coverage ≥ 80%      │
                                   │  PASS → commit + learn   │
                                   │  FAIL → retry max 3      │
                                   └──────────┬───────────────┘
                                              ▼
                                         Phase 3 REVIEW
```

## 与 Sprint-Flow 参数交互

| 参数 | ralph-loop 行为 |
|------|----------------|
| `--stop-at build` | 执行完 ralph-loop 后停止 |
| `--resume-from build` | 从 checkpoint 恢复，跳过已 done REQs |
| `--phase build-only` | 只执行 ralph-loop |
| `--stop-at plan` | 在 Phase 1 停止，不进入 ralph-loop |

## Token 对比

| REQ 数量 | 默认模式 | ralph-loop | 节约 |
|---------|---------|-----------|------|
| 3 | ~15k | ~9k | 40% |
| 5 | ~50k | ~25k | 50% |
| 10 | ~150k | ~50k | 67% |

## 集成检查点

Ralph Loop 完成后返回：

```json
{
  "mode": "ralph-loop",
  "specification_source": "specification.yaml",
  "topology_order": ["REQ-001", "REQ-002", "REQ-003"],
  "requirements": { "total": 6, "done": 6, "pending": 0, "blocked": 0 },
  "learnings": { "permanent": ["..."], "contextual": ["..."] },
  "status": "completed"
}
```

Phase 3 REVIEW 正常执行（delphi code-walkthrough + test-specification-alignment）。PARTIAL 状态时仅检查 done REQs。
