# Phase 6/6: CLOSE（收尾 — ⚠️ 人工验收 + 清理）

**执行时机**: Phase 5/6 SHIP 完成后（merge to main + release 已完成）。
**对应旧模型**: Phase 7 USER ACCEPTANCE + Phase 8 CLEANUP

**NETWORK-RESILIENCE**: 与 Phase 5/6 相同，GitHub API 在大中华区存在间歇性超时。CLEANUP 中的 `gh pr list` 和 `git push --delete` 需容忍重试。详见 `phase-5-ship.md` NETWORK-RESILIENCE 指南。

---

## ⚠️ HARD-GATE: SHIP→CLOSE GATE (MANDATORY — v0.14.3+)

**Purpose**: Verify that Phase 5/6 SHIP fully completed (merge to main + release) before entering Phase 6/6 CLOSE. This gate prevents:
- Worktree cleanup failure (uncommitted changes prevent `git worktree remove`)
- UAT on wrong version (PR branch instead of merged main)

**Execution**: Before ANY Phase 6/6 step, run the SHIP→CLOSE GATE checks defined in `phase-5-ship.md#ship-completion-gate`.

**If gate fails**: Return to Phase 5/6 SHIP to complete merge/release. Do NOT proceed with CLOSE.

---

## Backup Sprint State (MANDATORY — v0.14.3+)

**Purpose**: `.sprint-state/` is gitignored and lives inside the worktree. When the worktree is removed during CLEANUP, all sprint state is lost. This step copies it into the main repository before cleanup.

**Execution** (immediately after SHIP→CLOSE GATE passes):

```bash
# 1. Read sprint ID
SPRINT_ID=$(cat .sprint-state/sprint-state.json | grep '"id"' | head -1 | sed 's/.*"id": *"\([^"]*\)".*/\1/')

# 2. Backup to repo-tracked path (.sprint-history is NOT in .gitignore)
BACKUP_DIR=".sprint-history/${SPRINT_ID}"
mkdir -p "$BACKUP_DIR"
cp -r .sprint-state/* "$BACKUP_DIR/"

# 3. Verify backup
ls "$BACKUP_DIR/sprint-state.json" && echo "✅ Sprint state backed up to $BACKUP_DIR"
```

**GATE CHECK**:
```
[BACKUP] sprint-state.json copied ✓
[BACKUP] phase-outputs/ preserved ✓
```

**Output**: `.sprint-history/<sprint-id>/` contains full sprint state, safely outside the worktree.

---

## Part A: USER ACCEPTANCE（⚠️ 人工验收）

### 目标

用户实际使用 MVP，发现 Emergent 问题。这是 AI 无法预测的环节。

### ⚠️ 关键说明

**这是 Emergent Requirements 发现环节。**

- AI 无法预测用户看到产品后才发现的问题
- 78% 的软件失败是用户使用时发现的，不是开发阶段发现的
- 必须由用户实际使用验收

### 调用 Skills

**无** — 必须人工

### 执行步骤

#### Step 1: 提示用户开始验收

```
⚠️ Phase 6/6 CLOSE: USER ACCEPTANCE

MVP 已通过自动化验证，现在需要您实际使用验收。

请按照以下步骤：
1. 启动应用（或访问部署地址）
2. 使用 Emergent Issues 检查清单进行验收
3. 记录发现的问题
4. 完成后确认是否继续

验收完成后，请回复：
- "验收通过" → 进入 Part B CLEANUP
- "发现问题" → 填写 emergent-issues.md
```

#### Step 2: 用户实际使用 MVP

用户按照 Emergent Issues 检查清单验收，使用模板：`@templates/emergent-issues-template.md`

检查维度：
1. **核心功能体验** (Core Functionality UX)
2. **多轮交互体验** (Multi-turn Interaction UX)
3. **视觉/交互体验** (Visual/Interaction UX)
4. **用户认知负担** (Cognitive Load)
5. **意外发现** (Unexpected Observations)

#### Step 3: 记录 Emergent Issues

用户填写 `emergent-issues.md`：

```markdown
# Emergent Issues - [需求名称]

## 验收日期: YYYY-MM-DD

## 发现的问题

### Critical
### Major
### Minor

## 验收结论
- [ ] ✅ 验收通过，进入 CLEANUP
- [ ] ⚠️ 发现问题需 Sprint 2 迭代
```

#### Step 4: 保存 Emergent Issues

保存到 `<project-root>/.sprint-state/phase-outputs/emergent-issues.md`

### 暂停点

**⚠️ 必须等待用户验收完成**

- 用户确认验收结果后才能继续
- 如果发现重大问题 → Sprint 2 回到 Phase 2/6 DESIGN

### Sprint 2 触发逻辑

```
Phase 6/6 CLOSE 完成时:
  IF emergent_issues_count == 0 → sprint_completed，结束流程
  
  IF emergent_issues_count > 0:
    ├─ IF emergent_issues 有 Critical → 自动启动 Sprint 2
    ├─ IF emergent_issues 仅 Major/Minor → 询问用户
    └─ Sprint 2 Pain Document 从 emergent-issues.md 转化
```

### 输出

- Emergent Issues List (`emergent-issues.md`)
- 进入 Part A.5 ARCHIVE 自动执行（如果用户确认验收）

---

## Part A.5: ARCHIVE（归档 — v0.14.0+ Issue #308）

**Purpose**: Preserve sprint decision records before cleanup. `.sprint-state/` is gitignored and deleted during CLEANUP; this step copies structured outputs to `.sprint-history/` which is tracked by git.

**Execution**: After USER ACCEPTANCE (Part A) confirms continuation, BEFORE CLEANUP (Part B).

### Step 1: Read Sprint ID

Read `sprint-state.json` → `id` field (e.g., `sprint-2026-07-09-01`).

### Step 2: Check for Conflicts

```
IF .sprint-history/<sprint-id>/ already exists:
  → Append timestamp suffix: <sprint-id>-20260709T120000
  → Log warning: "Sprint archive conflict, using timestamp suffix"
```

### Step 3: Archive Files

Copy from `.sprint-state/` to `.sprint-history/<sprint-id>/`:

**Included** (all `.yaml`, `.json`, `.md` files under `.sprint-state/`):
- `specification.yaml` (if in phase-outputs/)
- `delphi-reviewed.json`
- `sprint-state.json`
- `phase-outputs/*.yaml`, `phase-outputs/*.json`, `phase-outputs/*.md`
- `tdd-gate-log.json`, `uncommitted-gate-log.json`

**Excluded** (temporary/cache):
- `*.tmp`, `*.cache` files
- `sprint.lock` (session lock file)

### Step 4: Verify Git Tracking

```bash
# .sprint-history/ is NOT in .gitignore (verified — no change needed)
# Verify files are trackable:
git status .sprint-history/
```

**No `.gitignore` change needed**: `.sprint-history/` is NOT currently listed in `.gitignore`. The `.sprint-state/` ignore (line 59) only matches `.sprint-state/` exactly — it does NOT match `.sprint-history/`.

### Step 5: Commit Archive (Optional)

The orchestrator MAY commit the archive:
```
git add .sprint-history/<sprint-id>/ && git commit -m "archive: sprint <sprint-id>"
```

### Output

- `.sprint-history/<sprint-id>/` directory with archived sprint state
- Git-tracked sprint decision records for future retro/review

---

## Part B: CLEANUP（清理 + 总结）

**摘要**: 自动清理 worktree, 更新 sprint-state.json, 输出 Sprint Summary, 处理 emergent issues.

### 执行步骤

1. **保存分支信息** → 记录清理前的分支和工作树信息
2. **清理 worktree**: `git worktree remove <worktree_path>`（精确路径，禁止通配符）
   - 重试机制: 失败后重试最多 3 次，每次间隔 3 秒
   - 仍失败: 输出 `[ERROR]` + 手动清理命令
3. **删除本地分支**: `git branch -D sprint/YYYY-MM-DD-NN`
4. **删除远程分支**: `git push origin --delete sprint/YYYY-MM-DD-NN`
5. **关闭遗留 OPEN PR**: `gh pr list --head sprint/YYYY-MM-DD-NN --state open`
6. **更新 sprint-state.json**: 设置 `phase: 6`, `status: "completed"`
7. **释放 Sprint Lock** (Issue #144): 删除 `.sprint-state/sprint.lock`
8. **Sprint Summary**: 使用 `templates/sprint-summary-template.md` 生成总结
9. **处理 Emergent Issues**: 如 Part A 发现 emergent issues → 触发 Sprint 2 逻辑

### 输出

- Cleanup Report
- Sprint Summary
- 条件跳过: `--no-isolate` 路径下跳过 worktree 清理（无 worktree 可清理）

### 暂停点

- **清理失败**: 输出 `[ERROR]` 日志 + 建议手动清理命令 → 用户确认后继续
- **Sprint Summary**: 展示完整 Sprint 总结 → 用户确认 → 结束流程
