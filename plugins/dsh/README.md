# @boyingliu01/dsh-plugin-xp-gate

XP-Gate 确定性质量门禁 + AI 工作流技能，作为 **DeepSeek Harness (DSH)** 原生插件（bundle）。

> 关联 Issue: #393　设计文档: `docs/plans/2026-08-23-dsh-plugin-design.md`
> 集成评估: `docs/plans/2026-09-30-dsh-integration-assessment.md`

## Tools

| Tool | Purpose |
|------|---------|
| `gate-check` | Run XP-Gate quality gates (`xp-gate check`) on a file or directory |
| `gate-principles` | Run the Clean Code/SOLID rules (`xp-gate principles`, Gate 4) |
| `gate-arch` | Run architecture validation (`xp-gate arch`, Gate 6) |

## Install

```bash
dsh plugin --profile <name> add @boyingliu01/dsh-plugin-xp-gate
```

The tools require a global `xp-gate` CLI:

```bash
npm install -g @boyingliu01/xp-gate
```

When `xp-gate` is missing the tools degrade gracefully (tool-missing → SKIP-style message) rather than erroring.

## ⚠️ 已知限制：Windows 上工具不可用（待修）

插件目前生成 **POSIX** 命令串（`command -v`、`printf`、单引号转义），但 DSH 在 Windows 上使用
**PowerShell executor**（`dsh-base` bundle 里 `bash-sandbox` 在 win32 被禁用、`pwsh-sandbox` 启用）。

实测结果（用 pwsh 作为 shell executor 加载本插件）：

```
[stderr] ParserError:
   1 |  if command -v xp-gate >/dev/null 2>&1; then xp-gate principles 'D:\pr …
     |    ~
     | if语句中的'if'后缺少"(”。
[exit code: 1]
```

**三个工具在 Windows + DSH 上均不可用。** 需按平台产出对应方言的命令串：

| POSIX | PowerShell |
|-------|-----------|
| `command -v X` | `Get-Command X -ErrorAction SilentlyContinue` |
| `printf '%s\n' '...'` | `Write-Output '...'` |
| `'\''`（单引号转义） | `''`（单引号内双写） |

另注：`xp-gate` 全局安装在 Windows 上只有 `xp-gate.cmd` / `xp-gate.ps1`，
`%APPDATA%\npm` **不在 Git-Bash 的 PATH 上**，所以即使走 bash 也会误判为"未安装"。

## Skills

本包在 publish 时通过 `scripts/prepack.cjs` 捆绑仓库 `skills/`（当前 12 个）。

要让 DSH 直接看到**仓库版** skill（而非 `~/.agents/skills` 里指向 `~/.qoder/skills` 的 junction），
运行仓库提供的准备脚本：

```powershell
pwsh -File plugins/dsh/setup-dsh.ps1           # 全部（skill 链接 + 编译 + 提示）
pwsh -File plugins/dsh/setup-dsh.ps1 -WhatIf   # 只预览
```

该脚本在 `$DSH_HOME/skills`（DSH 发现根 rank 400）为仓库每个 skill 建 junction，保持单一真源。

> DSH 只读 skill frontmatter 的 6 个字段：`name`、`description`、`whenToUse`、
> `metadata`、`disable-model-invocation`、`user-invocable`。
> 本仓库 skill 里的 `allowed-tools` / `hooks` / `triggers` / `maturity` / `auto_continue`
> **会被静默忽略**（无害，但不生效）。`references/` 子目录可用 —— DSH 的 `skill` 工具返回
> base directory，模型按需用 read 工具加载。

## Delphi 交叉评审的前置条件

`delphi-review` 的硬性不变量是 **3 个专家使用 3 个 distinct trimmed model IDs**。
DSH 的 `subagent` 工具**默认不支持**指定模型（`modelSelectionSettings` 默认关闭，
`allowedModels` 默认空），因此开箱即用时三个专家的 `requested_model` 会相同 → 按 skill
自身规则必须 BLOCK（不可降级为单专家）。

启用方式（Web GUI → **Plugins** 页面）：

```
subagent model selection:
  enabled = true
  allowedModels = [
    { provider: 'whalecloud', model: 'g-deepseek-v4-pro' },
    { provider: 'whalecloud', model: 'g-qwen3.8-max'     },
    { provider: 'whalecloud', model: 'g-glm-5.3'         }
  ]
```

启用后 `subagent` 工具会新增 `provider` / `model` / `reasoning_effort` 参数，
并注册 `list_subagent_models` 工具。

**备选路线**（与 DSH 无关，跨平台中立）：`scripts/delphi-external-review.cjs` 直连
OpenAI 兼容 API，需要自行设置 `DASHSCOPE_API_KEY` / `ZHIPU_API_KEY` / `DEEPSEEK_API_KEY`。

## Build

```bash
npm install --ignore-scripts   # --ignore-scripts 绕过 esbuild postinstall（受限环境会 EBUSY）
npm run build                  # tsc -> lib/
npm run prepare-skills         # 从仓库 skills/ 复制
npm test                       # vitest
```

或在仓库根目录：

```bash
npm run build:dsh-plugin       # = node scripts/build-plugin.mjs --platform dsh
```

## 注意

- `lib/` 与 `skills/` 是**构建产物**（已 gitignore），不提交。
- `scripts/prepack.cjs` 目前硬编码 12 个 skill，**不含 `clipboard-vision`**（仓库有 13 个）。
- `plugins/dsh/package.json` 的 peerDeps 仍 pin `0.1.1-rc.2`，但实测运行在 `0.2.0-rc.2` 上
  `defineTool` / `TOOL_ABORTED` / `HarnessError` 签名未变，无需改写。
