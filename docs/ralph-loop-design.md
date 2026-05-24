# Ralph-Loop Design Doc — Story-Level Iterative Build for XP-Gate

> **目标**: 将 ralph-loop 作为 Sprint-Flow Phase 2 BUILD 的 **默认模式**。逐 REQ 迭代 + 上下文重置，解决长任务 token 累积膨胀导致限流的问题。旧有并行模式可通过 `--mode parallel` 切换。
> **版本**: v4.0 (ralph-loop = 默认行为)

---

## 1. Problem Statement

**历史背景**: Sprint-Flow 的 Phase 2 BUILD 原采用"一次性并行 dispatch 所有需求"模式，整个 BUILD 阶段在一个 session 里持续运行。这导致：
- Token 消耗不可控（5 REQs ~50k, 10 REQs ~150k）
- 频繁触发服务商限流
- 后期生成质量因上下文噪声而下降

**v4.0 变更**: ralph-loop 从"可选模式"升级为 **默认模式**。每个 Sprint 默认使用逐 REQ 迭代构建。旧有并行模式保留为 `--mode parallel` 选项。

---

## 2. Design Approach

### 2.1 核心理念（借鉴 Ralph）

| Ralph 机制 | XP-Gate 适配 |
|---|---|
| 每次迭代 = 全新 AI 实例 | 每个 REQ dispatch 独立 subagent |
| 按故事执行 | 按 specification.yaml 中的 REQ 逐个执行 |
| 失败不提交 | verification 不通过 → 不 commit |
| progress.txt | progress.log（浓缩 learnings） |
| 更新 AGENTS.md | orchestrator 统一更新（不是 subagent 各自写） |

### 2.2 关键设计决策

#### 决策 1: 输入源 — 复用 specification.yaml，不新建 stories.json

~~旧方案~~: 新建 `stories.json` 格式（US-001, US-002...）

**新方案**: 以 `specification.yaml` 为 **唯一需求来源**。每个 `REQ-XXX` 及其对应的 `AC-XXX-XX` 自动作为一个迭代单元。

**理由**: `test-specification-alignment` 强制依赖 specification.yaml 中的 REQ/AC 标注体系。引入平行的 stories.json 会导致：
- 测试标注 `@test REQ-XXX` 找不到对应源
- 对齐评分归零
- 下游 Phase 3 Review 体系断裂

#### 决策 2: 需求粒度与依赖排序

**粒度**: 默认每个 REQ = 一个故事。如果单个 REQ 仍过大（> 1 个 context window），由用户在 specification.yaml 中拆分为子需求。

**依赖排序**: 使用 **拓扑排序 + 同层按 priority**。
1. 对 `specification.yaml` 中所有 pending REQs 构建依赖图（基于 `depends_on`）
2. 执行 Kahn's algorithm 拓扑排序，检测循环依赖
3. 同一拓扑层内的 REQ 按 `priority` 字段升序排列
4. 循环依赖 → BLOCK + 报告循环链给用户

```yaml
requirements:
  - id: REQ-001
    description: "创建 User Model"
    status: pending

  - id: REQ-002
    description: "实现密码加密"
    depends_on: [REQ-001]
    status: pending
```

#### 决策 3: 迭代上下文 — 严格隔离 + 分类 Learnings

每个 subagent 的 context **仅包含**：
- 当前 REQ + 其所有 AC
- `progress.log` 中的 learnings（按分类传递，不是固定窗口）：
  - **permanent**（架构决策、接口约定）— 始终传入
  - **contextual**（实现细节、gotchas）— 最近 3 条
  - **retry-failure**（上次验证失败的错误摘要）— 仅在 retry 时传入
- `AGENTS.md` 项目约定
- `git log --oneline -5`（了解前几轮做了什么）

**不包含**: 之前 REQ 的完整对话、之前 subagent 的输出、历史 prompt

#### 决策 4: 验证 Gate — 全量回归 + 分层验证

每个 REQ 完成后执行 **两层验证**：

| 层级 | 范围 | 工具 | 失败行为 |
|------|------|------|---------|
| L1: 快速检查 | 变更文件 | `lsp_diagnostics` + linter | 不 commit, retry |
| L2: 全量测试 | **所有测试**（不只是 @test REQ-XXX） | 项目测试框架 | 不 commit, retry |
| L3: 覆盖率 | 整体覆盖率 ≥ 80% | coverage report | 不 commit, retry |

**验证通过** → `git commit -m "ralph-loop: REQ-XXX - [title]"` → 标记 REQ done
**验证失败** → 不 commit → 记录失败原因 → retry（max 3）

#### 决策 5: 状态存储与崩溃恢复

```
.sprint-state/
├─ sprint-state.json              # 已有
├─ phase-outputs/                 # 已有
└─ ralph-loop/                    # 新增
    ├─ iteration-state.json       # 迭代进度（每次迭代后写盘）
    └─ progress.log               # learnings（append-only）
```

**崩溃恢复机制**:
- 每次 REQ 完成后（commit 前）原子写 `iteration-state.json`
- ralph-loop 启动时检测是否存在 checkpoint
- 如存在 → 跳过已 done 的 REQs → 从下一个 pending REQ 继续
- 已 commit 的 REQ 不需要重做（git history 天然持久）

#### 决策 6: Subagent 生命周期管理

| 指标 | 值 | 行为 |
|------|------|------|
| 超时 | 300s | 超时 → cancel → 记录 TIMEOUT → retry |
| 子 agent 模型 | 自动检测（复用项目配置） | — |
| 崩溃 | 捕获异常 | → 记录 CRASH → retry |
| 输出格式 | 见 §5 State Format | 不合规 → retry |

#### 决策 7: AGENTS.md 更新机制

**由 orchestrator 统一执行，不由 subagent 各自写**。

流程：
1. subagent 完成后输出 `agentmd_addition`（建议追加内容）
2. orchestrator 读取当前 AGENTS.md
3. orchestrator 在 AGENTS.md 末尾追加 `## ralph-loop: [REQ-XXX title] (auto-added)` 段
4. orchestrator 将 AGENTS.md 变更纳入 git commit

这避免了读-改-写竞态。

---

## 3. Architecture

### 3.1 完整流程

```
specification.yaml                    .sprint-state/ralph-loop/
      │                                     │
      ▼                                     │
  构建依赖图 (depends_on)                  │
  拓扑排序 + 同层按 priority               │
      │                                     │
      ▼                                     │
  ┌─────────────────────────────────────┐   │
  │  迭代循环 (max_iterations=15 默认)   │   │
  │                                      │   │
  │  取下一个 ready REQ (依赖已满足)     │◄──┘
  │  ↓                                  │
  │  Dispatch 独立 subagent              │
  │  (context: REQ + AC + learnings     │
  │   + AGENTS.md + git log -5          │
  │   + retry-failures if retry)        │
  │  ↓                                  │
  │  [超时/崩溃检测: 300s timeout]       │
  │  ↓                                  │
  │  实现 REQ                            │
  │  ↓                                  │
  │  ┌─ L1: typecheck + lint ──PASS?─┐  │
  │  │  FAIL → 记录错误 → goto retry  │  │
  │  │                                │  │
  │  │  ┌─ L2: 全量测试 ──PASS?─┐    │  │
  │  │  │  FAIL → 记录错误       │    │  │
  │  │  │  goto retry            │    │  │
  │  │  │                        │    │  │
  │  │  │  ┌─ L3: coverage ─PASS?┐   │  │
  │  │  │  │  FAIL → 记录错误    │   │  │
  │  │  │  │  goto retry         │   │  │
  │  │  │  │                     │   │  │
  │  │  │  │  ┌─ git commit ─┐  │   │  │
  │  │  │  │  │ 标记 done    │  │   │  │
  │  │  │  │  │ 写 progress  │  │   │  │
  │  │  │  │  │ 统一更新     │  │   │  │
  │  │  │  │  │ AGENTS.md    │  │   │  │
  │  │  │  │  │ checkpoint   │  │   │  │
  │  │  │  │  └──────────────┘  │   │  │
  │  │  │  └───────────────────┘   │  │
  │  │  └──────────────────────────┘  │
  │  └────────────────────────────────┘
  │          │                         │
  │          │ retry ≤ 3?              │
  │          ├─ YES ──→ retry (注入上次错误) │
  │          └─ NO  ──→ 标记 blocked  │
  │                      BLOCK + 用户决策    │
  │                                      │
  │  终止条件:                           │
  │  - 所有 REQ done → COMPLETE         │
  │  - max_iterations 达到 → PARTIAL    │
  │  - BLOCK → WAIT_USER                │
  └─────────────────────────────────────┘
      │
      ▼
  返回 sprint-flow Phase 3 REVIEW
  (delphi code-walkthrough + test-specification-alignment)
```

### 3.2 与 Sprint-Flow 的集成点

```
Sprint-Flow:
  Phase 0: THINK → brainstorming
  Phase 1: PLAN → autoplan + delphi-review → specification.yaml
  Phase 2: BUILD (默认 = ralph-loop 逐 REQ 迭代)
      └── /sprint-flow "需求"        → ralph-loop 模式
      └── /sprint-flow "需求" --mode parallel → 旧有并行模式
  Phase 3: REVIEW → delphi-review code-walkthrough + test-specification-alignment
  Phase 4: USER ACCEPTANCE (Phase 4)
  Phase 5: FEEDBACK
  Phase 6: SHIP
```

**ralph-loop 是 Phase 2 默认行为**。旧有并行模式仅用于小改动或 token 充足场景。Phase 3-6 行为完全不变。

### 3.3 与 test-specification-alignment 的兼容性

**完全兼容，无需修改**。ralph-loop 输出的是 specification.yaml 中 REQ 对应的代码实现，test-specification-alignment 仍然：
1. 解析 `specification.yaml`（REQ/AC 体系不变）
2. 遍历测试文件找 `@test REQ-XXX` / `@covers AC-XXX-XX`
3. 验证对齐分数 ≥ 80%

### 3.4 与 Sprint-Flow 参数的交互

| 参数 | ralph-loop 模式下的行为 |
|------|------------------------|
| `--stop-at build` | 执行完 ralph-loop 后停止 |
| `--resume-from build` | 从 checkpoint 恢复，跳过已 done REQs |
| `--phase build-only` | 只执行 ralph-loop，不执行前后 phases |
| `--stop-at plan` | 不进入 ralph-loop（在 Phase 1 停止） |

---

## 4. File Structure

```
skills/ralph-loop/
├── SKILL.md                          # 核心 skill 定义
├── references/
│   └── phase-2-build-ralph.md        # Sprint-Flow Phase 2 集成文档
├── templates/
│   └── progress-log.md               # 迭代 learnings 模板
└── evals/
    └── evals.json                    # 7 个评估用例
```

- **NOT** `stories.json.example` — 删除，输入源是 specification.yaml
- **NOT** 独立 `.config.json` — 复用 sprint-flow 参数机制

---

## 5. State Format

```json
{
  "skill_name": "ralph-loop",
  "version": "2.0.0",
  "feature": "用户登录模块",
  "specification_source": "specification.yaml",
  "current_iteration": 3,
  "max_iterations": 15,
  "requirements": {
    "total": 6,
    "done": 2,
    "pending": 3,
    "blocked": 1,
    "skipped": 0
  },
  "current_requirement": {
    "id": "REQ-003",
    "description": "实现注册 API 端点",
    "status": "done",
    "retry_count": 0,
    "last_failure": null
  },
  "status": "running",
  "subagent_timeout": 300,
  "max_retries": 3,
  "checkpoint_at": "2026-05-08T10:30:00Z",
  "learnings": {
    "permanent": ["Auth middleware must run before validation layer"],
    "contextual": [
      "Migration files must be in src/migrations/ not db/",
      "User model needs unique index on email"
    ]
  },
  "topology_order": ["REQ-001", "REQ-002", "REQ-003", "REQ-004", "REQ-005", "REQ-006"]
}
```

**字段说明**：
| 字段 | 类型 | 说明 |
|------|------|------|
| `requirements.done` | number | 已完成的 REQ 数量 |
| `requirements.pending` | number | 等待执行的 REQ 数量 |
| `requirements.blocked` | number | 因依赖不满足或 retry 超限的 REQ |
| `requirements.skipped` | number | 用户手动跳过的 REQ |
| `status` | string | running / completed / partial / blocked / recovered |
| `learnings.permanent` | string[] | 始终传递的架构级 learnings |
| `learnings.contextual` | string[] | 最近 3 条实现细节（滑动窗口） |
| `topology_order` | string[] | 拓扑排序结果，记录执行顺序 |

**REQ 状态机**：
```
pending → in_progress → done         (PASS)
pending → in_progress → failed → retry → ... → done (PASS after retry)
pending → in_progress → failed → retry → ... → blocked (max retries)
pending → [dependency not met] → pending (继续等待)
```

---

## 6. Learnings 生命周期管理

### 6.1 Learnings 分类规则

Learnings 分为两类，由 orchestrator 自动分类：

| 分类 | 内容 | 传递策略 | 升级条件 |
|------|------|---------|---------|
| **permanent** | 架构决策、接口约定、全局约定 | 始终传入（每个 REQ 的 context） | (1) 被 ≥ 2 个 REQ 引用的 learnings<br>(2) 涉及模块接口/数据结构变更<br>(3) 用户手动标记 `!permanent` |
| **contextual** | 实现细节、一次性 gotchas、临时技巧 | 滑动窗口（最近 3 条） | 满足 permanent 条件时自动升级，否则 3 条后被移除 |

**自动升级示例**：
- "migration files must be in src/migrations/" → 第 2 个 REQ 也引用 → 升级为 permanent
- "use bcrypt 不要使用 md5" → 安全规范 → 自动 permanent
- "第 42 行有个 off-by-one" → 仅影响单个 REQ → 保持 contextual，3 条后过期

### 6.2 AGENTS.md 膨胀控制

当 AGENTS.md > 500 行时，orchestrator 执行归档：
1. 保留最近 6 个月的 entries
2. 更久的 entries 归档到 `.sprint-state/ralph-loop/agents-archive/`
3. 归档文件以日期命名（如 `2025-01-ralph-loop-entries.md`）

---

## 7. REQ 状态机（完整定义）

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
        ┌──────┐  done  ┌────────────┐                       │
        │      │───────→│   DONE     │                       │
        │      │        │ (commit ok)│                       │
        │      │        └────┬───────┘                       │
        │      │             │ all done                      │
        │      │             ▼                               │
        │      │        ┌────────────┐                       │
        │      │        │  COMPLETE  │───→ Phase 3 REVIEW    │
        │      │        └────────────┘                       │
┌───────┤      │                                             │
│PENDIN │      │                                             │
│G      │      │  timeout/crash  ┌──────────┐                │
│       │      │  (after retry)  │ TIMEOUT  │                │
│       ├──in_progress──→│ RETRY    │                       │
│       │      │  max 3    └────┬─────┘                       │
│       │      │  failures     │                              │
│       │      │               ▼                              │
│       │      │        ┌────────────┐                        │
│       │      │        │  BLOCKED   │───→ 等待用户决策       │
│       │      │        │ (max retry)│                        │
│       │      │        └────┬───────┘                        │
│       │      │             │                                │
│       │      │  dep not met│                                │
│       │      │  (blocked)  ▼                                │
│       │      │        ┌────────────┐                        │
│       │      └───────→│  PENDING   │ (dep 上游被 block       │
│       │               │(auto-block)│  自动传递)             │
│       │               └────────────┘                        │
│       │                                                     │
│  [dep  │                                                     │
│   not  │                                                     │
│  met]  │                                                     │
│       │                                                     │
└───────┘                                                     │
```

### 7.1 状态转换规则

| 从状态 | 到状态 | 触发条件 | 行为 |
|--------|--------|---------|------|
| pending | in_progress | 拓扑排序轮到 + 所有依赖 done | dispatch subagent |
| in_progress | retry | verification 失败（L1/L2/L3 任一） | 记录失败信息，retry_count++ |
| retry | retry | verification 再次失败，retry_count < 3 | 注入上次错误摘要 |
| retry | done | verification 通过 | git commit，写 checkpoint |
| retry | blocked | retry_count ≥ 3 仍失败 | BLOCK + 通知用户 |
| pending | blocked(auto) | 上游依赖 REQ 被 blocked | 自动传递，记录依赖链 |
| blocked | skipped | 用户选择跳过 | 标记 skipped，继续 |
| blocked | done | 用户手动修复后确认 | 用户操作后标记 |
| 任意 | partial | 用户选择停止（BLOCK 选项 C） | 保留已 done commits |
| 任意 | done(rollback) | 用户选择回滚（BLOCK 选项 D） | git reset 到 ralph-loop 前 |

### 7.2 依赖传递 BLOCK 规则

当上游 REQ（如 REQ-001）被 blocked：
1. 直接依赖 REQ-001 的 REQ（如 REQ-002, REQ-003）→ 自动标记 `blocked(auto)`
2. 间接依赖 REQ-002 的 REQ（如 REQ-004）→ 递归自动 `blocked(auto)`
3. BLOCK 通知包含完整的依赖链：`REQ-001(blocked) → REQ-002 → REQ-003 → REQ-004`
4. 用户可决定是否跳过整个链或只跳过部分

### 7.3 PARTIAL 状态处理（详细定义）

当进入 PARTIAL 状态（用户选择停止或部分 REQ blocked）：

| 组件 | 行为 |
|------|------|
| 已 done REQs | commits 保留，代码库包含这些变更 |
| pending/SKIPPED REQs | 不执行，但 specification.yaml 中标记最终状态 |
| Phase 3 REVIEW | delphi code-walkthrough 评审已 done 的代码（忽略 pending/SKIPPED 部分） |
| Phase 3 test-specification-alignment | 仅检查已 done REQs 对应的测试，报告中注明"部分完成" |
| 报告输出 | ralph-loop summary: "X/Y REQ 完成，Z REQ 未完成" |
| Sprint Flow 继续 | Phase 4-6 正常执行，用户在 Phase 4 验收时被告知未完成 REQs |

### 7.4 REQ 粒度不均处理

**场景**: specification.yaml 中用户可能写出一个 REQ 包含太多功能。

**处理策略**:
1. ralph-loop 尝试执行该 REQ，如果 subagent 在 300s 内超时完成 → 推断 "REQ 过大"
2. 超时 2 次 → BLOCK + 提示用户: "REQ-XXX 过大，建议拆分为多个子 REQ"
3. 用户在 specification.yaml 中拆分子 REQ → 重试

---

## 8. Subagent Dispatch 细节

### 8.1 使用 OpenCode Task Tool

```
task(
  category="build",
  load_skills=["test-driven-development"],
  run_in_background=false,
  timeout=300,
  prompt="实现 REQ-XXX: [description]\n\nAcceptance Criteria:\n[AC list]\n\nLearnings:\n[permanent + contextual]\n\n项目约定:\n[AGENTS.md 内容]\n\n最近 commit 历史:\n[git log -5]"
)
```

### 8.2 超时与错误处理

| 场景 | 超时 | 行为 |
|------|------|------|
| 正常完成 | 300s | 接收输出，验证 format |
| 超时 | 300s | cancel → 记录 TIMEOUT → retry（max 3） |
| 工具异常 | — | catch → 记录 CRASH → retry（max 3） |
| 输出格式错误 | — | 记录 FORMAT_ERROR → retry（max 3） |

### 8.3 Subagent Input Contract

```yaml
context:
  requirement: "REQ-XXX: description + all AC-XXX-XX"
  permanent_learnings: ["始终传递的架构决策"]
  contextual_learnings: ["最近 3 条"]
  agents_md: "项目约定全文"
  git_log: "前 5 条 commit message"
  retry_failures: ["上次验证失败详情"]  # 仅 retry 时
```

### 8.4 Subagent Output Contract

```yaml
output:
  files_changed: ["src/foo.ts", "tests/foo.test.ts"]
  agentmd_addition: "建议追加到 AGENTS.md 的内容"
  verification_summary: "已运行 typecheck + lint + tests"
  status: "ready_for_verification | failed | timeout"
```

---

## 9. Retry 策略

| Retry 轮次 | 注入上下文 | 超时 |
|-----------|-----------|------|
| 第 1 次 | 标准上下文 | 300s |
| 第 2 次 | 标准 + 上次失败的错误摘要（linter 输出 + 测试失败列表） | 300s |
| 第 3 次 | 标准 + 前两次失败的错误摘要 + "请使用不同的实现方式" | 300s |

**失败不提交**：三次 retry 均失败 → `REQ-XXX` 标记为 `blocked` → 写入 `.sprint-state/ralph-loop/iteration-state.json` → BLOCK 通知用户

**用户选项（BLOCK 状态）**：
- **A**: 跳过此 REQ → 标记 `skipped` → 继续下一个
- **B**: 手动修复后继续 → 用户自行修改代码 → 标记 `done` → 继续
- **C**: 停止 ralph-loop → 保留已 done 的 commits → 进入 Phase 3（部分完成）
- **D**: 回滚所有 ralph-loop commits → 回到 Sprint-Flow Phase 2 默认模式

---

## 10. Token Savings Estimation

| REQ 数量 | 默认模式 (累积) | ralph-loop (独立) | 节约 |
|---------|----------------|-------------------|------|
| 3 | ~15k | ~9k | 40% |
| 5 | ~50k | ~25k | 50% |
| 10 | ~150k | ~50k | 67% |

原理: 默认 = sum(i × cost_i), ralph-loop = sum(cost_i)

> ⚠️ 注: 估算基于理想场景。实际可测量值取决于 AGENTS.md 大小和 learnings 数量。

---

## 11. Anti-Patterns

| ❌ 错误 | ✅ 正确 |
|---|---|
| 单个 REQ 包含所有需求 | 每个 REQ ≤ 1 context window 可完成 |
| 验证失败仍 commit | 不提交，保持代码库绿色 |
| 子 agent 保留完整历史 | 独立 dispatch，只传摘要上下文 |
| subagent 各自写 AGENTS.md | orchestrator 统一更新 AGENTS.md |
| 只跑 @test REQ-XXX | 每次 REQ 都跑全量测试 |
| priority 排序忽略 depends_on | 拓扑排序 + 同层按 priority |
| retry 不注入失败原因 | 每次 retry 追加上次错误摘要 |
| progress.log 写长篇 | 3-5 行摘要 |
| 用 ralph-loop 改单文件 typo | 小改动直接做 |

---

## 12. Open Issues (for Delphi Review Round 3)

1. **REQ 粒度不均**: specification.yaml 中用户可能写出一个 REQ 包含太多功能 → 是否建议在 delphi-review APPROVED 后自动拆分 REQ？
2. **拓扑排序的性能**: REQ 很多时（20+），拓扑排序 + 依赖检查的开销是否值得？（线性时间，可忽略）
