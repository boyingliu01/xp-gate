# XP-Gate 自动更新机制设计方案

**日期**: 2026-06-15
**版本**: v0.8.13
**Sprint**: sprint/2026-06-15-01

## 概述

实现 xp-gate 全链路自动更新机制：服务端（CI 自动发版）+ 客户端（CLI 升级命令 + plugin 自动检查 + post-merge hook）。

## 涉及 Issue

| Issue | 标题 | 优先级 | 交付物 |
|-------|------|--------|--------|
| #207 | post-merge hook to auto-run sync-version.sh | p3-low | `githooks/post-merge` hook |
| #212 | opencode-plugin auto-update-checker | p2-nice-to-have | plugin 侧版本检查逻辑 |
| #215 | `xp-gate upgrade` CLI 命令 | p2-nice-to-have | 新 CLI 命令 + `check-version.js` |
| #216 | 版本滞后通知 | p3-low | doctor 集成 + plugin badge |
| #209 | plugin-CLI contract docs (已修复) | p3-low | 补充文档 |

## 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                      XP-Gate 自动更新架构                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  服务端（CI）                                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ VERSION 推送到 main → npm-publish CI → npm registry 更新    │   │
│  │ post-merge hook → auto-run sync-version.sh → 自动提交         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  客户端（检测 + 通知 + 升级）                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ CLI: xp-gate upgrade [--apply] [--preview]                   │   │
│  │       → check-version.js (npm registry 查询)                  │   │
│  │       → 比较本地 vs 远程版本                                   │   │
│  │       → 通知 / 自动升级                                        │   │
│  │                                                               │   │
│  │ doctor: xp-gate doctor --fix                                  │   │
│  │       → 末尾追加版本检查                                      │   │
│  │                                                               │   │
│  │ OpenCode Plugin: 首次工具调用时检查                              │   │
│  │       → execSync('xp-gate upgrade --preview')                 │   │
│  │       → 工具响应追加升级提醒                                    │   │
│  │                                                               │   │
│  │ Claude Code Plugin: PostToolUse hook                           │   │
│  │       → hook bash 脚本检查版本                                  │   │
│  │       → console.warn 输出通知                                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## 组件设计

### 1. 共享模块 `check-version.js`

**路径**: `src/npm-package/lib/check-version.js`
**依赖**: 零运行时依赖（Node built-in: `https` + `fs` + `path`）

**API**:

| 方法 | 输入 | 输出 | 说明 |
|------|------|------|------|
| `getLocalVersion()` | - | `"0.8.12"` \| `null` | 从 `package.json` 读取本地版本 |
| `getRemoteVersion(pkgName)` | `"@boyingliu01/xp-gate"` | `{ latest, publishedAt }` \| `null` | 查询 npm registry latest tag |
| `checkUpgrade(pkgName)` | `"@boyingliu01/xp-gate"` | `{ outdated, local, remote, lagDays }` | 组合比较，返回升级状态 |
| `formatUpgradeMsg(result, context)` | `{ result, 'cli'\|'doctor'\|'plugin' }` | string | 格式化升级消息 |

**关键行为**:
- `getRemoteVersion()`: `https.get` 请求 `https://registry.npmjs.org/-/package/@boyingliu01/xp-gate/dist-tags`
- 超时 5 秒，失败返回 `null`（不阻断主流程）
- 结果内存缓存 5 分钟
- `getRemoteVersion()` 增加 HTTP status code 和 `latest` key 存在性检查：非 200 或 `dist-tags` 无 `latest` key → 返回 `null`
- `--apply` 成功后清空缓存，确保下次检查拉取最新版本

### 2. CLI 命令 `xp-gate upgrade`

**路径**: `src/npm-package/lib/upgrade.js`
**注册**: `bin/xp-gate.js` COMMANDS map

**行为**:

| 命令 | 输出 |
|------|------|
| `xp-gate upgrade` | 检查 → 如果已最新: `✓ xp-gate v0.8.12 is up to date` |
| | 如果可升级: `A newer version v0.8.13 is available (https://github.com/boyingliu01/xp-gate/releases/tag/v0.8.13) — run: xp-gate upgrade --apply` |
| `xp-gate upgrade --preview` | 单行 JSON: `{"local":"0.8.12","remote":"0.8.13","outdated":true,"lagDays":3,"releaseUrl":"https://github.com/boyingliu01/xp-gate/releases/tag/v0.8.13","publishedAt":"2026-06-15T10:00:00.000Z"}` |
| `xp-gate upgrade --apply` | 检查 → 如果可升级 → 执行 `npm install -g @boyingliu01/xp-gate`。权限不足（EACCES）显示友好提示: `Permission denied. Try: sudo npm install -g @boyingliu01/xp-gate` |

**doctor 集成** (`doctor.js` 末尾追加版本检查步骤):
```
[Version Check]
  Local:  v0.8.12
  Remote: v0.8.13 ← NEW (see: https://github.com/boyingliu01/xp-gate/releases/tag/v0.8.13)
  Run: xp-gate upgrade --apply
```

**新用户检测**: 新用户首次运行 `doctor` 时自动检测本地版本是否有更新版本可用。
判断依据：`doctor` 运行后 `checkUpgrade()` 返回 `outdated=true` 即显示升级提示。

### 3. OpenCode Plugin auto-update-checker

**路径**: `plugins/opencode/index.ts`

**策略**: 延迟检查 — 首次工具调用时触发

```typescript
// 新增函数
async function checkVersion(): Promise<VersionInfo | null> {
  // 调用 xp-gate upgrade --preview
  // 解析 stdout JSON
  // 缓存结果 5 分钟
  // 失败 → 静默返回 null
}

// 每个 tool handler 入口装饰
async function withVersionCheck(fn: Function) {
  const info = await checkVersion();
  if (info?.outdated) {
    // lagDays: <1 → 静默; 1-7 → soft warning; >7 → strong warning
  }
  return fn();
}
```

**通知规则**:

| 滞后时间 | 行为 |
|----------|------|
| < 1 天 | 静默跳过 |
| 1-7 天 | 工具响应末尾追加: `Upgrade: v{remote} available — run: xp-gate upgrade --apply` |
| > 7 天 | 工具响应末尾追加: `New version v{remote} available (you have v{local}) — upgrade recommended — run: xp-gate upgrade --apply` |
| registry 不可达 | 静默降级 |

**execSync 错误处理**:
- CLI 未安装（`ENOENT`）→ 提示: `xp-gate CLI not found — install with: npm install -g @boyingliu01/xp-gate`
- 其他错误（network etc.）→ 静默降级（`return null`）

### 4. Claude Code Plugin auto-update-checker

**路径**: `plugins/claude-code/hooks/hooks.json` + 新增 `plugins/claude-code/bin/xp-gate-version-check.sh`

**方式**: PostToolUse hook，`matcher: ".*"`（每次工具调用后检查）

```json
{
  "PostToolUse": [
    {
      "matcher": ".*",
      "hooks": [
        {
          "type": "command",
          "command": "\"$CLAUDE_PLUGIN_ROOT\"/bin/xp-gate-version-check.sh"
        }
      ]
    }
  ]
}
```

**脚本 `xp-gate-version-check.sh`**: 调用 `xp-gate upgrade --preview`，如果过期则输出警告。
已检查过的版本同会话不重复提醒（写临时文件 `/tmp/.xp-gate-version-checked`）。

**缓存机制**: 临时文件 `/tmp/.xp-gate-version-checked` 有效期为 5 分钟（过期的缓存视为不存在）。
写入格式: `<remote_version>\n<timestamp_ms>`。读取时判断是否过期:

### 5. Post-merge hook

**路径**: `githooks/post-merge`
**安装**: `githooks/install.sh` 中 `HOOKS_LIST` 追加 `post-merge`

**行为**:
1. 检查是否是 xp-gate 项目（`scripts/sync-version.sh` 是否存在）
2. 使用 `ORIG_HEAD`（而非 `HEAD`）检测 `VERSION` 文件是否在 merge 中变更（`git diff-tree --name-only -r ORIG_HEAD HEAD | grep -q '^VERSION$'`）
3. 如果改变 → 执行 `scripts/sync-version.sh`
4. 输出提示，告知用户需要提交变更，列出具体被更新的文件路径

**性能**: 只走一次 `git diff-tree` + 一次条件性 `sh scripts/sync-version.sh`。VERSION 未变更时零网络开销。

**npm 包分发**: 复制到 `src/npm-package/hooks/post-merge`

### 6. CI 服务端

**当前状态**: `.github/workflows/npm-publish.yml` 已在 `VERSION` 推送到 main 时自动发布 npm

**变更**: 无。CI 已经满足服务端自动发布需求。

## 文件变更清单

| 文件 | 变更类型 | 涉及 Issue |
|------|---------|-----------|
| `src/npm-package/lib/check-version.js` | 新建 | #212, #215, #216 |
| `src/npm-package/lib/upgrade.js` | 新建 | #215 |
| `src/npm-package/bin/xp-gate.js` | 修改 — 注册 upgrade 命令 | #215 |
| `src/npm-package/lib/doctor.js` | 修改 — 追加版本检查 | #216 |
| `plugins/opencode/index.ts` | 修改 — 加入 auto-update-checker | #212 |
| `plugins/claude-code/hooks/hooks.json` | 修改 — 追加 PostToolUse hook | #212 |
| `plugins/claude-code/bin/xp-gate-version-check.sh` | 新建 | #212 |
| `githooks/post-merge` | 新建 | #207 |
| `githooks/install.sh` | 修改 — 加入 post-merge 安装 | #207 |
| `src/npm-package/hooks/post-merge` | 复制（从 githooks/） | #207 |

## 测试策略

| 组件 | 测试方式 |
|------|---------|
| `check-version.js` | 单元测试：mock https 请求，验证版本比较逻辑 |
| `upgrade.js` | CLI 集成测试：验证各模式输出格式 |
| doctor 集成 | 验证 doctor 输出包含版本检查行 |
| OpenCode plugin | 测试 execSync 调用 + 消息格式化 |
| Claude Code hook | 测试 bash 脚本在不同版本的输出 |
| post-merge hook | 测试 `git diff-tree` 检测逻辑 + sync-version 调用 |
| 安装流程 | 验证 install.sh 正确复制 post-merge |

## 故障模式（Fault Modes）

| # | 故障场景 | 触发条件 | 行为 | 防护 |
|---|---------|---------|------|------|
| F1 | 网络不可达 | `check-version.js` 查询 npm registry 超时/失败 | `getRemoteVersion()` 返回 `null`；CLI 显示 "Unable to check for updates"；doctor 和 plugin 静默 | 5s 超时 + 5 分钟缓存；失败后下次调用重新尝试 |
| F2 | npm registry 返回非 200 | npm registry 不可用或限制 | `getRemoteVersion()` 检查 statusCode，返回 `null` | 代码级 statusCode 检查 + null 返回 |
| F3 | 权限不足（EACCES） | `xp-gate upgrade --apply` 在非 sudo 环境 | 显示友好消息 "Permission denied. Try: sudo npm install -g @boyingliu01/xp-gate" | 特定错误码处理 + 可操作建议 |
| F4 | npm install 超时 | 网络慢导致 2 分钟内未完成 | 显示 "npm install timed out. Check your network and try again." | 2 分钟硬超时 + retry 指引 |
| F5 | 并发缓存写冲突 | 多个进程同时写 `version-cache.json` | 原子写入（先写 .tmp 再 rename，进程 pid 后缀） | 无锁的 atomic write 方案 |
| F6 | post-merge 循环 | sync-version.sh 自身的提交触发 post-merge | guard file (`.xp-gate/.version-synced`) 记录当前 HEAD hash，同 hash 跳过 | guard file 检查 |
| F7 | ORIG_HEAD 缺失 | shallow clone / 首次提交 | `git rev-parse ORIG_HEAD` 返回空 → 静默跳过 | 空值检查 |
| F8 | 多 Claude Code 会话并发版本检查 | 多个会话同时写 `/tmp/.xp-gate-version-checked` | flock 互斥锁；竞争方退出（不同会话共享 cache） | `flock -n` + 非阻塞退出 |
| F9 | 版本格式不匹配（空值返回） | `checkUpgrade()` 中 `local` 或 `remote` 为 null | 返回 `{ outdated: false, local, remote, lagDays: 0 }` | null guard；HTTP 200 检查 + latest key 存在性检查 |
| F10 | 通知层级边界模糊 | 新旧版本隔离 1 天内频繁触发通知 | CLI: 始终显示（人为执行）；doctor: 网络可达即可；plugin: lagDays < 1 天静默 | 三档通知规则（<1d silent / 1-7d soft / >7d strong） |

## 发布策略

- 所有变更在 `sprint/2026-06-15-01` 分支完成
- 一次 PR → 一次版本 bump → 一次 npm publish
- VERSION: `0.8.12.0` → `0.8.13.0`
