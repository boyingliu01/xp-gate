---
name: ralph-loop
description: >
  Default Phase 2 BUILD mode for Sprint-Flow. Processes ONE REQ at a time from
  specification.yaml with clean isolated context per subagent dispatch, persists
  memory via git history + classified learnings, runs full regression tests on each
  REQ, and only commits on verification pass. Designed to reduce token consumption
  from linear context accumulation to per-REQ fixed budgets (40-67% savings).
  Token-constraint is the default — every Phase 2 uses this mode automatically.
  Use `--mode parallel` to opt into the legacy all-at-once mode if needed.
maturity: stable
---

# Ralph Loop — Default REQ-Level Iterative Build

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

## 作为 Phase 2 默认行为

Ralph Loop 是 Sprint-Flow **Phase 2 BUILD 的默认模式**：

```
Sprint-Flow Phase 2 (默认):
  ralph-loop → 逐 REQ 迭代 → 每次干净上下文 → 全量回归 → token 节约 40-67%

Sprint-Flow Phase 2 --mode parallel (可选):
  dispatching-parallel-agents → 所有需求一次性并行 → 上下文线性增长
```

**为什么它是默认**: 每个 Sprint 都受 token limit 约束。累积模式在 3+ REQs 时限流频率显著上升。ralph-loop 确保每个 REQ 的 token 预算独立可控。

**切换回并行模式**: `/sprint-flow "需求" --mode parallel`

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
    ├── 测试基础设施检查
    │     1. 检查 test-utils.ts（或等效文件）是否存在
    │     2. 检查必需接口契约：createTestApp()、withTestDb()
    │     3. 不存在或接口缺失 → dispatch "生成测试基础设施" subagent
    │        retry max 2 → 仍失败 → BLOCK 或 fallback inline 生成
    │     4. 与业务代码合并为同一 commit
    │
    ├── 注入测试基础设施摘要到业务代码 subagent context：
    │     【已有测试基础设施】test-utils.ts 已存在，导出以下 API：
    │     - createTestApp(): 创建应用实例 + 真实测试依赖
    │     - withTestDb(): 测试数据库生命周期（seed + cleanup）
    │     必须 import 这些函数，禁止重新手搓同名 helper。
    │
    ├── Dispatch 独立 subagent
    │     使用: task(category="unspecified-high", load_skills=["test-driven-development"], timeout=300)
    │     Context:
    │       - 当前 REQ + 所有 AC
    │       - permanent learnings（架构决策，始终传入）
    │       - contextual learnings（最近 3 条）
    │       - retry-failures（仅 retry 时注入失败原因）
    │       - AGENTS.md（项目约定）
    │       - git log --oneline -5
    │       - 【TDD 铁律】RED → GREEN → REFACTOR。任何模块必须先写测试再写实现。
    │       - 【Mock 边界】（覆盖 TDD skill 默认策略）
    │           ✅ MOCK: 外部 HTTP API、LLM 调用、第三方平台（钉钉/微信）
    │           ✅ MOCK: 时间/随机数/UUID（注入依赖）
    │           ❌ NO MOCK: 数据库操作（用真实测试库或 sqlite-in-memory）
    │           ❌ NO MOCK: HTTP 路由（用 app.inject() 真实注入）
    │           ❌ NO MOCK: 模板引擎（用真实 Nunjucks/Jinja 渲染）
    │           ❌ NO MOCK: 纯业务逻辑（用真实输入输出）
    │       - 【Mock 密度上限】测试中 mock/spy/fn 引用行数 > 总测试行数 30% 时，
    │           必须添加 // @mock-justified: <至少10字符理由> 注释说明为何无法用集成测试。
    │
    ├── Subagent 完成 → 三层验证
    │     ├── L1: typecheck + lint → FAIL? → retry
    │     ├── L2: 全量测试（ALL tests）→ FAIL? → retry
    │     └── L3: coverage ≥ 80% → FAIL? → retry
    │
    ├── PASS → git commit → 标记 done
    │        → 写 learnings（分类为 permanent/contextual）
    │        → 调用 `gstack/learn` 及时总结经验教训
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
| L1b | 测试先行比率 | 新增测试行数 / (新增测试 + 新增实现) ≥ 40% | retry |
| L2 | **全量测试**（不只是 @test REQ-XXX） | 项目测试框架 | retry |
| L3 | 整体覆盖率 ≥ 80% | coverage report | retry |

---

## 状态机

```
PENDING → test_infra_check → [infra needed?] → test_infra_dispatch
                                       │                    │
                                       │ FAIL               │ pass
                                       │ (max 2 retry)      │
                                       ▼                    ▼
                                   BLOCK/fallback      test_infra_ready → in_progress → done (commit)
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
|---|---|---|
| pending | test_infra_check | 拓扑排序轮到 + 依赖已满足 |
| test_infra_check | test_infra_dispatch | test-utils.ts 不存在或接口缺失 |
| test_infra_check | in_progress | test-utils.ts 已存在且接口完整 |
| test_infra_dispatch | test_infra_ready | 测试基础设施生成完成 |
| test_infra_dispatch | blocked | retry max 2 仍失败 |
| test_infra_dispatch | in_progress | fallback inline 生成（记录 warning）|
| in_progress | done | L1+L1b+L2+L3 全部通过 |
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

**默认启用**：Phase 2 BUILD 自动使用 ralph-loop 模式。

```bash
/sprint-flow "开发用户登录"
# → Phase 2 自动使用 ralph-loop 模式

/sprint-flow "开发小改动" --mode parallel
# → 可选：切换回旧有的并行模式
```

Phase 0, 1, 3-6 行为完全不变。

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
