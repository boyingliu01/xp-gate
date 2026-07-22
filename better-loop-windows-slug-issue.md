# Better Loop 会话证据源在 Windows 上无法发现 Qoder 会话

## 问题现象

Better Loop 的 `session-analysis facts --platform qoder` 在 Windows 上返回 `eligibleSessions: 0`，无法捕获任何 Task Episode，导致 `/better-loop` 分析无法读取会话证据。

## 根本原因

Better Loop 的 `workspaceToQoderSlug()` 函数（位于 `scripts/session-analysis/platforms/qoder.mjs`）使用正则 `replace(/[\\/]+/g, "-")` 生成 workspace slug，仅替换路径分隔符 `\` 和 `/`，**不处理 Windows 驱动器冒号 `:`**。

对于工作区 `e:\projects\xp-gate`，Better Loop 生成 slug 为 `e:-projects-xp-gate`，但 Qoder IDE 实际创建的目录使用的是两种不同的 slug 算法：

| 目录 | Qoder IDE 实际 slug | 算法 |
|------|---------------------|------|
| `~/.qoder/logs/sessions/` | `e--projects-xp-gate` | `:` → `-`，`\` → `-`（分别替换） |
| `~/.qoder/projects/` | `e-projects-xp-gate` | `:` 删除，`\` → `-` |

Better Loop 生成的 `e:-projects-xp-gate` 与两者均不匹配，导致所有工作区范围的源根被判定为不存在，会话发现返回空。

## 影响范围

- **平台**：仅 Windows（Linux/macOS 路径无冒号，不受影响）
- **版本**：`@ali/better-loop` 0.1.90
- **症状**：`session-analysis facts` / `facets` / `insights` 等命令均无法发现会话
- **下游影响**：`/better-loop` 技能无法获取会话证据，Task Episode 分析为空

## 建议修复

### 1. 修正 slug 生成函数

将 `:` 和路径分隔符分别替换（而非用单个正则 `+` 量词合并匹配）：

```javascript
// 修改前
export function workspaceToQoderSlug(workspace) {
  const normalized = normalizeWorkspace(workspace);
  return normalized.replace(/[\\/]+/g, "-");  // 不处理冒号
}

// 修改后
export function workspaceToQoderSlug(workspace) {
  const normalized = normalizeWorkspace(workspace);
  return normalized.replace(/:/g, "-").replace(/[\\/]+/g, "-");
}
```

### 2. 新增 slug 变体函数

兼容 Qoder IDE 不同版本创建的两种目录格式：

```javascript
export function workspaceToQoderSlugVariants(workspace) {
  const normalized = normalizeWorkspace(workspace);
  return [...new Set([
    normalized.replace(/:/g, "-").replace(/[\\/]+/g, "-"),   // 当前: e--projects-xp-gate
    normalized.replace(/:/g, "").replace(/[\\/]+/g, "-"),    // 遗留: e-projects-xp-gate
  ])];
}
```

### 3. 源根发现和会话扫描遍历所有变体路径

- `discoverSourceRoots`：对工作区范围根（`qoder-log-sessions`、`qoder-projects`）检查所有 slug 变体路径，使用第一个存在的变体
- `discoverLogSessions` 和 `discoverProjectSessions`：遍历所有变体路径扫描会话

## 验证结果

修复后在同一环境运行验证命令：

```bash
node <better-loop-cli> session-analysis facts --platform qoder --workspace <target> --limit 5 --format json
```

结果：

```
eligibleSessions: 13   (> 0 ✓)
candidates: [E1, E2, E3]   (非空 ✓)
```

## 补充说明

Qoder IDE 自身也存在一个一致性问题：`logs/sessions` 和 `projects` 两个路径使用了不同的 slug 算法（一个将冒号替换为连字符，一个删除冒号）。建议 Qoder IDE 侧也统一 slug 生成逻辑，避免未来再出现类似的不一致问题。
