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
| `delphi-review` | **多模型交叉评审**：用 3 个不同模型独立评审同一份材料并迭代到共识（见下） |

## Install

```bash
dsh plugin --profile <name> add @boyingliu01/dsh-plugin-xp-gate
```

The `gate-*` tools require a global `xp-gate` CLI:

```bash
npm install -g @boyingliu01/xp-gate
```

When `xp-gate` is missing those tools degrade gracefully (tool-missing → SKIP-style message) rather than erroring.

## 跨平台：shell 方言层

DSH 在非 Windows 上使用 POSIX shell、在 Windows 上使用 **PowerShell executor**
（`dsh-base` bundle 里 `bash-sandbox` 在 win32 被禁用、`pwsh-sandbox` 启用）。

插件最初硬编码 POSIX 命令串，导致三个工具在 Windows 上**全部解析失败**：

```
[stderr] ParserError:
   1 |  if command -v xp-gate >/dev/null 2>&1; then xp-gate principles 'D:\pr …
     |    ~
     | if语句中的'if'后缺少"(”。
[exit code: 1]
```

现已按平台生成对应方言（`src/dialect.ts`）：

| POSIX | PowerShell |
|-------|-----------|
| `command -v X` | `Get-Command X -ErrorAction SilentlyContinue` |
| `printf '%s\n' '...'` | `Write-Output '...'` |
| `'\''`（单引号转义） | `''`（单引号内双写） |

实测（Windows + PowerShell executor）：`gate-check` exit 0、`gate-principles` exit 0（`Rules run: 15`）。

## 多模型交叉评审（`delphi-review`）

### 为什么需要它，而不是用 DSH 的 subagent

Delphi 方法的价值**完全建立在「评审者是不同模型」之上**。DSH 的 `subagent` 工具继承宿主
配置的**单一**模型，因此三个"专家"会是同一个模型的三个实例 —— 按 `delphi-review` skill
自身的规则必须 BLOCK。

所以本工具**直接调用外部 OpenAI 兼容网关**，每个席位绑定一个不同模型。

> 另一条路线是打开 DSH 的 `subagentModelSelection`（Web GUI → **Plugins**），让 subagent
> 也能选模型。两者并不冲突：那条路线让 DSH 原生 subagent 具备多模型能力，本工具则在
> **不依赖宿主配置**的前提下保证不变量成立（包括 CI / 一次性会话）。

### 配置

复用项目既有的 `.delphi-config.json`（skill 与工具**同一份配置**）：

```jsonc
{
  "active_profile": "whalecloud",
  "profiles": {
    "whalecloud": {
      "providers": {
        "whalecloud": {
          "base_url": "https://<gateway>/gpt-proxy",
          "api_key": "${WHALECLOUD_API_KEY}"   // 支持 ${VAR} 与 {env:VAR} 两种写法
        }
      },
      "experts": {                              // 对象形式；key 即角色
        "architecture": { "provider": "whalecloud", "model": "g-glm-5.3-flash" },
        "technical":    { "provider": "whalecloud", "model": "g-qwen3.8-flash" },
        "feasibility":  { "provider": "whalecloud", "model": "g-deepseek-flash" }
      }
    }
  },
  "consensus": { "threshold_percent": 90, "max_review_rounds": 5 }
}
```

密钥**只从环境变量读取**，绝不写入配置文件。
`experts` 同时接受**对象形式**（key 为角色）与**数组形式**（explicit `role` 字段）。

### 强制的不变量（代码强制，非文档约定）

| 不变量 | 违反时 |
|---|---|
| 恰好 3 位专家 | `DelphiConfigError` |
| 3 个 `requested_model` 去空白后两两不同 | `DelphiConfigError` |
| 模型不得为未展开的 `${...}` 占位符 | `DelphiConfigError`（在网络调用**之前**） |
| 缺密钥 / 缺 provider / 专家跨网关 | `DelphiSetupError`，报出变量名而非回显配置 |
| 报告缺 `### VERDICT` 段 | 记为 `INVALID_NO_VERDICT`，**不计入共识**（绝不从散文里猜裁决） |
| 退出码 0 但内容为空 | 记为 ERROR（推理模型可能把预算全烧在隐藏 token 上） |
| 共识按**全体席位数**计算 | 一份畸形报告不能靠其余全票"凑"出共识 |

共识阈值为百分比：3 席时 ≥90% 意味着**必须 3/3 通过**。

### 轮次语义

- **Round 1 匿名且并发**：各席位互不可见。
- **Round 2+**：回传**汇总票型**（`architecture: APPROVED` …）与"已修改项"，
  各席位据此修正或坚持立场。**个体报告始终匿名** —— 只共享计票，这是方法可信的前提。
- 达到阈值即停；否则到 `max_review_rounds`（默认 5）为止，并如实返回 `NO CONSENSUS`。

### 已知行为（实测）

用一段**故意有缺陷**的样例代码喂给三个模型，15 次调用（5 轮 × 3 模型）全部成功且
`resolved_model` 两两不同，三个模型**独立**指出同一个真实缺陷：
`{ ok: true }` 是**无条件**返回的常量，"把退出码契约换成了一个常量，而不是真正的结果信号"。
机制**拒绝**给出共识，而不是盖章通过 —— 这正是它该有的行为。

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

## 备选路线：启用 DSH 原生 subagent 模型选择

上面的 `delphi-review` 工具不依赖宿主配置即可保证不变量。若你希望 DSH **原生**
`subagent` 工具也能指定模型（例如让 Agent Teams 的队友跑不同模型），需显式启用
（Web GUI → **Plugins** 页面）：

```
subagent model selection:
  enabled = true
  allowedModels = [
    { provider: 'whalecloud', model: 'g-glm-5.3-flash'  },
    { provider: 'whalecloud', model: 'g-qwen3.8-flash'  },
    { provider: 'whalecloud', model: 'g-deepseek-flash' }
  ]
```

启用后 `subagent` 工具会新增 `provider` / `model` / `reasoning_effort` 参数，
并注册 `list_subagent_models` 工具。

> 注意：`dsh-tool-subagent` 的 `modelSelectionSettings: true` **只是能力开关**；
> 实际策略来自宿主设置 `SubagentModelSelectionConfig`（`enabled` 默认 `false`，
> `allowedModels` 默认 `[]`）。两者都要满足才会生效。

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
