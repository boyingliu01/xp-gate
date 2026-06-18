---
name: ralph-loop
description: Use when executing Sprint-Flow Phase 2 BUILD, processing one REQ, building the next requirement, iterating with clean context, or requiring full regression per requirement.
maturity: stable
---

# Ralph Loop — Default REQ-Level Iterative Build

Core principles: **isolated context per REQ**, **TDD-first**, **full regression every iteration**, **token efficiency** (40-67% savings vs parallel).

## Triggers

**Keywords**: ralph-loop, process one REQ, Phase 2 BUILD, iterate REQ, isolated REQ build

**Use when**: executing Sprint-Flow Phase 2 BUILD; reading specification.yaml to implement REQs one-by-one; needing controlled token budget per REQ; preventing context pollution between REQs; full regression needed per step.

**Don't use**: 1-2 simple independent REQs (use parallel); emergency hotfix; `--mode parallel` is explicitly set.

## Architecture Overview

Ralph Loop is the **default Phase 2 BUILD mode**. Each REQ gets a fresh subagent context:

```
Sprint-Flow Phase 2 (default):
  ralph-loop → per-REQ iteration → clean context each time → full regression

Sprint-Flow Phase 2 (--mode parallel):
  dispatching-parallel-agents → parallel dispatch → context grows linearly
```

## Full Flow

```
Phase 0: 准备 → 读取 specification.yaml → 构建依赖图 → 拓扑排序
    │
    ▼
Phase 1: 迭代循环 (max_iterations=15 默认)
    │
    ├── 取下一个 READY REQ（依赖已满足，优先级最高）
    │
    ├── 测试基础设施检查 (test-utils.ts)
    │     ├── 不存在或接口缺失 → dispatch 生成 subagent (retry max 2)
    │     └── 已存在 → 注入 API 摘要到 subagent context
    │
    ├── Dispatch 独立 subagent (unspecified-high + test-driven-development)
    │     Context: 当前 REQ + AC + permanent learnings + contextual learnings
    │              + AGENTS.md + git log -5 + Mock 边界策略
    │
    ├── 三层验证
    │     ├── L1: typecheck + lint → FAIL? → retry
    │     ├── L1b: 测试行占比 ≥ 40% → FAIL? → retry
    │     ├── L2: 全量测试（ALL tests）→ FAIL? → retry
    │     └── L3: coverage ≥ 80% → FAIL? → retry
    │
    ├── PASS → git commit → 标记 done
    │        → 写 learnings (permanent/contextual)
    │        → orchestrator 更新 AGENTS.md
    │        → 继续下一个 READY REQ
    │
    └── FAIL (max 3 retry) → BLOCK → 用户决策 (skip/manual/stop/rollback)
        │
        ▼
    终止条件: ALL DONE → COMPLETE | max_iterations → PARTIAL | BLOCK → WAIT_USER
```

## 输入格式 (specification.yaml)

```yaml
specification:
  requirements:
    - id: REQ-001
      description: "Create User Model"
      acceptance_criteria:
        - id: AC-001-01
          criteria: "email (unique), password_hash, created_at"
      priority: 1
      status: pending
    - id: REQ-002
      description: "Password encryption"
      depends_on: [REQ-001]
      priority: 2
      status: pending
```

每个 REQ 自动作为迭代单元，所有 AC-XXX-XX 作为验收标准。

## 依赖排序

1. 拓扑排序（Kahn's algorithm，基于 `depends_on`）
2. 同层按 `priority` 升序
3. 循环依赖 → BLOCK + 报告循环链

## 状态机

```
PENDING → test_infra_check → [infra needed?] → test_infra_dispatch
                                        │                    │
                                        │ FAIL (max 2)      │ pass
                                        ▼                    ▼
                                    BLOCK/fallback      in_progress → done (commit)
                                        │                  │
                                        │  depend not met  │ all done → COMPLETE
                                        ▼                  ▼
                                     PENDING (waiting)  RETRY (n≤3, 注入错误)
                                                            │
                                                         n≥3 → BLOCKED
```

**崩溃恢复**：检查 checkpoint → 跳过已 done REQs → 从下一个 pending 继续。

## Retry 策略

| 轮次 | 注入上下文 | 超时 |
|------|-----------|------|
| 1 | 标准上下文 | 300s |
| 2 | 标准 + 上次失败摘要 | 300s |
| 3 | 标准 + 前两次失败 + "请使用不同实现方式" | 300s |

## Mock 边界策略

| Mock | No Mock |
|------|---------|
| 外部 HTTP API、LLM 调用、第三方平台 | 数据库（真实测试库或 sqlite-in-memory）|
| 时间/随机数/UUID（注入依赖） | HTTP 路由（app.inject()）|
| — | 模板引擎（真实渲染）|
| — | 纯业务逻辑（真实输入输出）|

Mock 密度上限：mock/spy/fn 行数 > 总测试行 30% → 必须加 `// @mock-justified: <理由>`。

## Learnings 分类

| 分类 | 内容 | 传递策略 | 升级条件 |
|------|------|---------|---------|
| permanent | 架构决策、接口约定 | 始终传入 | ≥2 REQ 引用 / 涉及接口/数据结构 / 用户手动标记 |
| contextual | 实现细节、一次性 gotchas | 滑动窗口 (最近 3 条) | 满足 permanent 条件自动升级，否则过期 |

## AGENTS.md 更新机制

Orchestrator 统一执行，subagent 输出 `agentmd_addition` 字段，orchestrator append。>500 行触发归档到 `.sprint-state/ralph-loop/agents-archive/`。

## Output Format

```json
{
  "skill_name": "ralph-loop",
  "version": "2.0.0",
  "requirements": { "total": 6, "done": 4, "pending": 1, "blocked": 1, "skipped": 0 },
  "learnings": {
    "permanent": ["Auth middleware must run before validation"],
    "contextual": ["migration files must be in src/migrations/"]
  },
  "status": "running",
  "checkpoint_at": "2026-05-08T10:30:00Z"
}
```

**Eval**: `done + pending + blocked + skipped == total`, `iteration <= max_iterations`.

## Scope

**In Scope**:
- Phase 2 BUILD 的 REQ 级迭代构建
- 从 specification.yaml 读取需求实现
- TDD + 全量回归测试
- Learnings 持久化 + 依赖排序 + 崩溃恢复

**Out of Scope**:
- Phase 0-1 (THINK/PLAN) / Phase 3-6 (REVIEW/SHIP/等)
- 并行模式（`--mode parallel`）
- 紧急热修复
- 非 spec 定义的需求

## Token Savings

| REQs | Default | Ralph Loop | Savings |
|------|---------|-----------|---------|
| 3 | ~15k | ~9k | 40% |
| 5 | ~50k | ~25k | 50% |
| 10 | ~150k | ~50k | 67% |

## Anti-Patterns

| ❌ Wrong | ✅ Right |
|----------|---------|
| 所有需求一个 REQ | 每个 REQ ≤ 1 context window |
| 验证失败仍 commit | 不提交 |
| 只跑当前 REQ 的测试 | 全量回归 |
| 忽略 depends_on | 拓扑排序 |
| retry 不注入失败原因 | 每次注入上次错误 |
| subagent 各自写 AGENTS.md | orchestrator 统一更新 |

## References

- [Components](references/components.md) — 系统提示/状态记忆/中间件/技能调用/构建步骤分解
- [Workflow Details](references/workflow-details.md) — 详细执行步骤 + Output Contract 检查清单
- [Phase 2 Integration](references/phase-2-build-ralph.md) — Sprint-Flow 集成细节
- [Progress Log Template](templates/progress-log.md)
- [Design Doc: ralph-loop v3.0](docs/ralph-loop-design.md)
