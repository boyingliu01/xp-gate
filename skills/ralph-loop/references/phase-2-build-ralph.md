# Ralph Loop — Phase 2 BUILD 默认模式

> ralph-loop 是 Sprint-Flow Phase 2 BUILD 的默认执行模式。token-constraint 优先：每次只处理一个 REQ，干净上下文，全量回归。

## 模式切换

### 默认行为

```bash
/sprint-flow "需求描述"
# → Phase 2 自动使用 ralph-loop 模式
```

### 可选并行模式

```bash
/sprint-flow "需求描述" --mode parallel
# → 旧有行为：一次性并行 dispatch 所有需求
```

## 核心差异

| 维度 | ralph-loop (默认) | --mode parallel (可选) |
|------|-------------------|----------------------|
| 需求源 | specification.yaml | specification.yaml |
| 执行方式 | 逐 REQ 串行迭代 | 一次性并行 dispatch |
| 上下文 | 每个 REQ 独立 dispatch，干净上下文 | 共享 session，线性增长 |
| 验证范围 | **全量测试**（含跨 REQ 回归） | 关联测试 |
| AGENTS.md 更新 | **orchestrator 统一写** | subagent 写 |
| 依赖排序 | 拓扑排序 + 同层 priority | 无 |

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

| 参数 | 行为 (默认=ralph-loop) |
|------|----------------------|
| `--stop-at build` | 执行完 ralph-loop 后停止 |
| `--resume-from build` | 从 checkpoint 恢复，跳过已 done REQs |
| `--phase build-only` | 只执行 ralph-loop |
| `--mode parallel` | 切换回旧有并行模式 |

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
