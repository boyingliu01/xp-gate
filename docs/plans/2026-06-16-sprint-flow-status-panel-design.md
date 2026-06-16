# 设计: OpenCode Sprint Flow 迭代状态面板

**Status**: REVISED (v2, after Delphi Round 1-3)
**Author**: Sisyphus
**Date**: 2026-06-16
**Issue**: #214

## 1. 问题

Sprint Flow 有 11 个阶段（Phase -1 到 Phase 8），开发时间跨度大。回到迭代时容易忘记当前执行到哪一步、已完成什么、还剩什么。

## 2. 约束

- **OpenCode Plugin SDK (`@opencode-ai/plugin@^1.15.0`) 不支持 Panel/Webview API**
- 支持的 hooks: tool, chat.message, event, dispose, config, shell.env, chat.params 等
- Plugin 导出方式: `pluginModule = { id, server: Plugin }`
- 当前插件实现为 `index.ts` 导出 3 个工具，无 UI
- `sprint-state.json` 由 Sprint Flow 在 worktree 中生成，路径为 `.sprint-state/sprint-state.json`
- **数据源必须与 sprint-flow 的 canonical schema 兼容**（定义见 `skills/sprint-flow/SKILL.md` L893-942）

## 3. 核心问题

**目前 OpenCode 插件 SDK 没有 Panel/Webview API。** 这意味着 #214 在当前的 SDK 版本下**无法通过插件实现**。

### 3.1 替代方案

#### 方案 A: OpenCode 平台支持 Panel (推荐 — 等待平台)

在 OpenCode SDK 增加 Panel/Webview API 之前无法实现。可以：
1. 提交 feature request 给 OpenCode 团队
2. 在 SDK 新增 `panel` 或 `webview` 注册接口后立即实现
3. 当前阶段：记录需求 + mock 实现，平台就绪后上线

#### 方案 B: TUI 内渲染 (次选)

利用 `experimental.chat.system.transform` hook 在系统提示中注入 sprint 状态。这样 AI agent 知道当前迭代状态，但不会展示在右侧面板。

**局限性**:
- 用户不可见（agent 内部提示）
- 信息密度低
- 不是"面板"的替代

#### 方案 C: `xp-gate sprint-status` CLI 命令 ✅ 选定

创建一个 CLI 子命令读取 `.sprint-state/sprint-state.json` 并以可读格式打印。用户随时运行 `xp-gate sprint-status` 查看状态。

**优点**:
- 立即可用，不依赖平台 API
- 可以用 `--watch` 模式实现类似面板的实时刷新
- 可以输出 JSON 供其他工具消费

**缺点**:
- 不是右侧面板（需要用户手动运行命令）

### 3.2 推荐组合策略

```
短期（立即实现）: xp-gate sprint-status CLI 命令
    ├── xp-gate sprint-status              → 渲染 sprint 进度表
    ├── xp-gate sprint-status --watch      → 实时刷新（fs.watch 优先，回退到 5s 轮询）
    └── xp-gate sprint-status --json       → JSON 输出（供其他工具消费）

中期（平台 API 就绪后）: 转为右侧面板
    └── 用 Panel/Webview API 注册 sprint-flow-panel
        数据源不变（.sprint-state/sprint-state.json）
```

## 3.3 数据源（与 canonical schema 对齐）

`xp-gate sprint-status` 读取 `.sprint-state/sprint-state.json`，数据格式**必须对齐 sprint-flow 的 canonical schema**（定义见 `skills/sprint-flow/SKILL.md` L893-942）。

### Canonical sprint-state.json 格式（不可修改）

```json
{
  "id": "sprint-2026-04-26-01",
  "task_description": "开发用户登录模块，支持 OAuth2",
  "phase": 2,
  "status": "running",
  "started_at": "2026-04-26T10:00:00Z",
  "isolation": {
    "worktree_path": ".worktrees/sprint/sprint-2026-04-26-01",
    "branch": "sprint/2026-04-26-01",
    "created_from": "main",
    "created_from_commit": "abc123def..."
  },
  "auto_estimate": {
    "change_type": "新增功能",
    "metrics": {
      "ref_count": 12,
      "cross_module_count": 3,
      "modules": ["auth", "user"],
      "circular_dep": false,
      "public_api_count": 5,
      "test_file_count": 4
    },
    "estimated_level": "标准",
    "recommended_flow": "标准流程 (Phase 0-4)",
    "risk_warnings": [],
    "user_decision": "accepted",
    "override_reason": null
  },
  "phase_history": [
    { "phase": -1, "phase_name": "ISOLATE", "status": "completed",
      "started_at": "2026-04-26T10:00:00Z", "completed_at": "2026-04-26T10:03:00Z", "duration_seconds": 180 },
    { "phase": -0.5, "phase_name": "AUTO-ESTIMATE", "status": "completed",
      "started_at": "2026-04-26T10:03:00Z", "completed_at": "2026-04-26T10:05:00Z", "duration_seconds": 120 },
    { "phase": 0, "phase_name": "THINK", "status": "completed",
      "started_at": "2026-04-26T10:05:00Z", "completed_at": "2026-04-26T10:15:00Z", "duration_seconds": 600 },
    { "phase": 1, "phase_name": "PLAN", "status": "completed",
      "started_at": "2026-04-26T10:15:00Z", "completed_at": "2026-04-26T10:25:00Z", "duration_seconds": 600 },
    { "phase": 2, "phase_name": "BUILD", "status": "in_progress",
      "started_at": "2026-04-26T10:25:00Z", "completed_at": null, "duration_seconds": null,
      "reqs": {
        "REQ-001": { "name": "用户注册", "status": "completed" },
        "REQ-002": { "name": "用户登录", "status": "in_progress" },
        "REQ-003": { "name": "OAuth2 集成", "status": "pending" }
      }
    }
  ],
  "outputs": {
    "pain_document": null,
    "specification": ".sprint-state/phase-outputs/specification.yaml",
    "mvp": null,
    "review_report": null
  },
  "metrics": {
    "tests_passed": 5,
    "tests_failed": 0,
    "coverage_pct": 85
  }
}
```

**关键对齐要求**:
- 使用 `phase_history` 数组（而非 `phases` 对象），每个元素包含 `phase`(number), `phase_name`, `status`, `started_at`, `completed_at`, `duration_seconds`
- 当前阶段号在顶层 `phase` 字段
- Sprint 标题在 `task_description`（而非 `goal`）
- 活跃/结束状态在顶层 `status` 字段（而非 `active`）
- `phase_history` 条目可以包含扩展字段（如 `reqs`）—— CLI 渲染时需要容错处理未知字段
- 字段缺失时默认为 "unknown" 不崩溃

### 3.4 sprint-status 命令设计

```
$ xp-gate sprint-status

╔═══════════════════════════════════════════════════════════════╗
║ Sprint: 开发用户登录模块，支持 OAuth2                          ║
║ ID: sprint-2026-04-26-01  |  Branch: sprint/2026-04-26-01   ║
╠═══════════════════════════════════════════════════════════════╣
║ Cumulative: 5 tests passed  |  Coverage: 85%                  ║
╠═══════════════════════════════════════════════════════════════╣
║ Phase -1   ISOLATE           ✅  3m  Completed               ║
║ Phase -0.5 AUTO-ESTIMATE     ✅  2m  Completed               ║
║ Phase 0    THINK             ✅  10m Completed               ║
║ Phase 1    PLAN              ✅  10m Completed               ║
║ Phase 2    BUILD             🔄  0m In Progress              ║
║   REQ-001  用户注册          ✅                               ║
║   REQ-002  用户登录          🔄                               ║
║   REQ-003  OAuth2 集成       ⏳                               ║
║ Phase 3    REVIEW            ⏳  Pending                      ║
║ Phase 4    USER ACCEPT       ⏳  Pending                      ║
║ Phase 5    FEEDBACK          ⏳  Pending                      ║
║ Phase 6    SHIP              ⏳  Pending                      ║
║ Phase 7    LAND              ⏳  Pending                      ║
║ Phase 8    CLEANUP           ⏳  Pending                      ║
╚═══════════════════════════════════════════════════════════════╝
```

Phase 按 phase_history 数组顺序渲染。phase_history 缺失的 phase 显示为 ⏳ Pending。
动态列宽：phase name 列宽 = max(phase_name.length) + 2。

### 3.5 实现

#### 3.5.1 实现文件

1. `src/npm-package/lib/sprint-status.js` — 新文件
   - `sprintStatus(args)` → 读取 `.sprint-state/sprint-state.json`
   - `readSprintState(dir)` → 读取并解析状态文件（try/catch + 默认值）
   - `formatSprintTable(state)` → 渲染表格（动态列宽）
   - `watchMode(statePath)` → `fs.watch()` 监听文件变更，回退到 `fs.watchFile()`
   - `jsonMode(state)` → 直接输出 JSON

2. `src/npm-package/bin/xp-gate.js` — 注册 `sprint-status` 子命令

3. 必须同步更新的文件（CLI 子命令注册 checklist）:
   - `src/npm-package/bin/xp-gate.js` — 注册 switch case
   - `src/npm-package/AGENTS.md` — CLI 表新增 `sprint-status` 行
   - `README.md` — CLI 命令速查表
   - `MANIFEST.md` — 组件清单

#### 3.5.2 自动发现逻辑

- 在当前目录查找 `.sprint-state/sprint-state.json`
- 如果不存在 → "No active sprint in this directory"
- 支持 `--dir <path>` 参数指定搜索目录（需要 `path.resolve()` 防 path traversal）
- `--dir` 参数限制：仅允许 `cwd` 的子目录

#### 3.5.3 原子读策略

由于 sprint-flow 可能正在写入 sprint-state.json：
- 使用 `JSON.parse()` + try/catch，解析失败时重试 1 次（100ms 延迟）
- 建议 sprint-flow writer 端使用原子写入：先写临时文件再 `fs.rename()`
- CLI 端对部分字段缺失做好默认值（"unknown", null, 0）

#### 3.5.4 过时检测

- 对比 `phase_history` 最新条目的 `completed_at` 或整个文件的 `mtime`
- 如果最后更新时间 > 1h → stderr 输出 `[Sprint] State may be stale (last updated >1h ago)`
- 不阻断输出，仅提示

#### 3.5.5 --watch 模式

- 优先使用 `fs.watch()`（事件驱动，低资源消耗）
    - 监听 `sprint-state.json` 文件变更
    - 不支持/失败回退到 `fs.watchFile()`（5s 轮询）
- SIGINT/SIGTERM 时清理 watcher
- `--watch` 模式下每 30s 无变更时输出一个 `.` 作为心跳

### 3.6 与右侧面板的关系

**右侧面板是本设计的长期目标**，但当前不可实现：
- 已向 OpenCode SDK 记录 feature request
- 一旦支持 Panel API，sprint-status CLI 的实现可以几乎直接迁移为 panel provider
- 数据源（`sprint-state.json`）、解析逻辑、渲染格式可复用
- 提交 feature request 时应引用本设计的 `formatSprintTable()` 函数作为 Panel 渲染参考

### 3.7 与 sprint-flow --status 的关系

sprint-flow SKILL.md 中定义的 `--status` 参数（"查看当前 Sprint 进度看板"）与本 CLI 命令功能重叠。
**CLI 命令 `xp-gate sprint-status` 是 `--status` 的规范实现**: sprint-flow 的 `--status` 应在底层调用 `xp-gate sprint-status`，而非自己实现渲染逻辑。这避免了数据读取逻辑的双重维护。

## 4. 验收标准

- [ ] `xp-gate sprint-status` 打印 Sprint 状态表（读取 phase_history 数组）
- [ ] 无活跃 Sprint 时输出 "No active sprint in this directory"
- [ ] phase_history 缺失的 phase 显示为 ⏳ Pending
- [ ] `--watch` 模式优先使用 `fs.watch()`，回退 `fs.watchFile()`
- [ ] `--json` 模式输出原始 sprint-state.json
- [ ] `--dir <path>` 支持指定搜索路径（限制在 cwd 子目录）
- [ ] 所有 11 个 phase（-1 到 8）按 phase_history 顺序渲染
- [ ] ✅/🔄/⏳ 三态图标正确对应
- [ ] REQ 级进度在 phase_history entry 的 `reqs` 字段中展示
- [ ] 字段缺失时默认值不崩溃
- [ ] 过时状态（>1h）输出 stale 警告
- [ ] SIGINT 时清理 watcher
- [ ] `src/npm-package/bin/xp-gate.js`、`AGENTS.md`、`README.md`、`MANIFEST.md` 同步更新

## 5. 风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| `.sprint-state.json` 格式变更 | 中 | 中 | 读取时用 try/catch + 字段存在性检查；如有 schema 版本字段（预留） |
| 并发读写导致 JSON 解析失败 | 低 | 低 | 重试 1 次（100ms）；writer 端宜用原子写入 |
| `fs.watch()` 跨平台不可靠（WSL/NFS） | 中 | 低 | 自动回退到 `fs.watchFile()` 5s 轮询 |
| `--watch` 模式下 watcher 泄漏 | 低 | 低 | SIGINT/SIGTERM 注册 cleanup handler |
| `--dir` path traversal | 低 | 低 | 限制在 `path.resolve(cwd)` 子树内 |
| sprint-state.json 不存在 | 低 | 低 | 优雅消息 "No active sprint" |
