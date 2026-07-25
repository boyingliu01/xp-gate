# Phase 5/6: SHIP（发布 — 发布准备 + 合并部署）

**执行时机**: Phase 4/6 VERIFY 完成后、Phase 6/6 CLOSE 之前。
**对应旧模型**: Phase 5 SHIP + Phase 6 LAND

**摘要**: 结构化分支完成决策（原生 4 选项）, 创建 PR（原生步骤）, 合并部署（原生步骤）, 监控. 生成 Sprint Summary.

---

## Part A: SHIP（发布准备）

**Orchestrator 直接执行**: 分支完成决策和 PR 创建均为交互式步骤（4 选项菜单 + PR 确认），**必须由 orchestrator 直接执行**。

**关键链**: VERSION-GATE(MANDATORY) → 分支完成决策(4选项) → push PR

**HARD-GATE**: Phase 4/6 VERIFY 未完成 → BLOCK。验证 `feedback-log.md` 存在。

**GITHOOKS-GATE**: 验证 hooks 完整性，缺失则 `githooks/install.sh`

**NETWORK-RESILIENCE**: GitHub API 在大中华区存在间歇性 TLS/超时问题。所有 `gh` CLI 调用应容忍偶尔失败：
- `gh` 命令失败时等待 2-5 秒后重试（最多 3 次）
- 优先使用 REST API (`gh api /repos/...`) 而非 GraphQL (`gh pr view --json ...`)，REST 更轻量更可靠
- 验证 CI 状态时使用 `gh run list --branch ... --limit 1 --json status,conclusion` 代替 `gh pr view --json statusCheckRollup`
- 如果 `gh` 持续超时，fallback 到 `curl + token`:
  ```
  curl -s -H "Authorization: token $(gh auth token)" \
    "https://api.github.com/repos/OWNER/REPO/commits/HEAD/status"
  ```

### Step 0: VERSION-GATE（MANDATORY — 在分支完成决策之前执行）

**Purpose**: Ensure version bump, changelog update, and sync before creating PR. This MUST run BEFORE the branch completion decision — the "Create PR" option creates the PR immediately, so version changes must be committed first.

**Execution**:

```
1. 根据变更类型决定 bump 级别:
   - PATCH (0.14.0 → 0.14.1): bug fixes, docs, minor enhancements
   - MINOR (0.14.0 → 0.15.0): new features, significant enhancements
   - MAJOR (0.14.0 → 1.0.0): breaking changes

2. 更新 VERSION 文件 (MAJOR.MINOR.PATCH.MICRO 格式)

3. 更新 CHANGELOG.md:
   - 添加新版本条目 (## [X.Y.Z.W] - YYYY-MM-DD)
   - 按 ### Added / ### Fixed / ### Changed 分类

4. 运行 sync-version.sh:
   bash scripts/sync-version.sh

5. 验证:
   git diff VERSION              # 确认版本号变更
   git diff CHANGELOG.md         # 确认 changelog 变更
   git diff --stat               # 确认 package.json 版本同步

6. 提交版本变更:
   git add VERSION CHANGELOG.md && git commit -m "release: bump version to X.Y.Z.W"

7. 推送到远程分支:
   git push

8. 验证 CI 流程触发:
   gh pr view <PR_NUMBER> --json state  # 确认 CI 已开始
```

**GATE CHECK** (BEFORE proceeding to branch completion decision):
```
[VERSION-GATE] VERSION bump ✓   # VERSION 文件已更新
[VERSION-GATE] CHANGELOG ✓      # 新版本条目已添加
[VERSION-GATE] sync-version ✓   # 所有 package.json 已同步
[VERSION-GATE] committed ✓      # 版本变更已提交并推送
[VERSION-GATE] PR updated ✓     # PR 已包含版本变更 commit
```

**⚠️ ANTI-PATTERN**: 先创建 PR 再 bump VERSION 会导致 PR 不含版本变更 → CI 不触发 release workflow → 无新版本发布。

**输出**: 版本变更 commit 包含在 PR 中

### Step 1: 分支完成决策（原生 4 选项 — AskUserQuestion）

VERSION-GATE 通过后，orchestrator 向用户展示 4 选项菜单：

```
⚠️ Phase 5/6 SHIP: 分支完成决策

Sprint 分支已准备就绪。请选择操作：

1. **Merge to main** — 直接合并到主分支（适用于个人项目或已确认无需 PR 审查）
2. **Push and create a Pull Request** — 推送并创建 PR（推荐，含 CI 验证）
3. **Keep branch** — 保留分支，稍后处理
4. **Discard** — 丢弃分支（⚠️ 需要输入确认）

请选择 (1-4):
```

**Option 4 (Discard) 安全确认**: 要求用户输入分支名确认，防止误删。

**默认推荐**: Option 2（Push and create a Pull Request）。

### Step 2: 原生 Ship 步骤序列（选择 Option 2 时执行）

```
1. 运行测试:
   npm test  # 或项目特定测试命令

2. VERSION-GATE 已通过（Step 0）

3. 提交所有变更:
   git add -A && git commit -m "feat: <sprint-description>"

4. 推送到远程:
   git push -u origin <sprint-branch>

5. 创建 PR:
   gh pr create --title "feat: <description>" --body "<sprint-summary>"

6. 输出 PR URL
```

**输出**: PR URL (含版本变更 commit)

---

## Part B: LAND（合并 + 部署 — 原生步骤）

**Orchestrator 直接执行**: 合并确认和 rollback 决策均为用户交互点，**必须由 orchestrator 直接执行**。

**输入**: PR URL → 输出: 部署状态 + Canary 报告

### Step 1: Merge 确认

```
⚠️ 确认合并 PR #<number> 到 main?

PR: <PR URL>
变更: <files changed> 个文件, +<additions>/-<deletions>

确认合并? (yes/no):
```

### Step 2: 等待 CI

```
# 等待 CI 完成（最多 10 分钟）
gh run list --branch main --limit 1 --json status,conclusion

# 轮询直到完成
WHILE status != "completed":
  等待 30 秒
  重新查询
```

### Step 3: 等待 Deploy（如适用）

```
# 等待部署完成（最多 10 分钟）
# 检测部署平台（Fly.io/Render/Vercel/Netlify/Heroku/GitHub Actions）
# 查询部署状态
```

**条件跳过**: 无部署配置时仅 merge + CI。

### Step 4: Canary Health Check（如适用，最多 5 分钟）

```
# 健康检查端点
curl -s <health-check-url>
# 验证返回 200 + 预期响应
```

### Step 5: 失败回滚

```
IF CI 失败 OR 部署失败 OR canary 异常:
  git revert <merge-commit-sha>
  git push
  输出 "[ROLLBACK] 已回滚 merge commit"
```

**输出**: 部署状态 (success/failure/skipped), Canary 报告

---

## SHIP COMPLETION GATE (MANDATORY — v0.14.3+)

**Purpose**: Ensure merge to main + release is complete before Phase 6/6 CLOSE. Without this gate, worktree cleanup fails (uncommitted changes + unmerged branch) and UAT happens on the wrong version (PR branch, not main).

**Execution** (BEFORE transitioning to Phase 6/6):

```
1. Verify PR is merged:
   gh pr list --head <sprint-branch> --state merged --json number
   → If no merged PR: BLOCK. Do NOT proceed to Phase 6/6.

2. Verify current branch is main:
   CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
   → If not main/master: BLOCK. Switch to main first.

3. Verify git status is clean:
   git status --porcelain
   → If not empty: BLOCK. Stash or commit changes first.

4. Verify release exists:
   gh release view v<X.Y.Z> --json tagName
   → If not found: WARNING (manual release may have failed). Ask user.

5. Pull latest main:
   git checkout main && git pull
```

**GATE CHECK** (BEFORE Phase 6/6 CLOSE):
```
[SHIP→CLOSE GATE] PR merged ✓        # PR is in merged state
[SHIP→CLOSE GATE] on main branch ✓   # Current branch is main/master
[SHIP→CLOSE GATE] clean status ✓     # No uncommitted changes
[SHIP→CLOSE GATE] release exists ✓   # GitHub Release created
[SHIP→CLOSE GATE] main up-to-date ✓  # Pulled latest
```

**IF GATE FAILS**: Orchestrator MUST complete the merge/release steps BEFORE proceeding to Phase 6/6. Do NOT skip to CLOSE.

**Output**: SHIP completion confirmation, ready for Phase 6/6.
