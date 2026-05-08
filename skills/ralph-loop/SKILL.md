---
name: ralph-loop
description: >
  REQ-level iterative build mode inspired by Ralph. Processes ONE REQ at a time
  from specification.yaml with clean isolated context per subagent dispatch, persists
  memory via git history + classified learnings, runs full regression tests on each
  REQ, and only commits on verification pass. Designed to reduce token consumption from
  linear context accumulation to per-REQ fixed budgets. Use when: long tasks, >3 REQs,
  token limits, context overflow risk. NOT for: single-file fixes, quick scripts.
maturity: beta
---

# Ralph Loop — REQ-Level Iterative Build

## 核心原则

| 原则 | 说明 |
|------|------|
| **每次迭代 = 全新上下文** | 每个 REQ dispatch 独立 subagent，不累积历史对话 |
| **一次只处理一个 REQ** | 小粒度执行，避免大任务吞掉整个 context window |
| **失败不提交** | 验证不通过的代码不 commit，保持代码库绿色 |
| **全量回归测试** | 每个 REQ 完成后运行 ALL tests（不只是 @test REQ-XXX），检测跨 REQ 回归 |
| **Git 持久记忆** | 代码变更 + checkpoint 天然持久，不需要在 prompt 里反复解释 |
| **浓缩型分类学习** | permanent（架构级）+ contextual（最近 3 条）双层 learnings |
| **AGENTS.md 统一更新** | orchestrator 统一写，subagent 不直接修改 — 无竞态 |

---

## 与 Sprint-Flow 的关系

Ralph Loop 是 Sprint-Flow **Phase 2 BUILD 的可选替代模式**：

```
Sprint-Flow Phase 2 默认模式:
  dispatching-parallel-agents → 所有需求一次性并行执行 → 一个大 MVP
  上下文随 REQ 线性增长

Sprint-Flow Phase 2 ralph-loop 模式:
  逐 REQ 迭代 → 每个 REQ 独立 dispatch（干净上下文）→ 全量回归 → 上下文不累积
```

**何时选择 ralph-loop 模式**：
- 需求 > 3 个 REQs（大功能）
- 已知 token limit 紧（服务商限流）
- 预计构建阶段 > 30 分钟
- 跨多个模块的变更（前端 + 后端 + 数据库）

**何时使用默认模式**：
- 单文件改动
- 1-2 个 REQs 的小需求
- 已有足够的 context window 余量

---

## 完整流程

```
Phase 0: 准备 → 读取 specification.yaml → 构建依赖图 → 拓扑排序
    │
    ▼
Phase 1: 迭代循环 (max_iterations=15 默认)
    │
    ├── 取下一个 READY REQ（依赖已满足，优先级最高）
    │
    ├── Dispatch 独立 subagent
    │     使用: task(category="build", load_skills=["test-driven-development"], timeout=300)
    │     Context:
    │       - 当前 REQ + 所有 AC
    │       - permanent learnings（架构决策，始终传入）
    │       - contextual learnings（最近 3 条）
    │       - retry-failures（仅 retry 时注入失败原因）
    │       - AGENTS.md（项目约定）
    │       - git log --oneline -5
    │
    ├── Subagent 完成 → 三层验证
    │     ├── L1: typecheck + lint → FAIL? → retry
    │     ├── L2: 全量测试（ALL tests）→ FAIL? → retry
    │     └── L3: coverage ≥ 80% → FAIL? → retry
    │
    ├── PASS → git commit → 标记 done
    │        → 写 learnings（分类为 permanent/contextual）
    │        → orchestrator 统一更新 AGENTS.md
    │        → 原子写 checkpoint
    │        → 继续下一个 READY REQ
    │
    └── FAIL → retry（max 3，注入上次错误摘要）
         └── 仍失败 → BLOCK → 依赖级联 → 用户决策
             │
             ▼
终止条件:
  - 所有 REQ done → COMPLETE → 返回 Phase 3 REVIEW
  - max_iterations 达到 → PARTIAL → 保留 done commits
  - BLOCK → WAIT_USER → skip/manual/stop/rollback
```

---

## 输入格式 (specification.yaml)

```yaml
specification:
  requirements:
    - id: REQ-001
      description: "创建 User Model 和数据库迁移"
      acceptance_criteria:
        - id: AC-001-01
          criteria: "User model 包含 email (unique), password_hash, created_at"
        - id: AC-001-02
          criteria: "Migration 成功执行"
      priority: 1
      status: pending

    - id: REQ-002
      description: "实现密码加密工具函数"
      depends_on: [REQ-001]
      acceptance_criteria:
        - id: AC-002-01
          criteria: "hashPassword() 返回 bcrypt hash"
        - id: AC-002-02
          criteria: "verifyPassword() 正确比对明文和 hash"
      priority: 2
      status: pending
```

**每个 REQ 自动作为一个迭代单元**，其所有 `AC-XXX-XX` 作为验收标准。

---

## 依赖排序

1. **拓扑排序**：对所有 pending REQs 构建依赖图（基于 `depends_on`）
2. **Kahn's algorithm**：执行拓扑排序，检测循环依赖
3. **同层按 priority**：同一拓扑层内的 REQ 按 `priority` 升序排列
4. **循环依赖**：→ BLOCK + 报告循环链（`REQ-A → REQ-B → REQ-C → REQ-A`）

---

## Learnings 分类

| 分类 | 内容 | 传递策略 | 升级条件 |
|------|------|---------|---------|
| **permanent** | 架构决策、接口约定、全局约定 | 始终传入（每个 REQ context）| (1) 被 ≥2 个 REQ 引用<br>(2) 涉及模块接口/数据结构<br>(3) 用户手动标记 |
| **contextual** | 实现细节、一次性 gotchas、临时技巧 | 滑动窗口（最近 3 条） | 满足 permanent 条件自动升级，否则 3 条后过期 |

**自动升级示例**：
- `"migration files must be in src/migrations/"` → 第 2 个 REQ 也引用 → 升级为 permanent
- `"use bcrypt 不要使用 md5"` → 安全规范 → 自动 permanent
- `"第 42 行有个 off-by-one"` → 仅影响单个 REQ → 保持 contextual

---

## AGENTS.md 更新机制

**由 orchestrator 统一执行，不由 subagent 各自写**：

1. subagent 完成后输出 `agentmd_addition` 字段
2. orchestrator 读取当前 AGENTS.md
3. orchestrator append `## ralph-loop: [REQ-XXX title] (auto-added)` 段
4. orchestrator 将 AGENTS.md 变更纳入 git commit

当 AGENTS.md > 500 行时触发归档：保留最近 6 个月 entries，更早的归档到 `.sprint-state/ralph-loop/agents-archive/`。

---

## 三层验证 Gate

每个 REQ 完成后执行：

| 层级 | 范围 | 工具 | 失败行为 |
|------|------|------|---------|
| L1 | 变更文件 | `lsp_diagnostics` + linter | retry |
| L2 | **全量测试**（不只是 @test REQ-XXX） | 项目测试框架 | retry |
| L3 | 整体覆盖率 ≥ 80% | coverage report | retry |

---

## 状态机

```
PENDING → in_progress → done (commit)
       │                  │
       │  depend not met  │ all done → COMPLETE
       │  ┌───────────────┘
       ▼  │
    PENDING (waiting)
       │
       │  fail
       ▼
    RETRY (n≤3, 注入上次错误)
       │
       │  n≥3
       ▼
    BLOCKED → 用户决策 (skip/manual/stop/rollback)
       │
       │  依赖上游 blocked → 自动 blocked(含依赖链)
       ▼
    auto-blocked REQs
```

**REQ 状态转换规则**：

| 从 | 到 | 触发 |
|---|---|---|---|
| pending | in_progress | 拓扑排序轮到 + 依赖已满足 |
| in_progress | done | L1+L2+L3 全部通过 |
| in_progress | retry | 验证失败, n<3 |
| retry | done | 验证通过 |
| retry | blocked | n≥3 仍失败 |
| pending | blocked(auto) | 上游依赖 blocked |
| blocked | skipped | 用户选择跳过 |
| blocked | done | 用户手动修复后确认 |
| 任意 | partial | 用户选择停止 |
| 任意 | rollback | 用户选择回滚 (git reset) |

**崩溃恢复**：启动时检测 checkpoint → 跳过已 done REQs → 从下一个 pending 继续。已 commit 的 REQ 不需要重做。

---

## Retry 策略

| 轮次 | 注入上下文 | 超时 |
|------|-----------|------|
| 第 1 次 | 标准上下文 | 300s |
| 第 2 次 | 标准 + 上次失败摘要 (linter+tests) | 300s |
| 第 3 次 | 标准 + 前两次失败摘要 + "请使用不同实现方式" | 300s |

---

## 与 Sprint-Flow 集成

**启用方式**：

```bash
/sprint-flow "开发用户登录" --mode story-iterative
```

Phase 2 BUILD 自动切换到 ralph-loop 流程。Phase 0, 1, 3-6 行为完全不变。

**与 test-specification-alignment 完全兼容**：
- Test alignment 仍解析 specification.yaml (REQ/AC 不变)
- 仍查找 `@test REQ-XXX` / `@covers AC-XXX-XX`
- PARTIAL 状态下仅检查已 done REQs

---

## Output Format (MANDATORY)

```json
{
  "skill_name": "ralph-loop",
  "version": "2.0.0",
  "specification_source": "specification.yaml",
  "topology_order": ["REQ-001", "REQ-002", "REQ-003"],
  "requirements": { "total": 6, "done": 4, "pending": 1, "blocked": 1, "skipped": 0 },
  "current_requirement": { "id": "REQ-005", "status": "done", "retry_count": 0 },
  "learnings": {
    "permanent": ["Auth middleware must run before validation"],
    "contextual": ["migration files must be in src/migrations/"]
  },
  "status": "running",
  "checkpoint_at": "2026-05-08T10:30:00Z"
}
```

**Eval assertions**: `done + pending + blocked + skipped == total`, `iteration <= max_iterations`.

---

## Anti-Patterns

| ❌ 错误 | ✅ 正确 |
|---|---|
| 一个 REQ 包含所有需求 | 每个 REQ ≤ 1 context window |
| 验证失败仍 commit | 不提交 |
| 只跑 @test REQ-XXX | 全量回归测试 |
| priority 排序忽略 depends_on | 拓扑排序 + 同层 priority |
| retry 不注入失败原因 | 每次 retry 注入上次错误 |
| subagent 各自写 AGENTS.md | orchestrator 统一更新 |
| progress.log 写长篇大论 | 3-5 行结构化摘要 |

---

## Token Savings

| REQ 数量 | 默认模式 | ralph-loop | 节约 |
|---------|---------|-----------|------|
| 3 | ~15k | ~9k | 40% |
| 5 | ~50k | ~25k | 50% |
| 10 | ~150k | ~50k | 67% |

> 原理: 默认 = sum(i × cost_i), ralph-loop = sum(cost_i)

---

## References

- [Design Doc: ralph-loop v3.0](docs/ralph-loop-design.md) — 完整设计文档 + Delphi 评审记录
- [Phase 2 Integration](references/phase-2-build-ralph.md) — Sprint-Flow 集成细节
- [Progress Log Template](templates/progress-log.md)
