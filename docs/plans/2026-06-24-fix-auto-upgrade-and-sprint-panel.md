# 设计: 修复 OpenCode 插件自动升级 + Sprint Flow 右侧面板显示

**Status**: APPROVED (v3, Delphi Round 2 consensus 3/3, average confidence 8.7/10)
**Author**: Sisyphus
**Date**: 2026-06-24
**Delphi Round 1**: REQUEST_CHANGES (3/3 专家一致)
**Issues**: #212, #214, #216, #240 (已关闭但验收不完整), #239, #247 (open)

## Round 1 评审反馈摘要

3/3 专家 REQUEST_CHANGES。两大致命问题：

1. **SDK 不支持 `tool` + `slots` 在同一个 PluginModule 中共存。** `PluginModule { server }` 有 `tui?: never`，`TuiPluginModule { tui }` 有 `server?: never`。`Hooks` 接口（server() 返回值）无 `slots` 字段。合并方案在类型层面不可能实现。

2. **`shell.env` hook 不能注入聊天消息。** 它的签名是 `(input, output: { env: Record<string,string> }) => void`，作用是向 shell 进程注入环境变量，不是向用户展示通知。没有机制将 env var 转化为可见的聊天消息。

## 1. 问题（同 Round 1，不变）

| 声称已实现 | 实际表现 |
|-----------|---------|
| OpenCode 重启时自动检测和升级最新版本 | 用户看不到升级通知，也不知道升级是否发生 |
| OpenCode 右侧面板显示 Sprint Flow 迭代状态 | 面板始终空白，用户看不到任何 sprint 进度 |

## 2. 根因分析（同 Round 1，不变）

### 2.1 Bug 1: 自动升级"不生效"

1. `process.stderr.write()` 在 OpenCode 插件中对用户不可见
2. `chat.message` hook 只在用户第一次发文本消息时触发
3. 升级通知文件 `~/.xp-gate/upgrade-notice.json` 只有 TUI 插件加载时才读取显示
4. `runBackgroundUpdates()` 内部 await 等待 npm install 完成

### 2.2 Bug 2: Sprint Flow 右侧面板不显示

1. TUI 插件 (`./tui` export) 需要单独在 `tui.json` 注册，但文档未提及
2. `discoverActiveSprints()` 搜索 `.worktrees/sprint/`，Sprint Flow 早期阶段尚未创建
3. Fallback 逻辑缺陷：`sprint-state.json` 不存在时结果为空数组
4. 缓存 TTL 5 秒，在慢文件系统上可能闪烁

## 3. 修订方案（v2）

### 3.1 核心策略：保持两个插件分离，自动化 TUI 注册

**SDK 强制约束**：`PluginModule { server }` 和 `TuiPluginModule { tui }` 互斥，不可合并。

**新策略**：保持 `index.ts`（工具 + hooks）和 `tui-plugin.ts`（面板）分离，但让 TUI 注册**对用户透明**：

| 手段 | 触发时机 | 作用 |
|------|---------|------|
| `xp-gate init` 自检 | 项目初始化 | 自动创建/补全 `tui.json` 注册 |
| `xp-gate doctor --fix` 新增 Check 9 | 用户主动诊断 | 检测并自动修复 TUI 注册缺失 |
| TUI 面板顶部横幅 | 每次面板渲染 | 显示升级通知（`upgrade-notice.json`） |
| README 文档更新 | 文档层面 | 告知用户 TUI 注册的存在和原理 |

### 3.2 修复 1：升级通知用户可见化

**方案：TUI 面板顶部横幅（不在 chat.message 中改）**

当前 `tui-plugin.ts` 已有 `renderUpgradeNotice()` 函数（L364-369），读取 `~/.xp-gate/upgrade-notice.json`。只需要：
1. **确保 TUI 插件被注册** → 通过 3.1 的自动化注册解决
2. **在 `sidebar_content` 渲染时优先显示升级通知横幅**

升级流程不变：
```
chat.message hook 触发 (await runBackgroundUpdates)
  → checkXpGateUpdate() 比较版本 → spawn npm install -g
  → writeUpgradeNotice() 写入 upgrade-notice.json
  → TUI 面板下次刷新时（≤5s）读取并显示横幅
```

**不再尝试 `shell.env` hook**（SDK 不支持消息注入）。`chat.message` hook 中的 `process.stderr.write()` 也可以移除，因为通知已经完全交给 TUI 面板处理。

### 3.3 修复 2：自动化 TUI 注册

#### 3.3.1 `xp-gate init` 增强（加 TUI 注册自检）

在 `init.js` 的安装流程末尾，新增 `ensureTuiRegistration()`：

```
ensureTuiRegistration():
  1. 检查 ~/.config/opencode/tui.json 是否存在
  2. 如果不存在 → 创建，写入 { "plugin": ["@boyingliu01/opencode-plugin/tui"] }
  3. 如果存在但没有该条目 → 追加到 plugin 数组
  4. 如果已存在 → 跳过
```

#### 3.3.2 `xp-gate doctor` 新增 Check 9 + --fix 能力

在 `doctor.js` 中新增 `diagnoseTuiRegistration()`：

```
Check 9: OpenCode TUI 面板注册
  1. 读取 ~/.config/opencode/tui.json
  2. 检查 plugin 数组中是否包含 @boyingliu01/opencode-plugin/tui
  3. 缺失 → FAIL，建议运行 xp-gate doctor --fix
  4. --fix 模式 → 自动追加/创建 tui.json
```

参照已有的 Check 8（`diagnoseOpenCodePlugin`）实现模式。

#### 3.3.3 `tui-plugin.ts` 早期阶段显示增强

```typescript
function renderContent(sprints: DiscoveredSprint[], upgradeNotice: string | null, dir: string): string | null {
  const upgradeLine = upgradeNotice || null;
  const sprintContent = renderMultiSprintSidebar(sprints);

  // 场景 1: 有 sprint 数据 → 正常渲染
  // 场景 2: 无 sprint 但有 .sprint-state/ 目录 → 显示初始化状态
  // 场景 3: 连 .sprint-state/ 都没有 → 但如果 cwd 下有 .worktrees/ 目录 → 可能有 sprint 在准备
  
  if (sprintContent) {
    return [upgradeLine, sprintContent].filter(Boolean).join("\n---\n");
  }

  const hasStateDir = existsSync(join(dir, '.sprint-state'));
  const hasWorktreesRoot = existsSync(join(findGitRoot(dir) || dir, '.worktrees'));
  
  if (hasStateDir) {
    const placeholder = "SPRINT FLOW\n  → 初始化中...";
    return [upgradeLine, placeholder].filter(Boolean).join("\n---\n");
  }
  
  if (hasWorktreesRoot) {
    const placeholder = "SPRINT FLOW\n  · 准备中...";
    return [upgradeLine, placeholder].filter(Boolean).join("\n---\n");
  }

  // 无任何 sprint 相关痕迹 → 只显示升级通知（如果有的话）
  return upgradeLine || null;
}
```

#### 3.3.4 Git worktree list 回退发现（保持原设计）

`discoverActiveSprints()` 当前的逻辑：
1. 扫描 `.worktrees/sprint/` 目录下各子目录的 `sprint-state.json`
2. 回退到当前 cwd 的 `sprint-state.json`
3. 去重（以 `state.id` 为 key）

**不额外增加** `git worktree list` 解析。理由：
- 当前两步发现已覆盖主要场景
- `git worktree list` 解析需要额外的 `execSync` 调用，增加复杂度和性能开销
- 早期阶段的 "初始化中" 占位符已解决 #247 的核心痛点

### 3.4 不影响的部分（同 Round 1）

- **不修改 `runBackgroundUpdates()` 中的 `await`** — 保持等待 npm install 完成
- **不修改缓存逻辑** — 24h TTL for version check, 5s TTL for TUI panel
- **不修改 `src/npm-package/lib/sprint-status.js`** — 只改插件端
- **不修改 `tui-plugin.ts` 的纯函数逻辑** — `renderSprintSidebar` / `readSprintState` 不变
- **不修改 `package.json` 的 `./tui` export** — 保持向后兼容

## 4. 影响范围（v3 修订）

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `plugins/opencode/tui-plugin.ts` | **增强** | 新增早期阶段占位符渲染、升级通知横幅优先级提升 |
| `plugins/opencode/index.ts` | **注释** | `process.stderr.write()` 保留为 fallback，添加注释说明优先级 |
| `src/npm-package/lib/init.js` | **新增** | 添加 `ensureTuiRegistration()`（含 JSON 原子写入） |
| `src/npm-package/lib/doctor.js` | **新增** | 添加 Check 9 `diagnoseTuiRegistration()` + --fix 支持 + 损坏 JSON 备份逻辑 |
| `src/npm-package/lib/__tests__/doctor.test.js` | **新增** | Check 9 测试用例（含损坏 JSON、不存在目录等边界情况） |
| `plugins/opencode/__tests__/tui-plugin.test.ts` | **新增** | 早期阶段占位符渲染测试 |
| `README.md` | **更新** | CLI 命令表新增 TUI 注册说明 + 多 profile 注意事项 |
| `src/npm-package/AGENTS.md` | **更新** | CLI 表新增 doctor check 9 |

注：`src/npm-package/lib/uninstall.js` 不修改 — TUI 注册是全局资源，不随项目卸载而移除（MC-A1）。

## 5. 验收标准（v2 修订）

### Bug 1: 自动升级

- [ ] OpenCode 启动 → 用户发第一条消息 → 触发升级检查
- [ ] 有新版本时自动执行 `npm install -g @boyingliu01/xp-gate@latest`
- [ ] 升级结果在 TUI 右侧面板中作为横幅显示（`✓ Auto-upgraded from v0.10.12 to v0.10.13`）
- [ ] **无 TUI 环境时**（npm-only 安装），`process.stderr.write()` 作为 fallback 输出升级通知
- [ ] 已是最新版本时无任何提示（静默）
- [ ] 网络不可用时静默降级（不阻塞插件加载）
- [ ] 24h 缓存跨重启有效

### Bug 2: Sprint Flow 面板

- [ ] `xp-gate init` 执行后，`~/.config/opencode/tui.json` 自动包含 TUI 注册
- [ ] `xp-gate doctor` 能检测 TUI 注册缺失并报告
- [ ] `xp-gate doctor --fix` 能自动修复 TUI 注册缺失
- [ ] 注册后，OpenCode 右侧面板显示 Sprint 进度
- [ ] Sprint Flow Phase -1/0 早期阶段，面板显示 "SPRINT FLOW → 初始化中..." 而非空白
- [ ] Sprint Flow 无活跃时，面板不显示（静默）
- [ ] 多 Sprint 并存时正确显示（最多 3 个 + 省略提示）
- [ ] 面板每 5s 自动刷新（从 `sprint-state.json`）
- [ ] 升级通知在面板顶部作为横幅显示

## 6. 风险（v2 修订）

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 用户已有 tui.json，`init` 的追加逻辑出错 | 低 | 低 | 追加前先解析 JSON 并检查幂等性；只 append 不覆盖 |
| 用户未运行 `xp-gate init`（仅手动 install） | 中 | 中 | README 明确说明 `xp-gate doctor --fix` 可修复；npm postinstall 脚本可考虑触发 |
| TUI 面板的渲染结果超过 OpenCode sidebar 最大高度 | 低 | 低 | 当前渲染内容 ≤ 20 行（3 sprint × 各 5 行 + 横幅），远低于限制 |
| npm install -g 的 await 在 `chat.message` 中延迟消息处理 | 低 | 低 | OpenCode SDK 先返回消息再触发 hook；不影响用户体验 |
| `findGitRoot()` 在非 git 目录中返回 null 导致占位符不显示 | 低 | 低 | `findGitRoot` 已有 fallback 逻辑（检查根目录 `.git`） |

## 6.1 Delphi Round 2 Major Concern 处理

以下 4 个 MC 在 Delphi Round 2 中由专家提出，需在实现时一并处理：

| MC-ID | 来源 | 问题 | 处理方式 |
|-------|------|------|---------|
| MC-A1 | Expert A | 全局 tui.json 注册 — 多项目 uninstall 时不应移除共享的 TUI 注册 | `init` 只追加不覆盖；`uninstall` 跳过 tui.json 清理（保守策略，留到未来版本解决） |
| MC-B2 | Expert B | JSON 操作安全性 — tui.json 并发写、损坏 JSON | 读写均用 try-catch；写操作使用 tmp + renameSync 原子写入；损坏 JSON → 备份旧文件 + 重建 |
| MC-C1 | Expert C | npm-only 用户无 TUI — `process.stderr.write()` 移除后升级通知完全不可见 | **保留** `process.stderr.write()` 作为无 TUI 环境下的 fallback，同时在 index.ts 中用注释标注"优先 TUI 面板，stderr 仅为 fallback" |
| MC-C2 | Expert C | 多 profile OpenCode 环境 — doctor 未感知 profile 切换 | doctor Check 9 仅检测/修复默认路径 `~/.config/opencode/tui.json`；README 中注明多 profile 用户需手动注册其他 profile 的 tui.json |

## 7. 实现步骤（v3 修订）

### Step 1: 增强 tui-plugin.ts
- 修改 `renderContent()` 增加 `dir` 参数 + 早期阶段占位符
- 升级通知横幅始终优先渲染

### Step 2: 增强 init.js
- 新增 `ensureTuiRegistration()` 函数（JSON.parse/stringify + 原子写入，处理 MC-B2）
- 在 `xp-gate init` 流程末尾调用
- uninstall 中跳过 tui.json 清理（处理 MC-A1）

### Step 3: 增强 doctor.js
- 新增 `diagnoseTuiRegistration()` (Check 9)
- 新增 `fixTuiRegistration()` (--fix handler)
- 仅检测默认路径 `~/.config/opencode/tui.json`（处理 MC-C2）
- 损坏 JSON → 备份 + 重建（处理 MC-B2）
- 在 `doctor()` 中集成

### Step 4: 更新测试
- `tui-plugin.test.ts` 新增早期阶段占位符测试
- `doctor.test.js` 新增 Check 9 测试用例（含损坏 JSON、不存在目录等边界情况）

### Step 5: 更新文档
- `README.md` CLI 命令表 + 安装指南 + TUI 注册说明（多 profile 用户需手动注册）
- `src/npm-package/AGENTS.md` CLI 表
- 插件 README 增加 TUI 注册说明

### Step 6: index.ts fallback 保留
- `process.stderr.write()` **保留**作为无 TUI 环境下的 fallback（处理 MC-C1）
- 添加注释说明优先级：TUI 面板横幅 > stderr

### Step 7: bump version + sync

### Step 1: 增强 tui-plugin.ts
- 修改 `renderContent()` 增加 `dir` 参数 + 早期阶段占位符
- 升级通知横幅始终优先渲染

### Step 2: 增强 init.js
- 新增 `ensureTuiRegistration()` 函数
- 在 `xp-gate init` 流程末尾调用

### Step 3: 增强 doctor.js
- 新增 `diagnoseTuiRegistration()` (Check 9)
- 新增 `fixTuiRegistration()` (--fix handler)
- 在 `doctor()` 中集成

### Step 4: 更新测试
- `tui-plugin.test.ts` 新增早期阶段占位符测试
- `doctor.test.js` 新增 Check 9 测试用例

### Step 5: 更新文档
- `README.md` CLI 命令表 + 安装指南
- `src/npm-package/AGENTS.md` CLI 表
- 插件 README 增加 TUI 注册说明

### Step 6: 清理（可选）
- `index.ts` 中移除或注释 `process.stderr.write()`，加上注释说明通知由 TUI 面板负责

### Step 7: bump version + sync
