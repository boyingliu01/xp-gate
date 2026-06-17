# Phase 6: SHIP + DEPLOY（发布）

## 目标

结构化分支完成决策、创建 PR、合并部署、监控。生成 Sprint Summary。

---

## 调用 Skills

- **`finishing-a-development-branch`** _(新增)_ — 结构化完成流：4 选项决策（merge/PR/discard/keep）
- `ship` (gstack) — 创建 PR
- `land-and-deploy` (gstack) — 合并部署
- `canary` (gstack) — 监控告警

---

## 执行步骤

### Step 0: ⚠️ PHASE 5 硬门禁验证（不可跳过）

**必须首先验证 Phase 5 已完成**:

```bash
if [ ! -f ".sprint-state/phase-outputs/feedback-log.md" ]; then
  echo "[BLOCKED] Phase 5 FEEDBACK not completed. feedback-log.md not found."
  echo "Phase 5 must execute: learn + retro → generate feedback-log.md"
  echo "Return to Phase 5 before proceeding to SHIP."
  exit 1
fi
echo "✅ Phase 5 FEEDBACK verified — feedback-log.md exists"
```

**失败**: ⚠️ BLOCK → 返回 Phase 5 执行 learn + retro
**通过**: 进入 Step 1

### Step 1: 最终验证

```
skill(name="verification-before-completion", user_message="最终验证: [MVP v1] 完整性")
```

**验证内容**：
- 测试全部通过
- Lint 无错误
- 覆盖率 ≥ 80%

**失败**: ⚠️ BLOCK → 回退 Phase 2 修复

**通过**: 进入 Step 2

### Step 2: 结构化完成决策 — 调用 finishing-a-development-branch（新增 — ISSUE31）

```
skill(name="finishing-a-development-branch")
```

finishing-a-development-branch 执行 4 选项决策：

| 选项 | 行为 | 适用场景 |
|------|------|---------|
| **merge** | 直接合并到主分支 | 小功能、确信变更正确 |
| **PR** | 创建 PR 等待 review | 标准流程、需要团队审核 |
| **discard** | 删除分支、丢弃变更 | 实验失败、不再需要 |
| **keep** | 保留分支待后续处理 | 半成品、暂时搁置 |

**决策逻辑**:
```
IF 测试全部通过 + 用户确信 → merge → land-and-deploy (Step 4)
IF 测试全部通过 + 需要 review → PR → ship (Step 3a) → land-and-deploy (Step 4)
IF 实验失败 → discard → 清理 worktree → 结束 Sprint
IF 半成品 → keep → 保留分支 → 结束 Sprint
```

> **#218**: `finishing-a-development-branch` 的 4 选项决策已包含用户确认（Step 2），不再需要独立的 Step 3 重复确认。用户选择后直接路由到对应步骤。

**worktree 清理**: finishing-a-development-branch 自动清理不再需要的 worktree。

**分支完成选项路由**:
| 用户选择 | 路由 |
|---------|------|
| **merge** | → Step 4 (land-and-deploy) |
| **PR** | → Step 3a (ship) → PR URL → Step 4 (land-and-deploy) |
| **discard** | → Step 5 (cleanup + summary) |
| **keep** | → Step 5 (cleanup + summary) |

### Step 3a: 调用 ship skill（PR 路径）

```
skill(name="ship", user_message="[MVP v1 代码]")
```

ship 执行：
- 检测 base branch
- run tests
- review diff
- bump VERSION
- update CHANGELOG
- commit, push, create PR

**输出**: PR URL

> **注意**: PR 创建后不暂停等待用户确认合并。用户已通过 finishing-a-development-branch 选择了 PR 路径（Step 2），ship 自动完成后直接进入 Step 4 land-and-deploy 继续执行。如果用户需要暂停审查 PR，应在 Sprint 开始时指定 `--stop-at ship`。

### Step 4: 调用 land-and-deploy（用户确认后）

```
skill(name="land-and-deploy", user_message="--pr [PR URL]")
```

执行：
- merge PR（或直接合并当前分支）
- wait for CI
- verify production health

**如果失败**:
- ⚠️ 暂停等待用户处理

**如果成功**:
- 自动进入 Step 5

### Step 5: 调用 canary skill

```
skill(name="canary", user_message="--url [production URL]")
```

执行：
- post-deploy monitoring
- console errors detection
- performance regression check

**如果发现异常**:
- 回退或修复

**如果正常**:
- 进入 Step 6

### Step 6: 生成 Sprint Summary

使用模板：`@templates/sprint-summary-template.md`

包含：
- Sprint ID
- 执行阶段统计
- 分支完成决策结果（merge/PR/discard/keep）
- emergent 发现统计
- Sprint 2 是否需要

### Step 7: 保存 Sprint Summary

保存到 `<project-root>/.sprint-state/phase-outputs/sprint-summary.md`

---

## 暂停点

| 暂停点 | 触发条件 | 用户操作 |
|--------|---------|---------|
| finishing-a-development-branch | 4 选项决策 | 用户选择 merge/PR/discard/keep |
| land-and-deploy 失败 | CI 或部署失败 | 用户处理问题 |

> **#218**: PR 创建后不再暂停等待确认 — 用户已通过 finishing-a-development-branch 选择了 PR 路径，ship 自动完成后直接进入 land-and-deploy。如果用户需要暂停审查 PR，应在 Sprint 开始时指定 `--stop-at ship`。

---

## Sprint 2 提示

如果 Sprint Summary 显示有 emergent issues：
```
Sprint 完成！发现 N 个 emergent issues。

是否开始 Sprint 2？
- "开始 Sprint 2" → 使用 sprint2-pain.md 重新进入 Phase 0
- "结束" → 记录未解决的问题，结束流程

Critical issues 将自动进入 Sprint 2。
Major/Minor issues 需您确认是否纳入。
```

---

## 输出

- Sprint Summary (`sprint-summary.md`)
- Sprint 完成（或 Sprint 2 开始）
