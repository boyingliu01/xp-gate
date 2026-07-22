## 编排层规则（Orchestration Rules）

### Agent Dispatch Rules

| Agent Type | 适用场景 | 不适用场景 | 超时处理 |
|-----------|---------|-----------|---------|
| `explore` (bare) | **窄搜索**：单个关键词/pattern，已知文件位置 | 多角度宽泛搜索，读取大文件，3+ search angles | >5min → cancel + 用 `deep` 重试 |
| `librarian` (bare) | **外部参考**：API 文档、OSS 示例 | 内部代码库宽泛探索 | >5min → cancel + 用 `deep` 重试 |
| `task(category="deep")` | **复杂研究**：多模块分析，架构决策 | 单文件 trivial fix | 无限制 |
| `task(category="unspecified-high")` | **高 effort 实现**：新模块、重构 | 单行修改 | 无限制 |

**关键规则**：

1. Bare `explore` agent 本质是 contextual grep，**不是研究 agent**。如果任务涉及：
   - 3+ 个独立搜索角度
   - 读取多个大文件（>200 行）
   - 需要跨层分析（如"查 ralph-loop + .sprint-state/ + token 阈值 + phase transition"）
    
   → **必须用 `task(category="deep", load_skills=[...])` 替代**

2. 如果 `explore` agent >5 分钟未返回 → cancel 并立即用 `task(category="deep")` 重试。不要等待。

3. **并行 explore 仍然是正确模式**。2-4 个窄搜索 explore agent 并行执行是高效且推荐的。问题在于给单一 explore agent 分配宽泛任务。

**issue #83 根因**：`bg_1abf2ed9` 被分配了 4 个独立搜索角度的宽泛任务（ralph-loop context + .sprint-state/ + token threshold + phase transition），bare explore agent 超时丢失 session。同批的 `bg_5ecf590d`（窄搜索 OpenCode compaction API）3m35s 正常完成。

### Phase Subagent Dispatch Matrix

| Phase | 名称 | Subagent? | Category | load_skills | 执行者 |
|-------|------|:---------:|----------|-------------|--------|
| 1/6 | PREP | ❌ | Bash（直接执行） | 无 | orchestrator |
| 2/6 | DESIGN | ❌ | orchestrator（直接执行） | `["brainstorming", "autoplan", "delphi-review", "to-issues"]` | orchestrator |
| 3/6 | BUILD | ✅ | ralph-loop | `["test-driven-development"]` | subagent |
| 4/6 | VERIFY | ❌ | orchestrator（直接执行） | `["delphi-review", "test-specification-alignment", "learn", "retro", "systematic-debugging"]` | orchestrator |
| 5/6 | SHIP | ❌ | orchestrator（直接执行） | `["finishing-a-development-branch", "ship", "land-and-deploy"]` | orchestrator |
| 6/6 | CLOSE | ❌ | **强制人工 (UAT)** + Bash (CLEANUP) | 无 | 用户 + orchestrator |

**⚠️ 交互式 skill 必须由 orchestrator 直接执行（不可 dispatch 到 subagent）**：

| Phase | Skill | 为什么不能在 subagent 中执行 |
|-------|-------|---------------------------|
| 2/6 | `brainstorming` | 需要与用户对话确认需求、提出澄清问题。Subagent 是 fire-and-forget 模式，无法暂停等待用户输入（Issue #217） |
| 2/6 | `autoplan` | taste_decisions 节点暂停等待用户确认。必须由 orchestrator 直接执行（Issue #225） |
| 2/6 | `delphi-review` | design 模式需等待 verdict APPROVED；非 APPROVED 时需用户确认是否接受分歧方案（Issue #249） |
| 2/6 | `to-issues` | Step 6 "向用户确认" — 展示拆分结果，等待用户批准后才生成 slices-manifest.json |
| 4/6 | `delphi-review --mode code-walkthrough` | Code walkthrough 非 APPROVED 时需暂停等待用户处理 Critical Issues（Issue #249） |
| 5/6 | `finishing-a-development-branch` | 4 选项菜单 (merge/PR/keep/discard) 需要用户选择；Option 4 (discard) 要求 typed confirmation |
| 5/6 | `ship` | PR 创建前需要用户确认；包含 AskUserQuestion STOP 点 |
| 5/6 | `land-and-deploy` | Merge 确认、rollback 决策 — 均为用户交互点 |

**Phase 2/6 DESIGN 执行模式（全部 orchestrator 直接执行）**：
1. **Orchestrator 直接执行 brainstorming**：`skill(name="brainstorming")` → 等待 APPROVED
2. **Orchestrator 直接执行 autoplan**：`skill(name="autoplan")` → 等待用户确认 taste_decisions
3. **Orchestrator 直接执行 delphi-review**：`skill(name="delphi-review")` → 等待 APPROVED
4. **Orchestrator 直接执行 to-issues**：`skill(name="to-issues")` → 等待用户确认 Issue 拆分

**上下文隔离原则**：
- 每个 Subagent 在**独立 session** 中启动，不继承 orchestrator 的对话历史
- orchestrator session 仅接收 subagent 的最终结果摘要（~13,000 tokens/sprint）
- 现代模型百万 token 上下文 + 缓存命中 → 单 sprint 不会触发 overflow

### CONTEXT INHERITANCE

每个 Phase subagent 启动时，上下文仅通过以下路径继承：

| Phase | 加载来源 | 内容 |
|-------|---------|------|
| 1/6 PREP | 无前置（Bash 操作） | 用户原始需求 + 当前分支状态 |
| 2/6 DESIGN | phase-1-summary（仅路径） | 隔离环境信息（worktree 路径） |
| 3/6 BUILD | phase-2-summary.md + specification.yaml + slices-manifest.json | 设计决策 + REQ 列表 |
| 4/6 VERIFY | phase-3-summary.md + MVP 代码 | 构建结果（orchestrator 直接执行） |
| 5/6 SHIP | phase-4-summary.md + feedback-log.md | 评审结论 + 复盘结论 |
| 6/6 CLOSE | phase-5-summary.md + PR URL | 发布准备 + 部署结果 |

**隔离原则**：每个 Phase subagent 在干净上下文中启动。
输入仅限上表对应的摘要文件和一级产出物。
不包含前一 Phase 的完整对话、中间文件、失败尝试。

**特殊场景**：
- `--resume-from <phase>`：跳过前置 Phase，直接从指定 Phase 启动。**MUST 先执行 RESUME GATE（Issue #148）** 校验 sprint 状态、git 可达性和文件时效性，再执行 Phase Transition Gate 校验摘要文件格式。例如 `--resume-from build` 要求 `phase-2-summary.md` 和 `specification.yaml` 已存在且非 stale。
- `--no-isolate`：跳过 Phase 1/6 PREP 的 worktree 隔离，直接在当前分支执行。Phase 2/6 DESIGN 无 `phase-1-summary` 可用，上下文继承来源为用户原始需求 + 当前 git 状态。所有后续 Phase 的 worktree enforcement 不适用（无 worktree），但仍需保持代码隔离。
- `next_phase_context` 中的 `{path}` 等变量占位符在实际写入时被替换为具体值。

### PHASE TRANSITION RULES

每个 Phase subagent 完成后，必须按顺序执行以下步骤：

1. **写入 Phase 摘要**：创建 `.sprint-state/phase-outputs/phase-{N}-summary.md`
   - 格式：YAML frontmatter + Markdown body（body ≤ 50 行）
   - 大小限制：≤ 40,000 字符（≈ 10,000 tokens）

2. **调用 phase-transition CLI**（替代手动更新 sprint-state.json + 手动渲染看板）：
   ```
   npx xp-gate phase-transition <phase> <status> --render [--outputs '<json>']
   ```
   - Phase 开始时：`npx xp-gate phase-transition <N> in_progress --render`
   - Phase 完成时：`npx xp-gate phase-transition <N> completed --render --outputs '{"key":"value"}'`
   - Phase 跳过时：`npx xp-gate phase-transition <N> skipped --render`
   - CLI 自动完成：更新 `sprint-state.json`（phase, phase_history, outputs）+ 渲染 ASCII 看板
   - 看板规则：已完成 ✅ + 耗时，当前 🔄，待做 ⬜，跳过 ⏭️，失败 ❌
   - 进度条：`[████▓░░░░░░] {pct}%`
   - **禁止**手动写入 `sprint-state.json` 或手动调用 `render-sprint-progress.cjs`（已废弃）

3. **等待用户确认 checkpoint**（如适用）

4. **Phase 6 CLOSE 完成后运行 sprint-audit**（自动提醒，Layer 1.5 触发）：
   ```
   npx xp-gate sprint-audit
   ```
   - 检查 phase 覆盖度、时间记录、输出物记录、状态一致性
   - 输出人类可读报告或 JSON（`--json`）
   - 报告写入 `.sprint-state/audit-report.json`（最新覆盖）
   - Verdict: PASS / PASS_WITH_WARNINGS / FAIL / SKIP
   - `phase-transition` CLI 在 Phase 6 completed 时自动输出提醒，无需额外指令

### Background Task Resume Protocol (MANDATORY — Issue #248)

After dispatching background agents with `run_in_background=true`:

1. **END YOUR RESPONSE** — do NOT poll `background_output()` before receiving `<system-reminder>`
2. **On `<system-reminder>` notification**: collect ALL completed results via `background_output(task_id="bg_...")`
3. **When ALL tasks complete**: immediately resume by:
   a. Synthesizing results into the current phase assessment
   b. Executing the phase transition gate
   c. Continuing to the next phase **WITHOUT waiting for human input**
4. **If any task failed**: collect partial results, log the failure, continue with available data (do NOT block the pipeline)

**The orchestrator MUST treat task completion notifications as an implicit "continue" signal.** This protocol prevents the "human-in-loop stall" (Issue #235, #248).

### Phase Summary 格式（YAML Frontmatter Schema）

每个 `phase-N-summary.md` 必须包含以下 YAML frontmatter：

```markdown
---
phase: 1
phase_name: PREP
status: completed
outputs:
  - path: ".worktrees/sprint/sprint-YYYY-MM-DD-NN"
    type: directory
decisions:
  - title: "Worktree isolation enabled"
    rationale: "Prevent main branch pollution"
unresolved_issues: []
next_phase_context: "Worktree created at {path}. All subsequent edits MUST use this workdir."
---
```

**必填字段**: `phase`, `phase_name`, `status`, `outputs`, `decisions`, `next_phase_context`

### Phase Transition Gate

Orchestrator dispatch 下一 Phase 前必须执行验证（与旧模型相同，但 phase number 使用 1-6）：

```bash
SUMMARY=".sprint-state/phase-outputs/phase-${N}-summary.md"
[ -f "$SUMMARY" ] || { echo "[BLOCK] phase-${N}-summary 不存在"; exit 1; }
# ... (完整校验见原规则，phase 编号范围为 1-6)
```

### RESUME GATE / --resume-from 断点校验（Issue #148）

当使用 `--resume-from <phase>` 时，在执行 Phase Transition Gate 之前，
orchestrator MUST 先执行断点校验。与新 6-phase 模型一致，phase 编号使用 1-6。

### WORKTREE ENFORCEMENT（Issue #84）

Phase 1/6 PREP 执行完毕后，**所有后续操作（Phase 2/6 到 Phase 6/6）的文件编辑、命令执行 MUST 在 worktree 目录下执行**：
- **工作目录**：所有 Bash 命令必须通过 `workdir` 参数在 worktree 路径下执行
- **文件写入**：所有 `write`、`edit` 工具的 `filePath` 必须位于 `isolation.worktree_path` 下
- **例外**：`.gitignore` 校验和 `git worktree remove`（Phase 6/6 CLOSE 清理）在仓库根目录执行

Sprint state is persisted as JSON in `.sprint-state/sprint-state.json`:
```json
{
  "id": "sprint-2026-07-08-01",
  "task_description": "开发访谈机器人，支持多轮对话",
  "phase": 1,
  "status": "running|paused|completed",
  "started_at": "2026-07-08T10:00:00Z",
  "isolation": {
    "worktree_path": ".worktrees/sprint/sprint-2026-07-08-01",
    "branch": "sprint/2026-07-08-01",
    "created_from": "main",
    "created_from_commit": "abc123def..."
  },
  "auto_estimate": {
    "change_type": "删除已存在代码|修改已存在代码|新增功能|Bug修复",
    "metrics": {
      "ref_count": 12,
      "cross_module_count": 3,
      "modules": ["auth", "user", "admin"],
      "circular_dep": true,
      "public_api_count": 5,
      "test_file_count": 4
    },
    "estimated_level": "轻量|标准|复杂",
    "recommended_flow": "轻量流程|标准流程|完整 Sprint Flow (6 phases)",
    "risk_warnings": ["循环依赖: user ↔ plane"],
    "user_decision": "accepted|overridden|cancelled",
    "override_reason": null
  },
  "phase_history": [
    {
      "phase": 1,
      "phase_name": "PREP",
      "status": "completed",
      "started_at": "2026-07-08T10:00:00Z",
      "completed_at": "2026-07-08T10:05:00Z",
      "duration_seconds": 300
    }
  ],
  "outputs": {
    "pain_document": "docs/pain-document.md",
    "specification": "specification.yaml",
    "mvp": "mvp-v1/",
    "review_report": "review-report.md"
  },
  "metrics": {
    "tests_passed": 15,
    "tests_failed": 0,
    "coverage_pct": 85
  }
}
```

**新增字段说明**:
- `task_description`: Sprint 需求描述（Phase 1/6 PREP 启动时写入）
- `started_at`: Sprint 启动时间戳（Phase 1/6 PREP 启动时写入，ISO 8601 格式）
- `phase_history`: 阶段历史数组，每个元素记录阶段的执行信息（phase 编号 1-6）
- **Backward compat**: Legacy phase numbers (-1, -0.5, 0..8) in old sprint-state.json files remain readable

**Eval assertions check for:** `phase`, `status`, `isolation.branch`, `outputs.specification`, `metrics.coverage_pct`, `phase_history`, `task_description`.
