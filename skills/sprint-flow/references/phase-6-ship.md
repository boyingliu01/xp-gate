# Phase 6: SHIP + DEPLOY（发布）

## 目标

创建 PR、合并部署、监控。生成 Sprint Summary。

---

## 调用 Skills

- `ship` (gstack) — 创建 PR
- `land-and-deploy` (gstack) — 合并部署
- `canary` (gstack) — 监控告警

---

## 执行步骤

### Step 1: 调用 ship skill

```bash
skill(name="ship", user_message="[MVP v1 代码]")
```

ship 执行：
- 检测 base branch
- run tests
- review diff
- bump VERSION
- update CHANGELOG
- commit, push
- create PR

**输出**: PR URL

⚠️ **暂停点**: PR 创建后等待用户确认合并

---

### Step 2: 用户确认合并

提示用户：

```
⚠️ PR 已创建: [PR URL]

请确认是否合并：
- "合并" → 调用 land-and-deploy
- "等待" → 暂停等待人工 review
- "取消" → 结束 Sprint，不发布
```

---

### Step 3: 调用 land-and-deploy（用户确认后）

```bash
skill(name="land-and-deploy", user_message="--pr [PR URL]")
```

执行：
- merge PR
- wait for CI
- verify production health

**如果失败**:
- ⚠️ 暂停等待用户处理

**如果成功**:
- 自动进入 Step 4

---

### Step 4: 调用 canary skill

```bash
skill(name="canary", user_message="--url [production URL]")
```

执行：
- post-deploy monitoring
- console errors detection
- performance regression check

**如果发现异常**:
- 回退或修复

**如果正常**:
- 进入 Step 5

---

### Step 5: 生成 Sprint Summary

使用模板：`@templates/sprint-summary-template.md`

包含：
- Sprint ID
- 执行阶段统计
- emergent 发现统计
- Sprint 2 是否需要

---

### Step 6: 保存 Sprint Summary

保存到 `<project-root>/.sprint-state/phase-outputs/sprint-summary.md`

---

## 暂停点

| 暂停点 | 触发条件 | 用户操作 |
|--------|---------|---------|
| ship PR 创建 | PR 已创建 | 用户确认合并 |
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