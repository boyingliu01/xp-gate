# xp-gate Uninstall 体验优化 — 设计文档

**Sprint**: sprint-2026-05-30-02 (Sprint 2)
**父 Sprint**: sprint-2026-05-30-01 (v0.5.0 安装修复)
**状态**: Phase 0 APPROVED → 进入 Phase 1
**日期**: 2026-05-30

---

## 1. 背景

Sprint-1 (v0.5.0) 完成了安装体验的核心修复：公共 npm registry、包自包含、lifecycle scripts 修复、Windows CI。但以下项被明确 defer 到 Sprint-2：

1. `xp-gate uninstall` CLI 命令 — 完整反向操作 `xp-gate init`
2. `xp-gate doctor` — 诊断命令
3. 迁移自动化 — 辅助 v0.4.x 用户搬到 v0.5.x
4. download-skill 多源降级（离线 → 镜像 → npm → GitHub）

本设计文档聚焦 Sprint-2 的完整范围。

---

## 2. 用户澄清结果

| 问题 | 决策 |
|------|------|
| Uninstall 场景优先级 | **完整卸载**：自动检测 init 模式，反向清理所有痕迹 |
| Global vs Local 检测 | **智能检测**：读取 xp-gate.json 的 mode，自动决定清理策略 |
| AGENTS.md 清理 | **不清理**：Karpathy Principles 是通用 AI 编码纪律，即使卸载也保留 |

---

## 3. CLI 接口设计

```
xp-gate uninstall               # 自动检测模式，完整卸载
xp-gate uninstall --dry-run     # 预览模式：列出将删除/修改的内容，不实际执行
xp-gate uninstall --force       # 跳过确认提示，直接执行
xp-gate uninstall --local       # 强制 local 模式（覆盖自动检测）
xp-gate uninstall --global      # 强制 global 模式（覆盖自动检测）

xp-gate doctor                  # 诊断命令：检查安装状态
xp-gate doctor --fix            # 自动修复已知问题

xp-gate migrate                 # 迁移助手：检测并清理 GitHub Packages 残留
xp-gate migrate --dry-run       # 预览迁移操作
```

**CLI 入口修改**（`src/npm-package/bin/xp-gate.js`）：

新增 3 个命令注册：
```javascript
'uninstall': {
  description: 'Uninstall xp-gate (reverse of init)',
  fn: uninstall,
  usage: 'xp-gate uninstall [--dry-run] [--force] [--local|--global]'
},
'doctor': {
  description: 'Diagnose xp-gate installation health',
  fn: doctor,
  usage: 'xp-gate doctor [--fix]'
},
'migrate': {
  description: 'Migrate from v0.4.x (GitHub Packages) to v0.5.x',
  fn: migrate,
  usage: 'xp-gate migrate [--dry-run]'
}
```

---

## 4. REQ-1: uninstall 命令（核心）

### 4.1 设计策略：镜像反转 init

`xp-gate uninstall` 读取 `~/.config/xp-gate/xp-gate.json` 的 `mode` 字段，精确反向执行 `init` 的每一步。每步验证文件归属（特征字符串），避免误删用户自定义文件。

### 4.2 新文件

`src/npm-package/lib/uninstall.js` — 主卸载逻辑（新建，区别于现有的 `uninstall-skill.js`）

### 4.3 执行流程

```
xp-gate uninstall
  → 1. 读取 ~/.config/xp-gate/xp-gate.json → 获取 mode
  →     config 不存在 → "No xp-gate installation found" → exit 0
  → 2. 确定卸载模式（--local/--global 覆盖自动检测）
  → 3. 构建 Uninstall Plan（操作清单）
  → 4. 打印清单 → --dry-run 则 exit 0
  → 5. 确认（y/N），--force 跳过
  → 6. 按顺序执行清理（先外后内）
  → 7. 更新 xp-gate.json（记录 uninstalled 时间戳）
  → 8. 打印卸载摘要
```

### 4.4 Uninstall Plan 详细映射

| 操作 | local | global | 验证方式 | 失败策略 |
|------|-------|--------|---------|---------|
| 删除 `.git/hooks/pre-commit` | ✅ | ❌ | 内容含 `OpenCode Quality Gates` | 不匹配→skip+warn |
| 删除 `.git/hooks/pre-push` | ✅ | ❌ | 内容含 `Pre-push Hook` | 不匹配→skip+warn |
| 删除 `githooks/adapter-common.sh` | ✅ | ❌ | 内容含 `detect_project_lang()` | 不匹配→skip+warn |
| 删除 `githooks/adapters/*.sh` | ✅ | ❌ | shebang `#!/usr/bin/env bash` + xp-gate originated | 逐个检查 |
| 删除 `~/.config/opencode/git-hooks-template/` | ✅ | ✅ | 目录存在即删 | missing→skip |
| unset `git config --global core.hooksPath` | ❌ | ✅ | 值匹配 `~/.config/xp-gate/hooks/` | 不匹配→skip+warn |
| 删除 `~/.config/xp-gate/hooks/` | ❌ | ✅ | 目录存在即删 | missing→skip |
| 删除 `~/.config/xp-gate/adapters/` | ❌ | ✅ | 目录存在即删 | missing→skip |
| 更新 `~/.config/xp-gate/xp-gate.json` | ✅ | ✅ | JSON parseable | 从不失败 |

### 4.5 文件归属验证

```javascript
const SIGNATURES = {
  'pre-commit': 'OpenCode Quality Gates - Pre-Commit Hook',
  'pre-push': 'Pre-push Hook - Code Walkthrough Result Validator',
  'adapter-common.sh': 'detect_project_lang()',
};

function isXpGateFile(filePath, signature) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf8');
  return content.includes(signature);
}
```

### 4.6 安全防护

- 每个删除操作前验证文件归属
- 特征不匹配 → 跳过 + warning（不阻断其他清理）
- 不存在的文件/目录 → skip + info message

### 4.7 文件清理策略（三分类）

| 类别 | 策略 | 文件列表 |
|------|------|---------|
| **必须清理** | 由 xp-gate init 独占创建，直接删除 | hooks (pre-commit/pre-push), adapters, git-hooks-template/, ~/.config/xp-gate/hooks/, ~/.config/xp-gate/adapters/ |
| **询问清理** | 可能与用户数据混合，提示后由用户决定 | AGENTS.md (注入的 Karpathy Principles section), .principlesrc, architecture.yaml, specification.yaml, .warnings-baseline.json |
| **保留不动** | 用户数据 | ~/.config/opencode/skills/, ~/.config/xp-gate/cache/ |

**默认行为**: uninstall 只执行"必须清理"类别。"询问清理"类别在卸载摘要中列出，提示用户手动处理。

### 4.8 xp-gate.json 状态机

```
active → uninstalling → uninstalled
  │            │
  │            └── 卸载失败 → active（可重试，doctor 可诊断）
  │
  └── 完整卸载 → mode: "uninstalled", uninstalled: "ISO8601"
```

- `doctor` 只在 `mode === "active"` 时执行诊断/修复
- `mode === "uninstalled"` 时 doctor 输出 "xp-gate is not installed"
- uninstall 设置 `mode` 为 `"uninstalling"` 开始，成功时转为 `"uninstalled"`
- 中途失败保持 `"uninstalling"` → 下次 uninstall 可恢复（幂等）

### 4.9 init.js 架构审计

**审计结论**: `init.js` (235 lines) 不生成 manifest 文件，不记录安装的文件列表或校验和。uninstall 必须依赖"特征字符串检测"作为文件归属判定的**唯一方式**。

| init.js 副作用 | uninstall 反向操作 |
|---|---|
| `copyHooks()` → .git/hooks/ (local) | 签名验证后删除 |
| `copyAdapters()` → githooks/ + TEMPLATE_DIR | 签名验证后删除 |
| `updateConfig({mode, lastInit})` | updateConfig({mode:"uninstalled", uninstalled}) |
| `injectKarpathyPrinciples()` → AGENTS.md | 保留(询问清理) |
| `git config --global core.hooksPath` (global) | unset (值匹配时) |

**已知局限**: 由于无 manifest，uninstall 是"尽最大努力"策略 — 通过特征字符串检测来判定文件归属。如果用户手动修改了 hook 文件但保留了特征字符串，仍会被识别为 xp-gate 文件。如文件特征字符串不匹配，跳过并输出 warning。

### 4.10 global 模式 core.hooksPath 恢复

`init.js` global 模式直接覆写 `core.hooksPath`，不保存旧值。修复策略：
- **uninstall.js 实现时**: 在 uninstall 执行前读取当前 `core.hooksPath` 值
- 如果值匹配 `~/.config/xp-gate/hooks/` → unset
- 如果值不匹配 → skip + warn（用户可能手动改过）
- 如果 init 时旧值非空(future enhancement): 在 `xp-gate.json` 中增加 `previousHooksPath` 字段

**Sprint-2 范围**: 暂不修改 init.js（Karpathy 原则 3: Surgical Changes）。uninstall 仅做 unset，不尝试恢复旧值。恢复旧值的需求记录为 future enhancement。

---

## 5. REQ-2: doctor 命令

### 5.1 功能

诊断当前 xp-gate 安装状态，检查：
- config 文件是否存在且有效
- hooks 文件是否存在 + 是否是 xp-gate 版本
- adapters 目录是否完整
- git core.hooksPath 是否正确（global 模式）
- 环境依赖（Node.js、Git、Bash）

### 5.2 接口

```bash
xp-gate doctor          # 诊断报告
xp-gate doctor --fix    # 自动修复（如重新安装 hooks）
```

### 5.3 新文件

`src/npm-package/lib/doctor.js`

---

## 6. REQ-3: migrate 命令

### 6.1 功能

辅助 v0.4.x 用户清理 GitHub Packages 安装残留：
- 检测 `~/.npmrc` 中的 `npm.pkg.github.com` 配置
- 提示并清理 PAT token 行
- 检测旧版缓存 `~/.config/xp-gate/cache/`

### 6.2 接口

```bash
xp-gate migrate          # 交互式迁移
xp-gate migrate --dry-run # 预览
```

### 6.3 新文件

`src/npm-package/lib/migrate.js`

---

## 7. REQ-4: 文档更新

### 7.1 更新文件

| 文件 | 变更 |
|------|------|
| `README.md` | 新增 `xp-gate uninstall` / `doctor` / `migrate` 命令说明 |
| `CHANGELOG.md` | Unreleased section 记录 REQ-1~4 |
| `MANIFEST.md` | 添加新 CLI 命令入口 |

---

## 8. 依赖关系

```
REQ-1 (uninstall)  ← 无依赖，可最先开始
REQ-2 (doctor)     ← 依赖 REQ-1（复用 isXpGateFile 等检测逻辑）
REQ-3 (migrate)    ← 独立
REQ-4 (docs)       ← 依赖 REQ-1,2,3 全部完成
```

**建议 Build 顺序**: REQ-1 → REQ-2 / REQ-3（可并行）→ REQ-4

---

## 9. 验收标准

| ID | 验收条目 | 验证方式 |
|----|---------|---------|
| AC-01 | `xp-gate uninstall` 在 local 模式下完整清理 hooks + adapters | 测试：init → uninstall → 验证文件不存在 |
| AC-02 | `xp-gate uninstall` 在 global 模式下 unset core.hooksPath | 测试：init --global → uninstall → 验证 config 已还原 |
| AC-03 | `xp-gate uninstall --dry-run` 不修改任何文件 | 测试：dry-run → 验证所有文件仍在 |
| AC-04 | 非 xp-gate 的 hooks 文件不被误删 | 测试：创建自定义 pre-commit → uninstall → 验证仍在 |
| AC-05 | `xp-gate doctor` 正确诊断健康/损坏状态 | 测试：完整安装 → doctor → 输出包含所有 checks ✅ |
| AC-06 | `xp-gate migrate` 清理 ~/.npmrc 中的 PAT 行 | 测试：mock ~/.npmrc → migrate --dry-run → 验证 |
| AC-07 | 文档与实现一致 | 手动验证 README/CHANGELOG |
| AC-08 | 卸载中途失败后 `xp-gate doctor` 可检测不完整状态 | mock 权限错误 → uninstall → doctor 输出包含 partial uninstall 信息 |
| AC-09 | 已卸载状态下再次 `uninstall` 输出干净信息（幂等） | uninstall 两次 → 第二次输出 "No xp-gate installation found" |
| AC-10 | `doctor --fix` 仅在 mode === "active" 时执行修复 | 设置 mode=uninstalled → doctor --fix → 不执行修复操作 |
| AC-11 | Manifest 存在时 uninstall 使用 sha256 而非仅特征字符串 | init → 修改 manifest sha256 → uninstall --dry-run → 显示 fallback 到 signature 检测 |

---

## 10. 风险

| 风险 | 缓解 |
|------|------|
| uninstall 误删用户自定义 hooks | 特征字符串验证 + dry-run 预览 |
| global uninstall 影响其他项目 | 明确提示 + 确认步骤 |
| migrate 清理 PAT 影响其他 registry | 仅匹配 `npm.pkg.github.com` 行 |

---

### 4.11 Manifest 文件机制

**问题**: Delphi Round 1 两位专家（Architecture + Implementation）独立指出：`init.js` 不生成文件清单，导致 `uninstall` 和 `doctor` 都只能"猜测"哪些文件属于 xp-gate。特征字符串检测虽好，但不完整。

**解决方案**: 在 `init.js` 中新增 manifest 生成，在 `uninstall.js`/`doctor.js` 中优先使用 manifest。

**manifest 格式** (`~/.config/xp-gate/xp-gate.json` 中新增 `manifest` 字段):
```json
{
  "manifest": {
    "version": 1,
    "files": {
      ".git/hooks/pre-commit": {"sha256": "abc123...", "size": 1781},
      ".git/hooks/pre-push": {"sha256": "def456...", "size": 395},
      "githooks/adapter-common.sh": {"sha256": "...", "size": 192},
      "githooks/adapters/adapter-typescript.sh": {"sha256": "...", "size": 456}
    },
    "gitConfig": {
      "core.hooksPath": "~/.config/xp-gate/hooks/"
    },
    "templateDir": "~/.config/opencode/git-hooks-template/",
    "injectedSections": {
      "AGENTS.md": "## AI CODING DISCIPLINE (Karpathy Principles)"
    }
  }
}
```

**验证策略（两级 fallback）**:
1. **优先**: 读取 manifest → 校验 sha256 → 匹配则确认归属
2. **Fallback**: manifest 不存在或 sha256 不匹配时 → 使用特征字符串检测（§4.5）
3. **未知文件**: 两种验证都失败 → skip + warn

**init.js 修改范围**（最小化）:
- `installLocal()` 和 `setupGlobal()` 在操作完成后调用 `updateConfig({ manifest })` 
- 不影响现有逻辑结构，仅追加 manifest 写入
- Karpathy 原则 3: 仅触碰 init.js 的必要行，不重构

### 4.12 回滚机制

**部分失败保护**:
1. 执行前：将 Plan 中所有待删除文件快照拷贝到 `~/.config/xp-gate/.uninstall-backup/`
2. 按顺序执行删除操作（非破坏性 check 先，破坏性 delete 后）
3. 任一失败：停止后续操作，保留已执行结果
4. 再次运行 `xp-gate uninstall` 可恢复（幂等，已删除的文件 skip）

**操作顺序**:
```
1. 读取 config/building plan  （无破坏）
2. 打印 plan / 确认           （无破坏）
3. updateConfig mode→uninstalling （非破坏）
4. 创建 backup snapshot       （非破坏）
5. unset core.hooksPath       （可逆 git config）
6. 删除 template/             （开始破坏性操作）
7. 删除 adapters/             
8. 删除 hooks/                
9. 删除 githooks/             
10. updateConfig mode→uninstalled （标记完成）
11. 删除 backup               
```

### 4.13 doctor --fix 作用域

`doctor --fix` 仅在 `mode === "active"` 时执行修复。修复范围（枚举）:
| 诊断项 | --fix 行为 |
|--------|-----------|
| xp-gate.json 损坏/缺失 | ❌ 不修复（不可自动恢复）|
| hooks 缺失 | ✅ 从 npm 包内模板重装 |
| adapters 缺失 | ✅ 从 npm 包内模板重装 |
| core.hooksPath 错误 | ✅ 修正为 xp-gate 路径 |
| 环境依赖缺失 | ❌ 不修复（需用户手动安装 Node/Git/Bash）|

---

**Status**: Delphi Round 1 REQUEST_CHANGES → 修复完成 → 请求 Round 2 重审
