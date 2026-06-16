# 设计: @boyingliu01/opencode-plugin 自动更新检查

**Status**: REVISED (v2, after Delphi Round 1-3)
**Author**: Sisyphus
**Date**: 2026-06-16
**Issue**: #212

## 1. 问题

`@boyingliu01/opencode-plugin` 发布到 npm 后，本地 OpenCode 环境中的插件版本不会自动更新。用户无法感知新版本存在。导致 AI 工具和 skills 可能使用过时版本运行。

## 2. 约束

- OpenCode Plugin SDK (`@opencode-ai/plugin@^1.15.0`) **不支持**:
  - Panel/Webview 组件
  - 独立的后台线程或定时器
  - 启动时 lifecycle hook（没有 `onActivate` 钩子）
- 支持的 hooks 中与"启动时检查"相关的:
  - `dispose` — 插件加载/卸载时调用
  - `event` — 各种生命周期事件触发
  - `chat.message` — 收到用户消息时触发（可用于"延迟检查"）
  - `chat.params` — 用户消息参数变更时触发
- 插件入口 `index.ts` 是一个导出 `pluginModule` 的纯函数，在 OpenCode 启动时被调用
- 零 runtime 依赖约束（npm-package）**不适用于 opencode-plugin** — 它已经有 `@opencode-ai/plugin` 作为依赖

## 3. 设计

### 3.1 核心策略：首次消息延迟检查

利用 `chat.message` hook：当用户发送第一条消息时，**非阻塞**触发版本检查（fire-and-forget）。

```
OpenCode 启动
    │
    ├── index.ts 注册 pluginModule
    │       │
    │       ├── tool: gate-check
    │       ├── tool: gate-principles
    │       ├── tool: gate-arch
    │       └── hook: chat.message → 版本检查（仅执行一次）
    │
    └── 用户发送第一条消息
            │
            └── chat.message hook 触发（非阻塞，不延迟消息处理）
                    │
                    ├── 检查 module-level in-flight guard（防并发）
                    ├── 读取 ~/.xp-gate/opencode-plugin-version-check.json（24h TTL）
                    ├── 如果缓存有效 → 跳过
                    ├── 如果缓存过期或不存在：
                    │   ├── fetch npm registry（带 5s AbortSignal.timeout）
                    │   ├── 用 semver.lt() 比对版本
                    │   ├── 如果过时 → 写入缓存 → stderr 通知用户
                    │   └── 如果失败（网络/超时/解析）→ 静默忽略
                    └── 标记 in-flight guard released
```

### 3.2 检查逻辑

1. **In-flight guard**: module-level `checkPromise` 变量（`Promise<void> | null`），防止并发重复请求
2. **检查 24h 缓存**: 先读 `~/.xp-gate/opencode-plugin-version-check.json`
   - 缓存包含 `{ ts, localVersion, remoteVersion }`
   - `Date.now() - ts < 86400000` → 跳过
3. **获取本地版本**: 从 `pluginDir/package.json` 读 `version` 字段
4. **获取远程版本**: 用 `fetch()` + `AbortSignal.timeout(5000)` 访问 `https://registry.npmjs.org/-/package/@boyingliu01%2Fopencode-plugin/dist-tags`
5. **版本比对**: 使用 `semver.lt(localVersion, remoteVersion)`（引入 `semver` 包）
6. **通知**: 通过 `process.stderr.write()` 输出通知（避免 LLM context 污染）
7. **In-flight guard release**: 无论成功失败，标记检查完成

### 3.3 实现位置

- 文件: `plugins/opencode/index.ts`
- 新增函数: `checkPluginUpdate()` — 内部函数（不导出）
- 注册到 `chat.message` hook

#### chat.message hook 注册方式

基于 SDK 类型 `"chat.message"?: (input: {...}) => Promise<any>`，注册在 pluginModule 的 `chat.message` 字段：

```typescript
export const XpGatePlugin = async (input: OpenCodePluginInput) => {
  return {
    tool: {
      "gate-check": { ... },
      "gate-principles": { ... },
      "gate-arch": { ... }
    },
    "chat.message": async (_input: { message: string }) => {
      if (!checked) {
        checked = true;
        // 非阻塞 — 不 await
        checkPluginUpdate(input.directory).catch(() => {});
      }
      return { action: "continue" };
    }
  };
};
```

### 3.4 版本比对策略

引入 `semver` 作为新依赖（添加到 `plugins/opencode/package.json`）：

```typescript
import { lt as semverLt } from "semver";

// 类型: (a: string, b: string) => boolean
// 支持 semver 标准版本号（1.0.0, 1.0.0-alpha, 1.0.0+build）
// pre-release 按 semver 规范处理（1.0.0-alpha < 1.0.0）
export function isNewer(remote: string, local: string): boolean {
  return semverLt(local, remote);
}
```

### 3.5 通知格式

使用 `process.stderr.write()` 以避免污染 LLM 的 stdout context：

```
[XP-Gate] New opencode-plugin version v{remote} available (you have v{local})
[XP-Gate] Update with: cd ~/.config/opencode && npm update @boyingliu01/opencode-plugin
```

### 3.6 错误处理

- 所有网络/解析/文件 I/O 异常 → catch 后 `process.stderr.write` 以 `[XP-Gate] Update check failed (network error)` 输出（用户可见但不会崩溃）
- npm registry 返回非 200 → 静默忽略
- `cachePath` 目录不存在 → 自动 `fs.mkdirSync(cachePath, { recursive: true })`
- Offline/proxy 环境 → `fetch` 在 5s 超时自然地静默失败

### 3.7 与 xp-gate CLI 的关系

`xp-gate doctor` 中已有 Check 8 检查 opencode-plugin 版本（在 v0.8.16 中新增）。插件端主动检查是互补的：

| 路径 | 触发方式 | 用途 |
|------|---------|------|
| `xp-gate doctor` Check 8 | 用户主动运行诊断 | 详细版本状态 |
| `xp-gate upgrade --preview` | 每个 tool handler 执行后（非阻塞） | 检查 xp-gate CLI 自身 |
| Plugin `chat.message` hook | 首次用户消息（非阻塞） | 检查 opencode-plugin 自身 |

缓存 key 统一：所有检查写入同一个 `~/.xp-gate/opencode-plugin-version-check.json` 文件，共享 24h TTL。

### 3.8 备选方案（不采用）

| 方案 | 不采用原因 |
|------|-----------|
| 使用 `event` hook | `event` 事件类型未明确定义，可能不覆盖启动事件 |
| 使用 `dispose` hook | 卸载时检查无意义 |
| 使用 `config` hook | 用户不一定变更配置 |
| 启动时直接检查（在 index.ts 顶层） | 会阻塞插件加载 |
| 定时轮询 | SDK 不支持独立定时器 |

### 3.9 Hook 注册结构（基于 SDK 类型）

```typescript
// pluginModule 的 hook 注册位置
// SDK 类型定义: "chat.message"?(input: {message: string}): Promise<{action: "continue" | ...}>
{
  tool: { ... },
  "chat.message": async ({ message }) => {
    // 如果用户消息明确请求忽略升级通知
    if (message.includes("--no-upgrade-check")) return { action: "continue" };
    
    // 非阻塞触发版本检查
    maybeCheckForUpdate(directory);
    
    return { action: "continue" };
  }
}
```

### 3.10 完整代码结构

```typescript
// plugins/opencode/index.ts — 新增部分

import { lt as semverLt } from "semver";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// 常量
const CACHE_TTL_MS = 86_400_000; // 24 小时
const NPM_REGISTRY_URL = "https://registry.npmjs.org/-/package/@boyingliu01%2Fopencode-plugin/dist-tags";
const CACHE_FILE = join(homedir(), ".xp-gate", "opencode-plugin-version-check.json");
const FETCH_TIMEOUT_MS = 5_000;

// In-flight guard（防止 chat.message hook 高频触发）
let checkInFlight: Promise<void> | null = null;

async function checkPluginUpdate(pluginDir: string): Promise<void> {
  // 1. 检查 in-flight guard（防止并发请求）
  if (checkInFlight) return;
  
  checkInFlight = (async () => {
    try {
      // 2. 确保缓存目录存在
      mkdirSync(join(homedir(), ".xp-gate"), { recursive: true });
      
      // 3. 检查 24h 缓存
      if (existsSync(CACHE_FILE)) {
        const cached = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
        if (Date.now() - cached.ts < CACHE_TTL_MS) return;
      }
      
      // 4. 获取本地版本
      const pkg = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8"));
      const localVersion: string = pkg.version;
      
      // 5. 获取远程版本（5s 超时）
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(NPM_REGISTRY_URL, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        const remoteVersion: string = data.latest;
        
        // 6. 使用 semver 比对
        if (remoteVersion && localVersion && semverLt(localVersion, remoteVersion)) {
          writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), localVersion, remoteVersion }));
          process.stderr.write(
            `[XP-Gate] New opencode-plugin version v${remoteVersion} available (you have v${localVersion})\n` +
            `[XP-Gate] Update with: cd ~/.config/opencode && npm update @boyingliu01/opencode-plugin\n`
          );
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // 所有异常静默忽略
    }
  })();
  
  await checkInFlight;
}

// In-flight guard release after completion
checkPluginUpdate("").finally(() => { checkInFlight = null; });
```

## 4. 测试策略

### 4.1 单元测试

| 场景 | 预期 |
|------|------|
| 网络不可用 | 静默忽略，不阻塞用户消息 |
| npm registry 返回 404 | 静默忽略 |
| 本地 package.json 损坏 | catch 后忽略 |
| 缓存目录不存在 | 自动创建 `~/.xp-gate/` |
| 缓存未过期 (<24h) | 跳过网络请求 |
| 缓存已过期 (>24h) | 发出网络请求 |
| 本地版本 == 远程版本 | 不输出通知 |
| 本地版本 < 远程版本 | 输出版本通知 |
| 两次快速消息触发 | 第二次被 in-flight guard 阻断 |

### 4.2 Mock 策略

- `fetch()` → 用 `vi.fn()` 模拟返回不同版本号
- `readFileSync` → 模拟不同本地版本
- `Date.now()` → 控制缓存 TTL

## 5. 验收标准

- [ ] 首次发送消息后 **非阻塞** 触发版本检查（不延迟消息处理）
- [ ] 最新版本时完全不输出任何信息
- [ ] 有过时版本时输出一行通知到 stderr
- [ ] 两次快速消息只触发一次网络请求
- [ ] 网络不可用时 5s 内静默忽略
- [ ] 24 小时缓存跨 OpenCode 重启有效（写入磁盘）
- [ ] 不影响插件工具的正常使用
- [ ] 不影响插件加载速度
- [ ] cache 目录自动创建

## 6. 风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| `chat.message` hook 多次触发 | 低 | 低 | In-flight guard + 缓存双重保障 |
| npm registry 超时 | 中 | 低 | 5s timeout，静默失败 |
| 缓存目录写入失败 | 低 | 低 | catch 后忽略，下次再试 |
| `semver` 依赖增加包大小 | 中 | 低 | `semver` 是轻量包 (~7KB gzip) |
| 通知进入 LLM context | 中 | 中 | 使用 `process.stderr` 而非 `stdout` |
| OpenCode 重启后 cache 状态重置 | 中 | 低 | 磁盘缓存跨重启有效 |
