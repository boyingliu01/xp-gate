# TUI Sidebar 不显示问题——诊断报告

## 问题描述

xp-gate 的 OpenCode TUI plugin 注册后，右侧 sidebar 面板只显示内置的 Context/MCP/LSP，不显示 Sprint Flow 进度内容。这个问题已持续两周、尝试十多次未解决。

## 当前配置状态

### tui.json（`~/.config/opencode/tui.json`）
```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "@boyingliu01/opencode-plugin/tui",
    "/home/boyingliu01/.config/opencode/plugins/test-tui.tsx"
  ]
}
```

### opencode.json（`~/.config/opencode/opencode.json`）
- `plugin` 数组包含 `@boyingliu01/opencode-plugin`（server plugin）
- `tui.plugin` 数组包含 `["@boyingliu01/opencode-plugin/tui"]`（但不确定 OpenCode 是否读取此字段）

### npm 包状态
- `@boyingliu01/opencode-plugin@0.10.13` 安装在 `~/.config/opencode/node_modules/`（项目依赖的是 0.10.17，但 config 级别是 0.10.13）
- `exports.tui` → `./tui-plugin.tsx`（指向 JSX 版本）
- 磁盘上有两个文件：`tui-plugin.ts`（旧 string 版本）和 `tui-plugin.tsx`（新 JSX 版本）
- `tui-plugin.tsx` 导出格式：`export { plugin as tui, readSprintState }` — `plugin` 是 `TuiPlugin` 类型的异步工厂函数

### 测试 plugin
- 位置：`~/.config/opencode/plugins/test-tui.tsx`
- 已通过日志文件确认：**模块代码确实被执行**（`test-tui.tsx loaded`, `imports ok`, `exporting tui`）
- 但 `tui()` 工厂函数从未被调用（`tui() called` 没有出现在日志中）
- 旧的 `test-tui.ts`（非 JSX 版本）曾经被成功调用过 `tui()` 工厂函数，但返回值是 `string`，`sidebar_content` 渲染函数从未被调用

## 实验证据

| 实验 | 模块加载 | 工厂函数调用 | sidebar_content 渲染 | 结论 |
|------|---------|-------------|---------------------|------|
| `test-tui.ts`（返回 string） | ✅ | ✅ | ❌ | 工厂函数被调用，但渲染未触发（string 被忽略） |
| `test-tui.tsx`（named export） | ✅ | ❌ | ❌ | 模块加载了，`tui` 导出没被识别 |
| `test-tui.tsx`（default export） | ✅ | ❌ | ❌ | 同上 |
| `@boyingliu01/opencode-plugin/tui` | ? | ? | ❌ | 无日志（正式 plugin 没有加日志） |

## 技术分析

### 1. OpenCode Plugin 架构（从类型定义推断）

OpenCode 1.17.11 区分两类 plugin：

**Server Plugin**（`opencode.json` → `plugin` 数组）：
```typescript
type PluginModule = { id?: string; server: Plugin; tui?: never };
```

**TUI Plugin**（`tui.json` → `plugin` 数组）：
```typescript
type TuiPluginModule = { id?: string; tui: TuiPlugin; server?: never };
```

两者互斥：一个模块要么是 server plugin，要么是 TUI plugin，不能同时导出 `server` 和 `tui`。

### 2. TUI Plugin 加载机制

- OpenCode 从 `~/.config/opencode/tui.json` 读取 plugin 列表
- `oh-my-opencode` 的 `detectTuiPluginRegistration()` 确认只读 `tui.json`
- `opencode.json` 的 `tui.plugin` 字段**可能不被 OpenCode 读取**（librarian 报告显示只读 `tui.json`）

### 3. 核心矛盾

**测试 plugin 的模块代码被执行**（日志显示 `test-tui.tsx loaded`），但 `tui` 工厂函数没有被调用。这表明 OpenCode 加载了模块文件，但在尝试从中提取 `tui` 导出时失败了。

可能的失败原因：
- **原因 A**：OpenCode 期望的导出格式与我们的不匹配。我们试过 `export { tui }` 和 `export default { tui }`，都不行。
- **原因 B**：JSX 编译问题。`@jsxImportSource @opentui/solid` 需要 `@opentui/solid` 包，但该包是 `@opencode-ai/plugin` 的 peerDependency，在 `~/.config/opencode/node_modules/` 下找不到。
- **原因 C**：OpenCode 1.17.11 的 TUI plugin 加载有 bug。旧版 `test-tui.ts`（无 JSX）的工厂函数被成功调用，新版 `.tsx`（含 JSX）的工厂函数不被调用。
- **原因 D**：OpenCode 版本问题。1.17.11 可能尚未完全支持外部 TUI plugins，或者需要特定配置。

### 4. 关键发现：`test-tui.ts` 工厂函数被调用过

旧的 `test-tui.ts`（普通 TypeScript，无 JSX）的 `tui()` 工厂函数**确实被 OpenCode 调用过**。日志显示：
```
tui factory function called
```

这说明 TUI plugin 加载框架本身是工作的。问题出在 `.tsx` + `@opentui/solid` 的组合上。

### 5. 根本原因假设

OpenCode 加载 TUI plugin 时，如果模块的依赖（`@opentui/solid`）无法解析，会**静默失败**：
- 模块代码可以执行（因为 `import type` 在运行时被擦除）
- 但当 OpenCode 尝试调用 `tui()` 工厂函数时，如果模块的返回值因为缺失依赖而无效，OpenCode 可能跳过它

`test-tui.ts`（无 JSX 依赖）工作，`test-tui.tsx`（有 JSX 依赖）不工作，强烈支持这个假设。

## 解决方案候选

### 方案 A：消除 JSX 依赖（推荐）
修改 `tui-plugin.tsx`，不使用 `@opentui/solid` JSX，而是使用 OpenCode TUI SDK 提供的 `Renderable` 类型。需要确认 `@opencode-ai/plugin/tui` 是否提供了 `createElement` 或 `h()` 函数来替代 JSX。

### 方案 B：安装 `@opentui/solid` 到 config 级别
在 `~/.config/opencode/` 安装 `@opentui/solid` 作为直接依赖，使 `.tsx` 文件能解析它。

### 方案 C：使用 OpenCode 内置的 Slot 组件
如果 `@opencode-ai/plugin/tui` 提供了 `api.ui.Slot` 或类似 API，可以用它替代 JSX。类型定义显示有 `api.ui.Slot`。

### 方案 D：放弃 TUI sidebar，改用 Server Plugin 输出
通过 server plugin 在 chat 消息中输出 sprint 状态信息（格式化的文本块），而不是在 sidebar 显示。这比 sidebar 更可靠，因为 server plugin 的加载已经在 opencode.json 中正常工作。

## 需要评审的关键问题

1. `@opentui/solid` 缺失是否是 root cause？
2. `opencode.json` 的 `tui.plugin` 字段是否被 OpenCode 读取？还是只有 `tui.json`？
3. 方案 A（消除 JSX 依赖）是否可行？`@opencode-ai/plugin/tui` 是否有无 JSX 的 API？
4. 方案 D（server plugin 输出代替 sidebar）是否可接受作为短期方案？
5. 是否需要升级 OpenCode 版本？
