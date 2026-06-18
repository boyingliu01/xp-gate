# Phase -1: ISOLATE（git worktree 隔离）

**执行时机**: `/sprint-flow` 启动后、Phase 0 THINK 之前。**自动执行**。

**目的**: 默认在 git worktree 中隔离 sprint 工作，防止在保护分支上直接运行导致代码污染。

**AI agent 直接执行 bash 命令**（不需要调用外部 skill），步骤如下：

| 步骤 | 动作 | 说明 |
|------|------|------|
| 0 | **检测当前环境** | 运行 `git rev-parse --git-dir` 和 `git rev-parse --git-common-dir`。如果 `GIT_DIR != GIT_COMMON`：已在 worktree 中 → 输出 "Already in isolated worktree" → 进入 Phase 0 |
| 0.5 | **Sprint Lock 检测（Issue #144）** | 检查 `.sprint-state/sprint.lock` 是否存在: `[ -f .sprint-state/sprint.lock ]`。如果存在: 读取锁内容，检查是否 stale（超过 24 小时或 worktree 目录不存在）→ stale → 输出 `[WARN] 发现过期 sprint lock，将覆盖` → 更新锁。非 stale → 输出 `[BLOCK] 已有活跃 sprint (ID: {sprint_id}, started: {started_at})。请先完成当前 sprint 或手动删除 .sprint-state/sprint.lock` → 退出。锁不存在 → 创建锁: `echo '{"sprint_id":"sprint-YYYY-MM-DD-NN","started_at":"<ISO8601>"}' > .sprint-state/sprint.lock` |
| 1 | **检查保护分支** | 获取当前分支名 `git branch --show-current`。保护分支列表: `main, master, develop, trunk, mainline`。保护分支 → 强制创建 worktree。非保护分支 → 依然创建 worktree（推荐，不阻断） |
| 2 | **创建 worktree** | 创建目录: `mkdir -p .worktrees/sprint`。检测已有 NN 编号: `ls .worktrees/sprint/ 2>/dev/null \| grep -oE '[0-9]{2}$' \| sort -n \| tail -1`（取最后两位数字，数值排序，取最大），NN = 结果 + 1（无结果则从 01 开始）。运行 `git worktree add .worktrees/sprint/sprint-YYYY-MM-DD-NN -b sprint/YYYY-MM-DD-NN`。**注意**: `cd` 在 AI agent 单次工具调用中不保持状态，步骤 3-6 必须通过 `workdir` 参数或 `&&` 链式命令在新 worktree 目录下执行 |
| 3 | **项目 setup** | 在 worktree 目录下: 检测项目类型: `package.json` → `npm install`, `go.mod` → `go mod download`, `pyproject.toml` → `pip/poetry install` |
| 4 | **.gitignore 校验** | 在**仓库根目录**（非 worktree）执行: `git check-ignore -q .worktrees`。如果未忽略 → 将 `.worktrees/` 添加到 `.gitignore` → `git add .gitignore` → `git commit -m 'chore: ignore .worktrees directory'` |
| 5 | **Sprint State 记录** | `mkdir -p .sprint-state` 在 worktree 目录下。写入 `.sprint-state/sprint-state.json`（如已存在则合并，保留原有字段），新增/更新 `isolation` 对象，设置 `phase: -1`，`status: "running"` |
| 6 | **基线验证** | 在 worktree 目录下: 检测测试方式（package.json 有 "test" script → `npm test`, go.mod → `go test ./...`, pyproject.toml → `pytest`）。测试失败 → 输出失败信息 → 询问用户是否继续 |

## 参数处理

- `--no-isolate`: 跳过自动创建，输出 ⚠️ 警告 `'[WARN] 未创建 worktree 隔离，在 {branch} 分支上直接运行 sprint 有污染风险'` → 进入 Phase 0
- `--branch-name <name>`: 使用自定义分支名（默认自动生成 `sprint/YYYY-MM-DD-NN`），分支名中的 `/` 在 worktree 路径中自动替换为 `-`（如 `feat/user-login` → 分支名 `feat/user-login`，路径 `.worktrees/sprint/feat-user-login`）
- `--force`: 强制在当前分支继续（即使已是保护分支），**要求用户显式确认**: 输出 ⚠️ 警告 `'[WARN] 使用 --force 在 {branch} 分支上直接运行 sprint。此操作绕过隔离保护，请确认风险。'` → 等待用户确认（"继续" / "取消"） → 确认后进入 Phase 0

## 参数交互规则

| 参数组合 | 行为 |
|---------|------|
| `--no-isolate` 单独 | 跳过隔离，输出警告 → Phase 0 |
| `--force` 单独 | 跳过隔离，要求确认 → Phase 0 |
| `--no-isolate` + `--branch-name` | `--branch-name` 忽略，仅 `--no-isolate` 生效 |
| `--force` + `--branch-name` | `--branch-name` 忽略，仅 `--force` 生效 |
| `--no-isolate` + `--force` | 等效，输出 `--no-isolate` 警告 → Phase 0 |
| `--resume-from build` + `--no-isolate` | `--resume-from` 优先，直接跳过 Phase -1 |

## 错误处理和回退

| 错误场景 | 回退行为 |
|---------|---------|
| `git worktree add` 失败（沙箱/权限问题） | 输出 `[ERROR] git worktree add 失败: {error}` → `[WARN] 无法创建 worktree 隔离，将在当前目录继续。请手动设置隔离分支。` → 在当前目录继续 |
| `.gitignore` 自动添加失败 | 输出 `[WARN] 无法自动添加 .gitignore，请手动将 .worktrees/ 添加到 .gitignore` → 继续 |
| 基线测试失败 | 输出 `[FAIL] 基线测试未通过:` + 失败详情 → 询问用户 `'基线测试失败，是否继续 sprint？(y/N)'` |

## sprint-state.json isolation 对象格式

```json
{
  "isolation": {
    "worktree_path": ".worktrees/sprint/sprint-2026-05-24-01",
    "branch": "sprint/2026-05-24-01",
    "created_from": "main",
    "created_from_commit": "abc123def..."
  }
}
```

> **清理提示**: Sprint 完成（Phase 6 SHIP）后，执行 `git worktree remove <worktree_path>` 清理 worktree 目录，同时保留 `.sprint-state/` 中的历史记录。
