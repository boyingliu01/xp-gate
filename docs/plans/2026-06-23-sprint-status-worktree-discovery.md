# 设计: TUI 面板从 worktree 发现 sprint 状态

**Status**: APPROVED (Round 2 consensus: Expert A APPROVED, Expert B REQUEST_CHANGES with spec gaps now filled)
**Author**: Sisyphus
**Date**: 2026-06-23
**Issue**: #247

## 1. 问题

Sprint Flow 在 git worktree 中运行，状态写入 `<worktree>/.sprint-state/sprint-state.json`。
但 TUI 插件 (`tui-plugin.ts`) 和 CLI (`sprint-status.js`) 都只从 `process.cwd()` 读取，
`cwd` 是 OpenCode 工作区根目录（主仓库），永远看不到 worktree 中的活跃 sprint。

用户预期：右侧面板始终显示**当前所有活跃 worktree 的 sprint 进度**，没有活跃 sprint 时不显示。

## 2. 约束

### 2.1 架构约束

- **主仓库不含活跃 sprint 状态**：只有已合并的 sprint 残留。读取主仓库 `.sprint-state/` 无意义。
- **多 worktree 并发**：可能同时有多个 sprint 在不同 worktree 中运行。面板应展示所有活跃 sprint。
- **sprint-state.json 包含 `isolation.worktree_path`**：可直接明确知道状态来自哪个 worktree
- **TUI plugin 无状态**：每次 `sidebar_content` 回调都是全新调用
- **不允许 Git 命令调用**：`sidebar_content` 中禁止 spawn git 进程（锁问题）

### 2.2 性能约束

- `sidebar_content` 钩子在每次用户输入时触发，必须轻量（<10ms）
- 不能每次都做磁盘扫描 → **需要内存缓存（5s TTL）**

## 3. 设计方案 (Round 2 修订)

### 3.1 架构改动：抽取共享发现模块

**新增文件**: `src/npm-package/lib/sprint-discovery.ts`

```
位置: src/npm-package/lib/sprint-discovery.ts
作用: sprint 状态发现逻辑的单一事实来源
消费方:
  - plugins/opencode/tui-plugin.ts   (TUI sidebar)
  - src/npm-package/lib/sprint-status.js  (CLI)
```

这是两位专家都指出的核心问题——避免 TUI 和 CLI 各自实现一遍发现逻辑。

### 3.2 发现策略 (Round 2 改进)

```
cwd → 向上遍历找到 Git 根目录（查找 .git/）
   → 在 Git 根下扫描 .worktrees/sprint/ 子目录
   → 对每个 sprint-* 子目录读取 sprint-state.json
   → 合并 cwd 自身的 .sprint-state/（兼容非 worktree 模式）
   → 去重（同一个 sprint 可能同时出现在 worktree 和 cwd fallback）
   → 过滤：排除 status === "completed" 且 worktree 目录已被删除的孤儿 sprint
   → 排序：最近启动的 sprint 排前面
   → 上限：最多返回 5 个（面板显示前 3，其余折叠）
```

### 3.3 核心函数签名

```typescript
// sprint-discovery.ts
interface DiscoveredSprint {
  state: SprintState;           // 解析后的 sprint-state.json
  sourcePath: string;           // 发现来源（哪个目录的 sprint-state.json）
  worktreeExists: boolean;      // 对应 worktree 目录是否存在
}

function discoverActiveSprints(dir: string): DiscoveredSprint[]
```

**关键改进**：
- 返回类型包含 `worktreeExists` 字段，用于过滤孤儿 sprint
- 路径去重：用 `state.id` 去重，同一 sprint 多个来源时优先选 worktree 版本
- 每个 sprint 独立 try/catch，单个损坏不影响其他

### 3.4 缓存策略

TUI 插件使用模块级内存缓存（5s TTL）：

```typescript
// tui-plugin.ts
let _cachedResult: { data: DiscoveredSprint[]; ts: number } | null = null;

function getActiveSprints(cwd: string): DiscoveredSprint[] {
  const now = Date.now();
  if (_cachedResult && now - _cachedResult.ts < 5000) {
    return _cachedResult.data;
  }
  const data = discoverActiveSprints(cwd);
  _cachedResult = { data, ts: now };
  return data;
}
```

CLI 不使用缓存（每次命令调用都重新扫描，因为 CLI 是一次性执行）。

### 3.5 渲染策略

**多 sprint 渲染规则**：

| 活跃 sprint 数 | 行为 |
|----------------|------|
| 0 | 不显示侧边栏内容（返回 null） |
| 1 | 显示单个 sprint 进度（现有行为） |
| 2-3 | 全部显示，最近修改的排最前，每个 sprint 以 `---` 分隔 |
| 4+ | 显示前 3 个，底部显示 `… +N more` |

每个 sprint 区块包含：
```
SPRINT: <task_description or sprint ID>
  branch: <branch>
  ✓ ISOLATE  ✓ THINK  → PLAN  ○ BUILD  ...
```

**排序规则**：按 `started_at` 降序（最近启动的在前）。

**`task_description` 缺失时的 fallback**：
- 优先用 `state.id` 中的日期部分 + "Sprint" 前缀，如 `Sprint 2026-06-23 #01`
- 如果有 `isolation.branch` 且包含分支名，用分支名

### 3.6 修改范围

| 文件 | 改动 | 类型 |
|------|------|------|
| `src/npm-package/lib/sprint-discovery.ts` | **新增**：共享发现模块 | 新文件 |
| `plugins/opencode/tui-plugin.ts` | 使用 `discoverActiveSprints()` + 缓存 + 多 sprint 渲染 | 修改 |
| `src/npm-package/lib/sprint-status.js` | 新增 `--all` flag，调用发现模块 | 修改 |
| `src/npm-package/lib/__tests__/sprint-discovery.test.ts` | TDD 测试 | 新文件 |
| `plugins/opencode/__tests__/tui-plugin.test.ts` | 补充多 sprint 渲染测试 | 修改 |

### 3.7 边界情况处理

| 场景 | 行为 |
|------|------|
| 无 worktree 目录 | 退回 cwd 读取 |
| worktree 存在但无 sprint-state.json | 跳过 |
| sprint 已完成 | 过滤，不显示 |
| sprint 状态为 in_progress 但 worktree 被删除（孤儿） | 检查 `worktreeExists`，true→显示(标记 stale)，false→过滤 |
| sprint-state.json 格式损坏 | 独立 try/catch，跳过该 sprint |
| 同一 sprint 同时在 worktree 和 cwd 发现 | 去重，优先 worktree |
| 同一 sprint.id 出现在两个不同 worktree（竞态） | **Tie-breaker**: `started_at` 更新的胜出；若 timestamp 相同，`worktree_path` 字典序最小胜出（可预测） |
| cwd 本身在 worktree 内部 | 向上遍历找到 Git 根目录再扫描 |
| 多个活跃 sprint | 按启动时间排序，最多显示 5 个（面板前 3+折叠） |
| 文件权限错误 (EACCES) | try/catch 包裹，跳过该目录；TUI 日志警告，CLI stderr 提示 |
| sprint-state.json 无 `task_description` | fallback: sprint ID + 日期 |
| sprint-state.json 有效 JSON 但缺少必填字段 (`id`, `status`) | 跳过（当作损坏），记录告警 |
| `.worktrees/` 本身无读权限 | 退回 cwd 读，不报错 |
| symlink worktree 目录 | 正常处理（`readdirSync` 跟随符号链接） |
| 排序稳定性 | `started_at` 降序 → `state.id` 降序 (二级键，确保确定性) |

### 3.9 已知限制 (v1 不满足)

| 限制 | 影响 | 未来方向 |
|------|------|---------|
| 缓存 TTL 5s（硬编码） | 外部状态变更最多 5s 延迟 | v2: 文件 mtime 快速校验 + `XP_GATE_CACHE_TTL` env var |
| Git 根发现每次缓存过期后重算 | 首次回调 ~2ms 额外开销 | 可接受（深度非热点路径） |
| CLI `--all` 折叠策略不同于 TUI | CLI 无折叠（管输友好），TUI 折叠 3 | 两者场景不同，差异有意为之 |

### 3.8 不修改的部分

- **sprint-state.json schema**：不变
- **Phase 持久化逻辑**：不变
- **主仓库 `.sprint-state/`**：不写入，仅在回退时读取
- **tui.json 配置**：不变
- **Git hooks**：不变

## 4. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 每次 TUI 回调做磁盘 I/O | 5s TTL 内存缓存 |
| 孤儿 sprint 永久污染面板 | 检查 `worktreeExists` 过滤 |
| TUI/CLI 发现逻辑不同步 | 共享 `sprint-discovery.ts` |
| 用户在 worktree 内运行 | 向上遍历到 Git 根再扫描 |
| 缓存导致状态更新延迟（最多 5s） | 可接受，sprint 状态变化频率远低于用户输入频率 |

## 5. 实现计划

1. **TDD 先写测试**：`sprint-discovery.test.ts` 覆盖所有边界情况
2. **实现 `sprint-discovery.ts`**：共享发现模块
3. **修改 `tui-plugin.ts`**：调用发现模块 + 缓存 + 多 sprint 渲染
4. **修改 `sprint-status.js`**：`--all` flag
5. **修正 `sprint-state.json` schema 写入**：确保 `task_description` 被写入
6. **lint + 测试验证**
