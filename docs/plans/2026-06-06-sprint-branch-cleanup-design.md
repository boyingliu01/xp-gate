# Sprint Branch 生命周期管理修复方案

**日期**: 2026-06-06
**状态**: DRAFT — 待 Delphi Review
**关联 Issue**: #146 (sprint-state enforcement)

---

## 1. 问题描述

xp-gate 项目远程仓库积累了 13 个遗留 sprint 分支，所有分支的工作都已完成并 squash merge 到 main，但远程分支从未被删除。

### 1.1 现状数据

| 分支 | 领先 main | PR | PR 状态 | 分析 |
|------|----------|-----|---------|------|
| sprint/2026-05-25-01 | 0 | #70 | MERGED | 完全合并，无残留 |
| sprint/2026-05-25-02 | 0 | #69 | MERGED | 完全合并，无残留 |
| sprint/2026-05-28-01 | 4 | #75 | MERGED | squash 合并，4 孤儿 commit |
| sprint/2026-05-30-01 | 10 | #91 | **OPEN** | PR 未关闭，v0.5.0 安装修复，已被后续多个 PR 替代实现 |
| sprint/2026-05-31-01 | 1 | #94 | MERGED | squash 合并，1 孤儿 commit |
| sprint/2026-06-01-03 | 6 | #96 | **CLOSED** | PR 被关闭，内容被 #97 重新实现 |
| sprint/2026-06-01-14 | 1 | #97 | MERGED | squash 合并，1 孤儿 commit |
| sprint/2026-06-02-15 | 5 | #125 | MERGED | squash 合并，5 孤儿 commit |
| sprint/fix-remaining-issues | 1 | #126 | MERGED | squash 合并，1 孤儿 commit |
| sprint/2026-06-04-01 | 6 | #131 | MERGED | squash 合并，6 孤儿 commit |
| sprint/2026-06-04-02 | 2 | #132 | MERGED | squash 合并，2 孤儿 commit |
| sprint/2026-06-05-01 | 6 | #138 #139 | MERGED×2 | 两 PR 都已合并，6 孤儿 commit |
| sprint/2026-06-05-03 | 1 | #147 | MERGED | squash 合并，1 孤儿 commit |

**结论**: 13 个分支全部可安全删除。

## 2. 根因分析

### 2.1 Phase 8 CLEANUP 设计缺陷

当前 SKILL.md Phase 8 CLEANUP（第 510-531 行）定义了 5 个步骤：

```
1. 检测 worktree 是否存在
2. git worktree remove <worktree_path>  ← 只删本地 worktree 目录
3. 残留检测
4. 更新 sprint-state.json
5. 输出 Cleanup Report
```

**缺失**：没有 `git branch -d`（删本地分支）和 `git push origin --delete`（删远程分支）。

### 2.2 Squash Merge 加剧问题

sprint-flow 统一使用 `gh pr merge --squash`，将分支上 N 个 commit 压缩为 main 上 1 个 commit。这导致：

- `git branch --merged main` **无法识别**这些分支（因为原始 commit 不在 main 历史中）
- 没有内置机制能自动发现和清理已 squash merge 的分支

### 2.3 因果链

```
Phase -1 ISOLATE: 创建远程分支 → git push -u origin sprint/*
Phase 7 LAND:     squash merge → main 产生 1 个新 commit
Phase 8 CLEANUP:  只删 worktree 目录 → 远程分支永久残留
```

### 2.4 附带问题：sprint-state.json 更新不可靠

即使 Phase 8 执行了，AI agent 也可能忘记更新 sprint-state.json（见 Issue #146）。这导致：
- 进度看板失真
- `--resume-from` 断点恢复不可靠

## 3. 修复方案

### 3.1 SKILL.md Phase 8 补全（立即执行）

在现有步骤 1 之前保存分支名，在步骤 3（残留检测）之后插入分支清理步骤：

```markdown
0. **保存分支信息**（在 worktree remove 之前执行）:
   - `sprint_branch=$(git branch --show-current)`
   - 如果 sprint_branch 为空或与 isolation.branch 不匹配: 使用 isolation.branch

1-3. （原有步骤不变: 检测 worktree → remove → 残留检测）

3.5. **删除本地和远程分支**（必须在步骤 2 worktree remove 成功后执行）:
   - 切回主分支: `cd <repo_root> && git checkout main && git pull origin main`
   - 删除本地分支: `git branch -D <sprint_branch>`
     - 使用 -D 因为 squash merge 后 git 不认为已合并
     - 如果分支不存在（已被其他流程删除）: 静默跳过
   - 删除远程分支: `git push origin --delete <sprint_branch>`
   - 如果远程分支删除失败: 输出 `[WARN] Remote branch cleanup failed, please manually run: git push origin --delete <sprint_branch>`

3.6. **关闭遗留 OPEN PR**:
   - `gh pr list --head <sprint_branch> --state open`
   - 如果存在 OPEN PR: 关闭并评论说明该 sprint 已通过其他 PR 完成
```

**执行顺序依赖**（必须在文档中明确标注）：
```
worktree remove (解除分支文件占用) → branch -D (删分支引用) → push --delete (删远程)
```

### 3.2 遗留分支批量清理（一次性执行）

#### Step 1: 验证 PR #91 可关闭性

**已验证**：PR #91（v0.5.0 安装体验修复）修改了 15 个文件，其中只有 3 个被 PR #94 覆盖。但：
- PR #91 的核心修复（npm install-skill 离线优先、公共 registry）已在后续多个 PR（#97, #125, #131, #138, #147）中被重新实现
- 项目当前版本 v0.5.1+，安装功能正常
- PR #91 的 10 个 commit 在 GitHub PR 页面永久可访问，不受分支删除影响

**结论**：PR #91 可安全关闭，注释说明"已被后续迭代替代实现，commits 仍可通过此 PR 页面访问"

```bash
# 关闭 PR #91
gh pr close 91 --comment "Superseded by subsequent PRs (#97, #125, #131, #138, #147) which reimplemented the same functionality. Commits remain accessible through this PR page."
```

#### Step 2: Dry-run 确认

```bash
# 先列出待删除分支，人工确认
echo "=== 待删除的远程分支 ==="
for branch in sprint/2026-05-25-01 sprint/2026-05-25-02 sprint/2026-05-28-01 \
  sprint/2026-05-30-01 sprint/2026-05-31-01 sprint/2026-06-01-03 \
  sprint/2026-06-01-14 sprint/2026-06-02-15 sprint/fix-remaining-issues \
  sprint/2026-06-04-01 sprint/2026-06-04-02 sprint/2026-06-05-01 \
  sprint/2026-06-05-03; do
  echo "  - $branch"
done
```

#### Step 3: 关闭 OPEN PR + 批量删除

```bash
# 关闭遗留 OPEN PR（仅在 Step 1 确认后执行）
gh pr close 91 --comment "Superseded by subsequent PRs (#97, #125, #131, #138, #147). Commits remain accessible through this PR page."

# 批量删除远程分支（13 个）
for branch in sprint/2026-05-25-01 sprint/2026-05-25-02 sprint/2026-05-28-01 \
  sprint/2026-05-30-01 sprint/2026-05-31-01 sprint/2026-06-01-03 \
  sprint/2026-06-01-14 sprint/2026-06-02-15 sprint/fix-remaining-issues \
  sprint/2026-06-04-01 sprint/2026-06-04-02 sprint/2026-06-05-01 \
  sprint/2026-06-05-03; do
  echo "Deleting $branch..."
  git push origin --delete "$branch"
done
```

### 3.4 同步更新所有 SKILL.md 副本

修改 `skills/sprint-flow/SKILL.md` 后，同步到：
- `plugins/claude-code/skills/sprint-flow/SKILL.md`
- `plugins/opencode/skills/sprint-flow/SKILL.md`
- `plugins/qoder/skills/sprint-flow/SKILL.md`
- `src/npm-package/skills/sprint-flow/SKILL.md`

## 4. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 删除仍有用的分支 | 低 | 13 个分支的 PR 全部已 MERGED/CLOSED，内容已在 main |
| PR #91 关闭后有人需要 | 低 | PR #94 已覆盖相同变更，PR #91 的 commit 可通过 GitHub ref 恢复 |
| Phase 8 新增的 branch -D 误删 | 低 | 限定只删 isolation.branch 名，且在 worktree remove 之后执行 |
| worktree remove 失败后误删分支 | 低 | 步骤 3.5 明确要求"必须在步骤 2 成功后执行" |
| 未来 sprint 不再产生遗留分支 | 高（正向） | SKILL.md 修复后每个 sprint 自动清理分支 |

## 5. 回滚方案

如果误删了远程分支，可通过以下方式恢复：
- **GitHub API**: 被删除的分支可通过 GitHub 的 "Restore branch" 功能恢复（在 PR 页面）
- **Git reflog**: 本地 `git reflog` 仍保留分支的 commit 引用（默认 90 天过期）
- **Fork**: 如果有人 fork 了该分支，可从 fork 重新推送

## 6. 不在本次范围

- Issue #146 (sprint-state.json enforcement CLI + hook) — 独立迭代
- `--no-isolate` 路径的分支清理 — 该路径不创建分支，无需清理
- `git worktree prune` 自动化 — 现有 `git worktree remove` 在步骤 2 已覆盖，prune 仅清理孤立 worktree 引用，不影响功能
