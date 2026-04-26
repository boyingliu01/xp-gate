# XGate 目录改名指南

## 背景

将本地项目目录从 `xp-workflow-automation` 改名为 `xgate`，与 GitHub 仓库名一致。

改名会影响 OpenCode 的 session 查找（通过 `project.worktree` 路径匹配），需要同步更新 SQLite 数据库。

## 操作步骤

### Step 1: 备份数据库

```bash
cp /home/boyingliu01/.local/share/opencode/opencode.db /home/boyingliu01/.local/share/opencode/opencode.db.bak
```

### Step 2: 改名目录

```bash
cd /mnt/e/Private/opencode优化
mv xp-workflow-automation xgate
```

### Step 3: 更新 OpenCode 数据库

```bash
# 更新 project 表的 worktree 路径
sqlite3 /home/boyingliu01/.local/share/opencode/opencode.db \
  "UPDATE project SET worktree='/mnt/e/Private/opencode优化/xgate' WHERE worktree='/mnt/e/Private/opencode优化/xp-workflow-automation';"

# 更新 session 表的 directory 路径
sqlite3 /home/boyingliu01/.local/share/opencode/opencode.db \
  "UPDATE session SET directory='/mnt/e/Private/opencode优化/xgate' WHERE directory='/mnt/e/Private/opencode优化/xp-workflow-automation';"
```

### Step 4: 验证

```bash
# 确认 project 记录已更新
sqlite3 /home/boyingliu01/.local/share/opencode/opencode.db \
  "SELECT id, worktree FROM project WHERE worktree LIKE '%xgate%';"

# 确认 session 数量不变（应为 210 个）
sqlite3 /home/boyingliu01/.local/share/opencode/opencode.db \
  "SELECT COUNT(*) FROM session WHERE directory='/mnt/e/Private/opencode优化/xgate';"

# 确认旧路径无残留
sqlite3 /home/boyingliu01/.local/share/opencode/opencode.db \
  "SELECT COUNT(*) FROM session WHERE directory='/mnt/e/Private/opencode优化/xp-workflow-automation';"
```

预期结果：
- 新路径 project 记录：1 条
- 新路径 session 数量：210
- 旧路径 session 数量：0

### Step 5: 在新目录启动 OpenCode

```bash
cd /mnt/e/Private/opencode优化/xgate
opencode
```

检查 session 列表（`<leader>l`），应能看到全部历史 session。

## 回滚方案

如果出问题，恢复数据库备份：

```bash
cp /home/boyingliu01/.local/share/opencode/opencode.db.bak /home/boyingliu01/.local/share/opencode/opencode.db
```

然后改回目录名：

```bash
cd /mnt/e/Private/opencode优化
mv xgate xp-workflow-automation
```

## 原理说明

OpenCode 使用 SQLite 数据库 (`/home/boyingliu01/.local/share/opencode/opencode.db`) 存储 session：

| 表 | 关键字段 | 作用 |
|---|---|---|
| `project` | `id` (PK), `worktree` (目录路径) | 项目记录，通过 worktree 路径匹配 |
| `session` | `project_id` (FK), `directory` | 会话记录，关联到 project |

启动 OpenCode 时，用当前工作目录匹配 `project.worktree`。路径不匹配则创建新 project，旧 session 全部不可见。两条 SQL 更新路径即可恢复关联。
