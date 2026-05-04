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
IF 测试全部通过 + 用户确信 → merge → land-and-deploy
IF 测试全部通过 + 需要 review → PR → ship → 等待 review → land-and-deploy
IF 实验失败 → discard → 清理 worktree → 结束 Sprint
IF 半成品 → keep → 保留分支 → 结束 Sprint
```

**worktree 清理**: finishing-a-development-branch 自动清理不再需要的 worktree。

### Step 3: 用户确认合并/发布

提示用户：
```
⚠️ 分支完成决策:

- [merge] → 直接合并 + 部署
- [PR] → PR 已创建: [URL]，请确认合并
- [discard] → 清理分支，结束 Sprint
- [keep] → 保留分支，待后续处理

请确认选项：
```

**discard/keep**: 进入 Step 5（清理 + 生成 Summary）

**merge/PR 确认**: 进入 Step 4

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

⚠️ **暂停点**: PR 创建后等待用户确认合并

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
| ship PR 创建（PR 路径） | PR 已创建 | 用户确认合并 |
| land-and-deploy 失败 | CI 或部署失败 | 用户处理问题 |

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
