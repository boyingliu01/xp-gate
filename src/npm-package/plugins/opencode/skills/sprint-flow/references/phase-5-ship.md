# Phase 5/6: SHIP（发布 — 发布准备 + 合并部署）

**执行时机**: Phase 4/6 VERIFY 完成后、Phase 6/6 CLOSE 之前。
**对应旧模型**: Phase 5 SHIP + Phase 6 LAND

**摘要**: 结构化分支完成决策, 创建 PR, 合并部署, 监控. 生成 Sprint Summary.

---

## Part A: SHIP（发布准备）

**完整指令**: @see SKILL.md Phase 5/6 SHIP section.

**Orchestrator 直接执行**: `finishing-a-development-branch` 和 `ship` 均为交互式 skill（4 选项菜单 + PR 确认），**必须由 orchestrator 直接调用**。

**关键链**: VERSION-GATE(MANDATORY) → finishing-a-development-branch(4选项) → push PR

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

### Step 0: VERSION-GATE（MANDATORY — 在 finishing-a-development-branch 之前执行）

**Purpose**: Ensure version bump, changelog update, and sync before creating PR. This MUST run BEFORE calling `finishing-a-development-branch` — the skill's "Create PR" option creates the PR immediately, so version changes must be committed first.

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

**GATE CHECK** (BEFORE proceeding to finishing-a-development-branch):
```
[VERSION-GATE] VERSION bump ✓   # VERSION 文件已更新
[VERSION-GATE] CHANGELOG ✓      # 新版本条目已添加
[VERSION-GATE] sync-version ✓   # 所有 package.json 已同步
[VERSION-GATE] committed ✓      # 版本变更已提交并推送
[VERSION-GATE] PR updated ✓     # PR 已包含版本变更 commit
```

**⚠️ ANTI-PATTERN**: 先调用 finishing-a-development-branch 创建 PR，再 bump VERSION 会导致 PR 不含版本变更 → CI 不触发 release workflow → 无新版本发布。

**输出**: 版本变更 commit 包含在 PR 中

---

## Part B: LAND（合并 + 部署）

**Orchestrator 直接执行**: `land-and-deploy` 包含 merge 确认和 rollback 决策，**必须由 orchestrator 直接调用** `skill(name="land-and-deploy")`

**输入**: PR URL → 输出: 部署状态 + Canary 报告

**流程**: Merge PR → 等待 CI (10min) → 等待 Deploy (10min) → Canary Health Check (5min)

**回滚**: `git revert` 最后一次 merge commit

**条件跳过**: 无部署配置时仅 merge + CI

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
