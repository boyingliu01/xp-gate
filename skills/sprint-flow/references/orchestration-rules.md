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
| -1 | ISOLATE | ❌ | Bash（直接执行） | 无 | orchestrator |
| -0.5 | AUTO-ESTIMATE | ❌ | Bash（直接执行） | 无 | orchestrator |
| 0 | THINK | ✅ | `deep` | `["brainstorming"]` | subagent |
| 1 | PLAN | ✅ | `deep` | `["autoplan", "delphi-review", "to-issues"]` | subagent |
| 2 | BUILD | ✅(已有) | ralph-loop | `["test-driven-development"]` | subagent |
| 3 | REVIEW | ✅ | `deep` | `["delphi-review", "test-specification-alignment"]` | subagent |
| 4 | USER ACCEPT | ❌ | **强制人工** | 无 | 用户 |
| 5 | FEEDBACK | ✅ | `quick` | `["learn", "retro", "systematic-debugging"]` | subagent |
| 6 | SHIP | ✅ | `quick` | `["finishing-a-development-branch", "ship"]` | subagent |
| 7 | LAND | ✅ | `deep` | `["land-and-deploy"]` | subagent |
| 8 | CLEANUP | ❌ | Bash（直接执行） | 无 | orchestrator |

**上下文隔离原则**：
- 每个 Subagent 在**独立 session** 中启动，不继承 orchestrator 的对话历史
- orchestrator session 仅接收 subagent 的最终结果摘要（~13,000 tokens/sprint）
- 现代模型百万 token 上下文 + 缓存命中 → 单 sprint 不会触发 overflow

### CONTEXT INHERITANCE

每个 Phase subagent 启动时，上下文仅通过以下路径继承：

| Phase | 加载来源 | 内容 |
|-------|---------|------|
| Phase -1 | 无前置（Bash 操作） | 用户原始需求 + 当前分支状态 |
| Phase 0 | phase--1-summary（仅路径） | 隔离环境信息（worktree 路径） |
| Phase 1 | phase-0-summary.md + design-doc | 设计决策 + 结构化规格 |
| Phase 2 | phase-1-summary.md + specification.yaml | 评审结论 + REQ 列表 |
| Phase 3 | phase-2-summary.md + MVP 代码 | 构建结果 |
| Phase 4 | — | **人工验收**。Phase 4 不产生 subagent summary，但用户验收结果记录在 `.sprint-state/phase-outputs/emergent-issues.md`（如有 emergent issues）。Phase 5 加载此文件。 |
| Phase 5 | phase-4-summary.md + emergent-issues.md | 验收结论 |
| Phase 6 | phase-5-summary.md + feedback-log.md | 复盘结论 |
| Phase 7 | phase-6-summary.md + PR URL | 发布准备 |
| Phase 8 | phase-7-summary（Bash 操作） | 部署结果 |

**隔离原则**：每个 Phase subagent 在干净上下文中启动。
输入仅限上表对应的摘要文件和一级产出物。
不包含前一 Phase 的完整对话、中间文件、失败尝试。

**特殊场景**：
- `--resume-from <phase>`：跳过前置 Phase，直接从指定 Phase 启动。**MUST 先执行 RESUME GATE（Issue #148）** 校验 sprint 状态、git 可达性和文件时效性，再执行 Phase Transition Gate 校验摘要文件格式。例如 `--resume-from build` 要求 `phase-1-summary.md` 和 `specification.yaml` 已存在且非 stale。
- `--no-isolate`：跳过 Phase -1 ISOLATE，直接在当前分支执行。Phase 0 无 `phase--1-summary` 可用，上下文继承来源为用户原始需求 + 当前 git 状态。所有后续 Phase 的 worktree enforcement 不适用（无 worktree），但仍需保持代码隔离。
- `next_phase_context` 中的 `{path}` 等变量占位符在实际写入时被替换为具体值。示例中的 `{path}` 应替换为实际 worktree 路径（如 `.worktrees/sprint/sprint-2026-06-01-01`）。

### PHASE TRANSITION RULES

每个 Phase subagent 完成后，必须按顺序执行以下步骤：

1. **写入 Phase 摘要**：创建 `.sprint-state/phase-outputs/phase-{N}-summary.md`
   - 格式：YAML frontmatter + Markdown body（body ≤ 50 行）
   - 大小限制：≤ 40,000 字符（≈ 10,000 tokens）

2. **更新 sprint-state.json**：
   - `phase`: 当前阶段编号
   - `outputs`: 新增当前阶段输出文件路径
   - `phase_history`: 追加或更新当前阶段的记录
     - Phase 开始时：追加 `{ "phase": N, "phase_name": "NAME", "status": "running", "started_at": "<ISO 8601>", "completed_at": null, "duration_seconds": null }`
     - Phase 完成时：更新对应条目，填充 `completed_at`（ISO 8601）和 `duration_seconds`（`completed_at - started_at` 的秒数）
     - Phase 跳过时（如轻量路由跳过 Phase 0 brainstorming）：设置 `status: "skipped"`

3. **等待用户确认 checkpoint**（如适用）

4. **展示进度看板**：执行 `node scripts/render-sprint-progress.cjs` 渲染进度看板
   - 脚本自动读取 `.sprint-state/sprint-state.json` 并输出 ASCII 进度看板
   - 渲染规则：已完成阶段显示 ✅ + 耗时，当前阶段 🔄，待做 ⬜，跳过 ⏭️，失败 ❌
   - 进度条：`[████▓░░░░░░] {pct}%`（已完成数/总阶段数 11）
   - 下一步行动：根据当前阶段 + 状态，自动查找对应提示
   - 输出物路径：列出 `outputs` 中已有的文件路径
   - 时机：每个 Phase 完成后的 transition 阶段自动展示，用户无需请求
   - 向后兼容：旧版 `sprint-state.json` 缺少 `phase_history` 时，从 `phase` 字段推断状态

### Phase Summary 格式（YAML Frontmatter Schema）

每个 `phase-N-summary.md` 必须包含以下 YAML frontmatter：

```markdown
---
phase: -1
phase_name: ISOLATE
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

## Phase Summary
{简明摘要，不超过 50 行}
```

**必填字段**: `phase`, `phase_name`, `status`, `outputs`, `decisions`, `next_phase_context`
**可选字段**: `unresolved_issues`

### Phase Transition Gate

Orchestrator dispatch 下一 Phase 前必须执行验证：

```bash
# === Phase Transition Gate ===

# 1. Phase summary file validation
SUMMARY=".sprint-state/phase-outputs/phase-${N}-summary.md"
[ -f "$SUMMARY" ] || { echo "[BLOCK] phase-${N}-summary 不存在"; exit 1; }
FRONTMARKERS=$(grep -c "^---" "$SUMMARY" 2>/dev/null || echo 0)
[ "$FRONTMARKERS" -ge 2 ] || { echo "[BLOCK] YAML frontmatter 格式不完整"; exit 1; }
grep -q "^phase:" "$SUMMARY" || { echo "[BLOCK] 缺少 phase 字段"; exit 1; }
grep -q "^phase_name:" "$SUMMARY" || { echo "[BLOCK] 缺少 phase_name 字段"; exit 1; }
grep -q "^status:" "$SUMMARY" || { echo "[BLOCK] 缺少 status 字段"; exit 1; }
grep -q "^decisions:" "$SUMMARY" || { echo "[BLOCK] 缺少 decisions 字段"; exit 1; }
grep -q "^outputs:" "$SUMMARY" || { echo "[BLOCK] 缺少 outputs 字段"; exit 1; }
grep -q "^next_phase_context:" "$SUMMARY" || { echo "[BLOCK] 缺少 next_phase_context"; exit 1; }
CHARS=$(wc -c < "$SUMMARY" | tr -d ' ')
[ "$CHARS" -le 40000 ] || { echo "[BLOCK] 摘要超出大小限制 (${CHARS}/40000 chars)"; exit 1; }

# 2. sprint-state.json enforcement check (Issue #146)
SPRINT_STATE=".sprint-state/sprint-state.json"
[ -f "$SPRINT_STATE" ] || { echo "[BLOCK] sprint-state.json 不存在"; exit 1; }

# Verify phase_history includes current phase with completed_at
PHASE_HISTORY_CHECK=$(grep -c "\"phase\": $N" "$SPRINT_STATE" 2>/dev/null || echo 0)
[ "$PHASE_HISTORY_CHECK" -gt 0 ] || {
  echo "[BLOCK] sprint-state.json phase_history 缺少 phase $N 的记录"
  echo "[ACTION] 在 dispatch 下一 Phase 前更新 sprint-state.json:"
  echo "  - phase: $N"
  echo "  - phase_history: 追加 {phase:N, status:completed, completed_at:<ISO8601>}"
  echo "  - outputs: 追加当前 phase 的输出文件"
  exit 1
}

# Verify completed_at is set (not null)
COMPLETED_AT_VALUE=$(grep -A3 "\"phase\": $N" "$SPRINT_STATE" 2>/dev/null | grep "completed_at" | head -1 | grep -o '"[^"]*"$' | tr -d '"')
[ "$COMPLETED_AT_VALUE" != "null" ] && [ -n "$COMPLETED_AT_VALUE" ] || {
  echo "[BLOCK] sprint-state.json phase $N 的 completed_at 未设置 (null)"
  echo "[ACTION] 设置 completed_at 为当前时间 (ISO 8601):"
  echo "  date -u +%Y-%m-%dT%H:%M:%SZ"
  exit 1
}
```

**由 orchestrator 强制执行**，不依赖 subagent 自觉遵守。
验证失败 → BLOCK，不可 dispatch 下一 Phase。

### RESUME GATE / --resume-from 断点校验（Issue #148）

当使用 `--resume-from <phase>` 时，在执行 Phase Transition Gate 之前，
orchestrator MUST 先执行以下断点校验。任何一项失败 → BLOCK，拒绝恢复。

```bash
SPRINT_STATE=".sprint-state/sprint-state.json"
[ -f "$SPRINT_STATE" ] || { echo "[BLOCK] sprint-state.json 不存在，无法恢复"; exit 1; }

# 1. Sprint ID 一致性：确认 resume 的目标 sprint 与 sprint-state.json 匹配
SPRINT_ID=$(grep -o '"id": "[^"]*"' "$SPRINT_STATE" | head -1 | cut -d'"' -f4)
CURRENT_SPRINT_ID=$(echo "$TASK_DESCRIPTION" | md5sum | head -8 2>/dev/null || echo "unknown")
# 实际 sprint id 由 Phase -1 生成，此处仅验证文件存在且包含 id 字段
[ -n "$SPRINT_ID" ] || { echo "[BLOCK] sprint-state.json 缺少 id 字段"; exit 1; }

# 2. 阶段顺序校验：--resume-from 的 phase 必须是最后已完成 phase 的后继
LAST_COMPLETED_PHASE=$(grep -o '"phase": [0-9]' "$SPRINT_STATE" | tail -1 | awk '{print $2}')
RESUME_PHASE=$((RESUME_PHASE))  # orchestrator 将 --resume-from 参数值转为整数
[ "$RESUME_PHASE" -gt "$LAST_COMPLETED_PHASE" ] || { 
  echo "[BLOCK] --resume-from phase ($RESUME_PHASE) 必须在最后已完成 phase ($LAST_COMPLETED_PHASE) 之后"
  exit 1
}

# 3. Git 状态校验：isolation branch 仍然可达
ISOLATION_BRANCH=$(grep -o '"branch": "[^"]*"' "$SPRINT_STATE" | head -1 | cut -d'"' -f4)
ISOLATION_COMMIT=$(grep -o '"created_from_commit": "[^"]*"' "$SPRINT_STATE" | head -1 | cut -d'"' -f4)
if [ -n "$ISOLATION_BRANCH" ]; then
  git rev-parse --verify "$ISOLATION_BRANCH" >/dev/null 2>&1 || {
    echo "[BLOCK] isolation branch '$ISOLATION_BRANCH' 已不存在（可能被删除或 force push 覆盖）"
    exit 1
  }
fi
if [ -n "$ISOLATION_COMMIT" ]; then
  git cat-file -e "${ISOLATION_COMMIT}^{commit}" 2>/dev/null || {
    echo "[WARN] isolation commit $ISOLATION_COMMIT 不可达（可能被 GC 或 rebase 清理），恢复后可能状态不一致"
    # WARN 而非 BLOCK — 可继续但有风险
  }
fi

# 4. 文件时效性校验：前置摘要文件的 mtime 不晚于其生成 phase 的完成时间
RESUME_PREREQ_PHASE=$((RESUME_PHASE - 1))
PREREQ_FILE=".sprint-state/phase-outputs/phase-${RESUME_PREREQ_PHASE}-summary.md"
[ -f "$PREREQ_FILE" ] || { echo "[BLOCK] 前置摘要文件 ${PREREQ_FILE} 不存在"; exit 1; }

# 提取前置 phase 的完成时间
PREREQ_COMPLETED_AT=$(grep -A3 "\"phase\": $RESUME_PREREQ_PHASE" "$SPRINT_STATE" 2>/dev/null | grep "completed_at" | head -1 | cut -d'"' -f4)
if [ -n "$PREREQ_COMPLETED_AT" ] && [ "$PREREQ_COMPLETED_AT" != "null" ]; then
  FILE_MTIME=$(stat -c %Y "$PREREQ_FILE" 2>/dev/null || stat -f %m "$PREREQ_FILE" 2>/dev/null)
  COMPLETED_EPOCH=$(date -d "$PREREQ_COMPLETED_AT" +%s 2>/dev/null || echo "")
  if [ -n "$FILE_MTIME" ] && [ -n "$COMPLETED_EPOCH" ]; then
    # 容忍 60 秒时钟偏差
    [ "$FILE_MTIME" -le $((COMPLETED_EPOCH + 60)) ] || {
      echo "[WARN] 前置摘要文件 ${PREREQ_FILE} 在 phase $RESUME_PREREQ_PHASE 完成后被修改（mtime: $(date -d @$FILE_MTIME '+%Y-%m-%d %H:%M:%S'), completed_at: $PREREQ_COMPLETED_AT）"
      echo "[ACTION] 继续恢复前请确认修改是预期的。输入 'confirm' 继续，其他取消："
      read USER_CONFIRM
      [ "$USER_CONFIRM" = "confirm" ] || { echo "[BLOCK] 用户取消恢复"; exit 1; }
    }
  fi
fi

# 5. specification.yaml 时效性校验（仅 --resume-from build）
SPEC_FILE="specification.yaml"
if [ "$RESUME_PHASE" -ge 2 ] && [ -f "$SPEC_FILE" ]; then
  SPEC_MTIME=$(stat -c %Y "$SPEC_FILE" 2>/dev/null || stat -f %m "$SPEC_FILE" 2>/dev/null)
  PLAN_COMPLETED_AT=$(grep -A3 '"phase": 1' "$SPRINT_STATE" 2>/dev/null | grep "completed_at" | head -1 | cut -d'"' -f4)
  if [ -n "$SPEC_MTIME" ] && [ -n "$PLAN_COMPLETED_AT" ] && [ "$PLAN_COMPLETED_AT" != "null" ]; then
    PLAN_EPOCH=$(date -d "$PLAN_COMPLETED_AT" +%s 2>/dev/null || echo "")
    if [ -n "$PLAN_EPOCH" ] && [ "$SPEC_MTIME" -gt $((PLAN_EPOCH + 60)) ]; then
      echo "[WARN] specification.yaml 在 Plan phase 完成后被修改"
      echo "[ACTION] 继续恢复前请确认 specification.yaml 的修改是预期的。输入 'confirm' 继续："
      read USER_CONFIRM
      [ "$USER_CONFIRM" = "confirm" ] || { echo "[BLOCK] 用户取消恢复"; exit 1; }
    fi
  fi
fi

echo "✅ RESUME GATE PASSED — 断点校验通过"
# 继续执行 Phase Transition Gate
```

验证失败 → BLOCK，不可执行 `--resume-from`。
orchestrator 必须展示失败原因并建议用户启动新 Sprint 或手动修复后重试。

### WORKTREE ENFORCEMENT（Issue #84）

Phase -1 执行完毕后，**所有后续操作（Phase 0 到 Phase 8）的文件编辑、命令执行 MUST 在 worktree 目录下执行**：

- **工作目录**：所有 Bash 命令必须通过 `workdir` 参数或 `&&` 链式命令在 worktree 路径下执行
- **文件写入**：所有 `write`、`edit` 工具的 `filePath` 必须位于 `isolation.worktree_path` 下
- **验证步骤**：Phase 0 开始前，输出 `[WORKTREE] 后续所有操作将在 {worktree_path} 中进行`
- **例外**：`.gitignore` 校验（Phase -1 表步 4）和 `git worktree remove`（Phase 8 清理）在仓库根目录执行
Sprint state is persisted as JSON in `.sprint-state/sprint-state.json`:
```json
{
  "id": "sprint-2026-04-26-01",
  "task_description": "开发访谈机器人，支持多轮对话",
  "phase": -1,
  "status": "running|paused|completed",
  "started_at": "2026-04-26T10:00:00Z",
  "isolation": {
    "worktree_path": ".worktrees/sprint/sprint-2026-04-26-01",
    "branch": "sprint/2026-04-26-01",
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
    "recommended_flow": "轻量流程 (Phase 0-3, reduced-intensity Delphi)|标准流程 (Phase 0-4)|完整 Sprint Flow (Phase 0-8)",
    "risk_warnings": ["循环依赖: user ↔ plane"],
    "user_decision": "accepted|overridden|cancelled",
    "override_reason": null
  },
  "phase_history": [
    {
      "phase": -1,
      "phase_name": "ISOLATE",
      "status": "completed",
      "started_at": "2026-04-26T10:00:00Z",
      "completed_at": "2026-04-26T10:03:00Z",
      "duration_seconds": 180
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
- `task_description`: Sprint 需求描述（Phase -1 启动时写入）
- `started_at`: Sprint 启动时间戳（Phase -1 启动时写入，ISO 8601 格式）
- `phase_history`: 阶段历史数组，每个元素记录阶段的执行信息：
  - `phase`: 阶段编号
  - `phase_name`: 阶段名称
  - `status`: completed / running / failed / skipped
  - `started_at`: 阶段开始时间（ISO 8601）
  - `completed_at`: 阶段完成时间（null 表示未完成）
  - `duration_seconds`: 耗时秒数（null 表示未完成）

**Eval assertions check for:** `phase`, `status`, `isolation.branch`, `outputs.specification`, `metrics.coverage_pct`, `phase_history`, `task_description`.

