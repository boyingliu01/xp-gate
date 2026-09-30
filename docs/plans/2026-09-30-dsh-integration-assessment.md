# XP-Gate 在 DeepSeek Harness (DSH) 中的可执行性评估 + 轻量化评估

> 关联 Issue: #393（DSH 原生插件，v0.19.0.0 已关闭）
> 评估分支: `fix/gate-mw-cjs-detection` @ `3b3dc82`
> 目标环境: `@deepseek-ai/dsh@0.2.0-rc.2`（插件当初按 `0.1.1-rc.2` 开发）
> 日期: 2026-09-30

---

## 摘要（结论先行）

**第一部分：确定性质量门禁 —— 可以顺畅执行，无需为 DSH 做任何改造。**

`core.hooksPath` 指向 `~/.config/xp-gate/hooks`（v0.19.3，与仓库 VERSION 一致），12 道 pre-commit + 8 道 pre-push 由 **git 触发**，与 agent 平台完全解耦。DSH 里照常工作。

**第二部分：skill / Delphi 交叉评审 —— 目前不能顺畅执行，有 1 个硬阻塞 + 1 个已确认的代码 bug。**

| # | 结论 | 严重度 |
|---|------|--------|
| B1 | **Delphi 的"三个不同模型"在 DSH 中默认不可用** —— `subagent` 工具默认没有 `provider`/`model` 参数 | **阻塞** |
| B2 | **DSH 插件本体在 Windows 上 100% 不可用** —— 命令串是 POSIX 语法，DSH 在 Windows 走 PowerShell executor | **阻塞** |
| G1 | `xp-gate` CLI 全局装的是 Windows shim，**Git-Bash / POSIX 看不到** | 高 |
| G2 | `plugins/dsh` **从未编译**（`lib/` 不存在） | 高（已修复） |
| G3 | `xp-gate arch` 子命令**预先存在**的失败（archlint `--config` schema 漂移） | 中 |
| G4 | `install-skill` **没有 DSH 目标目录** | 中 |

**第三部分（附带评估）：轻量化 —— 前提需要反过来看。**

不是"大模型能否替代这些启发式规则"，而是 **14 条规则引擎里 12 条在 TypeScript 上根本无法触发**，且 **Gate 4 在 Windows 上永远静默通过**。最大的减重空间是**删除死代码**，不需要大模型参与。

---

## 1. 确定性门禁：与 DSH 完全解耦，开箱可用

### 证据

```
core.hooksPath = C:/Users/think/.config/xp-gate/hooks
hooks 目录      gate-3/4/7/8/9.sh, pre-commit(127KB), pre-push(41KB), sprint-gate.sh
xp-gate --version = v0.19.3   （与 VERSION 0.19.3.0 一致）
```

git hook 由 `git commit` / `git push` 触发，进程与 agent 无关。**DSH 存在与否都不影响。** 这部分"全局生效"的诉求已满足，不需要为 DSH 做适配。

### 外部工具就位情况（本机实测）

| 状态 | 工具 |
|------|------|
| ✅ 已装 | semgrep, gitleaks, jscpd, lizard, checkov, hadolint, eslint, ruff, archlint(0.16.0) |
| ❌ 缺失 | **ast-grep**, **kube-score**, **tflint**, **stryker** |

按项目约定「工具缺失 → SKIP 而非 BLOCK」，缺失只会降级为 SKIP。

> ⚠️ **`stryker` 缺失 ⇒ Gate M（pre-push 旗舰门禁）在本机完全无法运行**，尽管 `stryker.conf.json` 与 `stryker.prepush.conf.json` 都在。

---

## 2. Delphi 交叉评审：核心阻塞点

### B1（阻塞）DSH 的 subagent 默认不支持指定模型

`delphi-review` 的硬性不变量是：**3 个专家必须成功执行且使用 3 个 distinct trimmed model IDs**（`skills/delphi-review/SKILL.md`）。这要求在 DSH 里能给每个 subagent 指定不同的 provider/model。

实测 DSH 的 bundle 配置：

`@deepseek-ai/dsh-base/cordis.patch.yml:370-375`
```yaml
    - id: tool-subagent
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent
        backgroundMode: continuable      # ← 没有 modelSelectionSettings
```

而 `dsh-web-app` 的 preset 里**有**：
`@deepseek-ai/dsh-web-app/presets/cordis.patch.yml:89-95`
```yaml
              - id: tool-subagent
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: spawn
                  toolName: subagent
                  modelSelectionSettings: true    # ← 能力开关
                  backgroundMode: continuable
```

**但 `modelSelectionSettings: true` 只是"能力"，不是"激活"。** 真正的开关是一个 host 侧设置：

```js
// dsh-tool-subagent/lib/index.js
const current = settings.current();
allowedModels = current.enabled ? current.allowedModels : void 0;   // enabled 默认 false
```

其 schema 默认值（`lib/types/model-selection-settings.d.ts`）：
```ts
/** Stored user preference; the shipped composition defaults it off. */
export interface SubagentModelSelectionSettings {
    enabled: boolean;          // 默认 false
    allowedModels: AllowedModelRoute[];   // 默认 []
}
```

**实测确认：** `C:\Users\think\.dsh\` 下不存在任何 `subagentModelSelection` 持久化设置 → 处于默认 `enabled: false`。

**后果：** 除非 `enabled=true` 且 `allowedModels` 非空，否则 `subagent` 工具的 schema **没有** `provider`/`model`/`reasoning_effort` 字段，`list_subagent_models` 工具**不注册**，且运行时兜底会直接抛错：

```js
if (!enabled) throw new Error("child model selection is disabled for this tool instance");
```

这意味着 **Delphi 目前只能让 3 个专家继承同一个父模型 → 三个 `requested_model` 相同 → 按 skill 自身规则必须 BLOCK，不能降级为单专家**。

#### 解法（两条，都不需要改 xp-gate 的门禁）

**路线 A — 打开 DSH 的 subagent 模型选择（推荐，原生）**

设置 `subagentModelSelection.enabled = true` + `allowedModels` 至少 3 条不同 route。之后 `subagent` 工具会多出 `provider`/`model` 参数，Delphi 可直接用：

```
subagent(prompt=..., provider="whalecloud", model="g-deepseek-v4-pro")
subagent(prompt=..., provider="whalecloud", model="g-qwen3.8-max")
subagent(prompt=..., provider="whalecloud", model="g-glm-5.3")
```

> 该设置由 Web GUI 的 **Plugins 页面**编辑（host 侧 `dsh-web-app/cordis.patch.yml:66-67` 注册了 `subagent-model-selection-settings`）。本机 whalecloud 网关已配置 **100+ 个模型**，选 3 个不同模型毫无问题。

**路线 B — 走已存在的 external API runner（跨平台中立）**

`scripts/delphi-external-review.cjs` 是**平台无关的 CLI**，直接调 OpenAI 兼容 API，与 DSH 的 subagent 机制完全无关：

```bash
node scripts/delphi-external-review.cjs \
  --expert architecture --input-file <design.md> --round 1 \
  --config .delphi-config.json --mode design
```

实测可运行（缺参时报 usage 错误，逻辑正常）；`src/npm-package/scripts/delphi-external-review.cjs` 与 canonical 版本 **mirror 一致**（`check-delphi-runner-mirror.sh` PASS）。

> ⚠️ **但 `.delphi-config.json` 的 3 个 provider key 全部未设置**：`DASHSCOPE_API_KEY` / `ZHIPU_API_KEY` / `DEEPSEEK_API_KEY` 均为空。路线 B 需要先补 key。

**建议：** 用路线 A。DSH 原生、无需外部 key、复用现有 whalecloud 网关。

### B2（阻塞）DSH 插件在 Windows 上完全不可用 —— 已实测复现

这是本次评估**最有价值的发现**。插件 `plugins/dsh/src/command.ts` 生成的是 POSIX 命令串：

```ts
export function shq(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;      // POSIX 单引号转义
}

export function buildCommand(options: BuildCommandOptions): string {
  const inner = buildInner(options);
  return `if command -v xp-gate >/dev/null 2>&1; then ${inner}; else printf '%s\\n' ${shq(FALLBACK_MESSAGE)}; fi`;
}
```

而 **DSH 在 Windows 上用的是 PowerShell executor**：

`@deepseek-ai/dsh-base/cordis.patch.yml:235-242, 267-272`
```yaml
    - id: bash-sandbox
      disabled: !!js process.platform === 'win32'      # ← Windows 禁用 bash
    - id: pwsh-sandbox
      disabled: !!js process.platform !== 'win32'      # ← Windows 启用 pwsh
    - id: tool-bash
      disabled: !!js process.platform === 'win32'
    - id: tool-pwsh
      disabled: !!js process.platform !== 'win32'
```

**实测复现**（用 pwsh 作为 shell executor 加载已编译插件并调用 `gate-principles`）：

```
[stderr] ParserError:
Line |
   1 |  if command -v xp-gate >/dev/null 2>&1; then xp-gate principles 'D:\pr …
     |    ~
     | if语句中的'if'后缺少"(”。
[exit code: 1]
```

**结论：`gate-check` / `gate-principles` / `gate-arch` 三个工具在 Windows + DSH 上全部不可用**，报 PowerShell 语法错误。对比测试（用 bash 作 executor）则正确进入优雅降级分支，说明命令构造逻辑本身没错，只是**方言选错了**。

**修复方向：** 让插件**运行时探测 shell 方言**（或读取 `ctx.shell` 暴露的执行器信息），分别产出 POSIX / PowerShell 两种命令串。PowerShell 侧对应写法：
- `command -v X` → `Get-Command X -ErrorAction SilentlyContinue`
- `printf '%s\n' '...'` → `Write-Output '...'`
- 单引号转义 → 单引号内 `''` 双写

### 附：DSH 原生 hook 也能做门禁（可选增强）

`tools/pre-execute` waterfall 可以 **deny** 工具调用并把 reason 原样回给模型：

```ts
'deny'  →  content: [{type:'text', text: `Error: ${denialReason}`}], isError: true
```

这可以用来实现 Claude Code 插件里等价的 `delphi-review-guard`（未 APPROVED 前阻断 Edit/Write）——**纯 DSH 原生，无需 bash**，因此不受 B2 影响。这是插件后续可扩展的方向。

---

## 3. 其余已确认的缺口

### G1 `xp-gate` 在 Git-Bash 里不可见

```
PowerShell:  C:\Users\think\AppData\Roaming\npm\xp-gate.ps1  ✅ 可解析
Git-Bash:    command -v xp-gate  →  （空）                    ❌ 不可见
             $PATH 中无 /c/Users/think/AppData/Roaming/npm
```

因为插件用 `command -v` 探测，**即使 CLI 装了也会误报"未安装"并降级**。修 B2 时一并解决（PowerShell 用 `Get-Command`，或显式走 `npx`）。

### G2 `plugins/dsh` 从未编译 —— **已修复**

评估开始时：
```
plugins/dsh/lib/            不存在
plugins/dsh/node_modules/@deepseek-ai/   不存在（依赖未装）
```

已执行并验证：

| 步骤 | 结果 |
|------|------|
| `npm install --ignore-scripts` | ✅ 101 包（`--ignore-scripts` 绕过 esbuild 的 EBUSY） |
| `npm run build` (tsc) | ✅ 产出 `lib/index.js` + `gate-runner.js` + `command.js` |
| `node scripts/prepack.cjs` | ✅ 12 个 skill 就位 |
| `npm test` | ✅ **9/9 通过** |
| 真实 Cordis 加载冒烟测试 | ✅ `name=tool-xp-gate`, `inject=["tools","shell"]`, **注册 3 个工具** |

smoke test 输出：
```
plugin.name = tool-xp-gate
plugin.inject = ["tools","shell"]
registered tool count = 3
  - gate-check | params: type,properties,required
  - gate-principles | params: type,properties,required
  - gate-arch | params: type,properties
```

**API 兼容性已确认**：插件按 `0.1.1-rc.2` 编译，但实际运行在 `0.2.0-rc.2` 上，`defineTool` / `TOOL_ABORTED` / `HarnessError` 三个关键 API 在 0.2.0-rc.2 中签名未变 → **无需为版本漂移改写**。

### G3 `xp-gate arch` 预先存在的失败

```
$ xp-gate arch --config architecture.yaml
error: Config error: rules: data did not match any variant of untagged enum RuleConfig at line 65 column 3
```

根因（`src/npm-package/lib/arch.js`）：`runArchlinter()` 调 `npx -y @archlinter/cli scan . --config <cfg>`，而仓库 `architecture.yaml:64-68` 用的是旧 schema：

```yaml
rules:
  ARCH-001:  # Domain isolation
    enabled: true
    severity: error
    description: "..."
```

archlint 0.16 的 `--config` 校验器拒绝该结构。**注意这不是 DSH 问题**：
- ✅ 真正的 Gate 6 走 `archlint diff .architecture-baseline.json --fail-on high` → **正常工作**（实测 `✓ 24 improvements`，exit 0）
- ❌ 只有 `xp-gate arch`（`scan --config`）失败

`architecture.yaml` 自 v0.8.1 未改动，属**预先存在的缺陷**，会让插件里的 `gate-arch` 工具始终失败。

### G4 `install-skill` 没有 DSH 目标

`src/npm-package/lib/install-skill.js:12-21` 只认三个平台：

```js
function getSkillsDir() {
  const platform = detectPlatform();
  if (platform === 'qoder')       return path.join(HOME_DIR, '.qoder', 'skills');
  if (platform === 'claude-code') return path.join(HOME_DIR, '.claude', 'skills');
  return path.join(HOME_DIR, '.config', 'opencode', 'skills');
}
```

且 `detectPlatform()` 按存在性探测，本机 `~/.qoder/skills` 存在 → **恒返回 `qoder`**。DSH 需要的目标目录是 `~/.dsh/skills`（DSH 发现根 rank 400）。

### 其余小缺口

| 项 | 现状 |
|----|------|
| `scripts/build-plugin.sh` | 只支持 `claude-code\|opencode`，**无 dsh**（`build-plugin.mjs` 已支持，`.sh` 落后） |
| `plugins/dsh/scripts/prepack.cjs` | 硬编码 12 个 skill，**漏 `clipboard-vision`**（仓库有 13 个） |
| `skills/` 送达 DSH | 当前经 `~/.agents/skills` junction → `~/.qoder/skills`，即 **DSH 现在加载的是 Qoder 版 skill** |
| `plugins/dsh/package.json` peerDeps | 仍 pin `^0.1.1-rc.2`，实际运行 0.2.0-rc.2 |

---

## 4. 轻量化评估（附带问题）

### 4.1 前提需要反过来：不是"大模型能替代"，而是"规则引擎本身没在工作"

**已独立实测复现**，三条缺陷互相独立：

**缺陷 A — CLI 入口在 Windows 永不执行。**
`src/principles/index.ts:77-86`
```ts
function isDirectExecution(): boolean {
  if (typeof require !== 'undefined' && require.main === module) return true;
  if (typeof import.meta !== 'undefined' && import.meta.url && process.argv[1]) {
    const fileUrl = `file://${process.argv[1]}`;        // ← Windows 反斜杠
    return import.meta.url === fileUrl || import.meta.url.endsWith(`/${process.argv[1]}`);
  }
  return false;
}
```
实测：`argv[1]` = `D:\projects\xp-gate\.tmp-verify\probe.mts`（反斜杠）vs `import.meta.url` = `file:///D:/projects/...`（正斜杠 + 三斜杠）→ 永不相等。

实测 `npx tsx src/principles/index.ts --files <file> --format json` → **stdout 0 字节，exit 0**。

于是 `githooks/gate-4.sh` 读到空输出 → `ERROR_COUNT=0` → 打印 `✅ PASSED - Principles checker (no errors found).`

**→ Gate 4 在 Windows 上永远无法 BLOCK，是"绿勾"型静默失败。**

**缺陷 B — grep 模式与 JSON 格式不匹配（独立于 A）。**
`JSON.stringify(output, null, 2)` 产出 `"severity": "warning"`（**带空格**），而：
```
githooks/gate-4.sh:58,60        grep -c '"severity":"warning"'    ← 无空格
.github/workflows/quality-gates.yml:376-378   同样无空格
```

**缺陷 C — 12/15 条规则在 TypeScript 上结构性无法触发。**

实测（构造一个同时违反 8 参数、5 层嵌套、magic number、空 catch、16 方法 god class 的 TS 文件）：

```
TOTAL RULES: 15
VIOLATIONS: 1
    clean-code.long-function -> 0
    clean-code.large-file -> 0
    clean-code.magic-numbers -> 0
    clean-code.god-class -> 1        ← 唯一幸存
    clean-code.deep-nesting -> 0
    clean-code.too-many-params -> 0
    clean-code.missing-error-handling -> 0
    clean-code.unused-imports -> 0
    clean-code.code-duplication -> 0
    clean-code.many-exports -> 0
    solid.srp -> 0   solid.ocp -> 0   solid.lsp -> 0
    solid.isp -> 0   solid.dip -> 0
RULES THAT FIRED: 1 / 15
```

根因在 `src/principles/adapters/typescript.ts`：

```ts
  parseAST(): unknown {
    return this.createParseResult('typescript');    // ← 空壳，无真实 AST
  }

  extractFunctions(): unknown[] {
    const fnRegex = /(export\s+)?(async\s+)?function\s+(\w+)\s*\([^)]*\)\s*[:\w\s]*{/g;
    //              ↑ 必须字面量 function，类方法 m1(...) { } 永不匹配
    ...
    functionMatches.push(this.createCodeMatch(match[3], 'function', match.index));
    //                    ↑ 只返回 {name,type,line}，没有 length / paramCount / nestingDepth
  }
```

规则消费的字段全部为空：`paramCount=0 nestingDepth=0 hasTryCatch=0 ioOperations=0 imports=0 duplicationPercentage=0`。只有 `python.ts` 真正 emit 这些字段。

**`god-class` 之所以能工作**，是因为它不依赖 adapter 提取，而是**自己拿 class 源码重新 regex**（`god-class.ts`：`cls.code?.match(/(get|set)\s+\w+\s*\(|\w+\s*\([^)]*\)\s*{/g)`）。

另外 `@ast-grep/cli` 在 `package.json` dependencies 里、binary 存在、**文档里被引用 733 次并被称为"核心分析引擎"**，但**可执行代码里引用 0 次**。`docs/ARCHITECTURE.md:229-235` 声称各 adapter 使用 ast-grep —— 不成立。

> 对照：`boy-scout.ts` 有**独立入口**，实测正常工作（对上面那个文件返回 `overallStatus: "BLOCK"`，真实 exit code = 1）。所以 **Gate 6 有效、Gate 4 静默失效**。

### 4.2 哪些确实不该交给大模型

| 类别 | 门禁 | 理由 |
|------|------|------|
| 密钥扫描 | Gate 8 gitleaks | **最强论据**：必须可证明穷尽，且检查方本身不能有泄漏风险 |
| 重复代码 | Gate 2 jscpd | 同一输入 → 字节级相同报告 |
| IaC 安全 | Gate 7 checkov/hadolint | 带规则 ID，可追溯到公告 |
| SAST | Gate 9 semgrep | taint 跟踪 + CWE 映射 |
| 变异测试 | Gate M Stryker | 变异分数是**测量值**，正是大模型最容易幻觉的东西 |

三条大模型无法提供的性质：**确定性**（同 commit 同判定）、**可审计**（第三方可复现）、**反谄媚**（jscpd 的 hash 无法被说服）。

**最核心的一条论点：模型无法阻止自己的 commit。** 写代码的 agent 和评审的 agent 是同一个——让被告自己当法官。git hook 是墙，LLM 评审是建议。

### 4.3 轻量化优先级表

| # | 位置 | 减重 | 建议 | 置信度 | 风险 |
|---|------|------|------|--------|------|
| 1 | `src/principles/index.ts:77-86` | ~10 行 | **FIX** → `pathToFileURL(process.argv[1]).href` | 高 | 无。**最高优先级**——当前 Gate 4 是装饰品 |
| 2 | `githooks/gate-4.sh` + CI grep | 各 2 行 | **FIX** → 补空格或正规解析 JSON | 高 | 无，独立于 #1 |
| 3 | `solid/{srp,ocp,lsp,isp,dip}.ts` | 219 LOC + 测试 | **REMOVE**（或先修真 bug） | 高 | 功能上为零（实测 0/5）。且启发式本身错误：`ocp` 见 `extends`+`class` 就报、`dip` 禁止一切 `new`。仅失去 README 里的"SOLID 覆盖"**宣称** |
| 4 | `clean-code/{long-function,deep-nesting,too-many-params,magic-numbers,missing-error-handling,unused-imports,code-duplication}.ts` | 260 LOC + 测试 | **REMOVE**，或**修 adapter** | 高（"不触发"）/ 中（取舍） | 实测已死。ESLint/Ruff 已覆盖同类检查。若改修，`magic-numbers` 会在真实代码上大量误报 |
| 5 | 9 个 adapter 的 `parseAST()` | ~20 LOC | **REMOVE** | 高 | 无人调用的空壳；删了反而让架构描述诚实 |
| 6 | `@ast-grep/cli` 依赖 + `docs/ARCHITECTURE.md:229-235` | 1 依赖 + 文档 | **REMOVE 依赖 / 更正文档** | 高 | 代码引用 0 次 |
| 7 | `plugins/dsh/scripts/prepack.cjs` `SKILLS` 数组 | 1 名 | **FIX**（+`clipboard-vision`）或明确不打包 | 高 | 12 vs 13 静默不一致 |
| 8 | `delphi-review/SKILL.md` frontmatter（578 行里占 182 行） | ~150 行 | **精简**至 ~20 行触发词 | 高 | 三份重复列表（`triggers` / `triggers_negative_examples` / `triggers_negative_test_cases`）。**≥90% + 3 模型的不变量在正文，不受影响** |
| 9 | `skills/grill-with-docs/` | 0.2 KB | **REMOVE** | 高 | 正文只有一行"调用另外两个 skill"。被 sprint-flow Phase 2 引用，需同步改 |
| 10 | `skills/{grilling,batch-grill-me}/` | 2.4 KB | **合并** | 中 | 纯通用提示词散文 |
| 11 | `skills/ralph-loop` 的上下文管理叙述 | ~60% | **降级**为 3 层验证阶梯 | 中 | DSH 已原生提供 fresh subagent 上下文 + `ralph`/`goal` 工具 |
| 12 | `plugins/qoder/skills/**`（~72 跟踪文件） | ~72 文件 | **从 git 移除**，改为 prepack 生成 | 高 | qoder 是 4 个平台里唯一把构建产物提交进版本库的 |
| 13 | 32 个 `AGENTS.md` 镜像（26 个生成副本） | 26 文件 | **改为生成，不提交** | 高 | 已验证 SHA256 全等、零漂移 |
| 14 | `githooks/adapters/` ↔ `src/npm-package/adapters/` | 292 重复文件 | **构建期同步 + gitignore** | 中 | 已验证 292 文件零漂移；风险在安装路径可能直读提交副本，需回归 `xp-gate init` |
| 15 | `docs/CAPABILITIES.md` 6-Gate vs 13-Gate 自相矛盾 | ~40 行 | **统一为数字模型** | 高 | 同文件 3 行/5 行/134 行互相矛盾；需先取得"放弃双模型"的明确同意 |
| 16 | 未安装工具的语言分支（Python/Go/Java/Kotlin 变异，pre-push ~200 LOC） | ~200 LOC | **降级为 advisory** | 中 | **不要动 TS Gate M**——它是旗舰门禁，应改为**安装 stryker** |
| 17 | Gate 8/2/7/9 + `{sprint-flow,test-specification-alignment,delphi-review}` | — | **KEEP** | 高 | 确定性保障 + 不可推断的项目不变量 |
| 18 | `docs/plans/`（53 文件） | 53 文件 | **KEEP**（可归档） | 高 | 历史设计记录，被 incident/retro 引用 |

### 4.4 轻量化结论

**能减重，但方向是"删死代码"而非"换成大模型"。** 12/15 规则不触发是**缺陷**，不是"启发式被大模型超越"。可安全删除的约 **500 LOC 规则 + 它们在 5466 LOC 测试里的份额**（`src/principles` 测试占模块 66%，相当部分在测不可达路径）。

**大模型真正能替代的是判断**：`srp`/`dip`/`lsp`/`ocp`/`isp` 的语义判断、以及 `magic-numbers` 的上下文判断。但这些**今天已经死了或本身是错的**，所以这是删除而非替换。若想要回这些能力，正确形态是**advisory LLM review pass（非阻断）**，绝不是 git hook。

---

## 5. 建议的下一步（按优先级）

### 立即（阻塞项）

1. **修 B2** —— 让 `plugins/dsh` 按平台产出 POSIX / PowerShell 两种命令串。这是 Windows 上插件可用的前提。
2. **启用 DSH subagent 模型选择**（Plugins 页面设 `subagentModelSelection.enabled=true` + ≥3 条 `allowedModels`），解锁 Delphi 的 3 模型交叉评审。
3. **修 #1/#2（Gate 4 入口 + grep）** —— 一行级修复，换回 Windows 上真正的 Gate 4 阻断能力。当前是静默绿勾，风险最高。
4. **修 #1b（`--init-baseline` 覆盖基线）** —— 2 行修复，避免静默数据丢失并使 Gate 6 重新有效。

### 短期（补齐集成）

4. `scripts/build-plugin.sh` 补 dsh 平台（对齐 `.mjs`）。
5. `prepack.cjs` 决定是否打包 `clipboard-vision`。
6. `install-skill.js` / `detectPlatform()` 支持 `~/.dsh/skills`。
7. 修 `xp-gate arch`（G3）或将其明确标注为"需 archlint 0.16 兼容 schema"。
8. 安装 stryker（或明确接受 Gate M 在本机 SKIP）。
9. `plugins/dsh/package.json` peerDeps 更新到 `0.2.0-rc.2` 并重跑冒烟测试。

### 中期（可选增强）

10. 用 DSH 原生 `tools/pre-execute` hook 实现 Delphi guard（未 APPROVED 阻断 Edit/Write）——不受 B2 影响。
11. 按 §4.3 表推进轻量化，优先 #1–#6。

---

## 附录：本次评估已验证的事实清单

| 验证项 | 方法 | 结果 |
|--------|------|------|
| 插件可编译 | `npm run build` | ✅ 产出 lib/ |
| 插件单测 | `npm test` | ✅ 9/9 |
| 插件可被 Cordis 加载 | 真实 `Context` + fake services | ✅ 注册 3 工具 |
| 插件 API 兼容 0.2.0-rc.2 | 比对 `defineTool`/`TOOL_ABORTED`/`HarnessError` | ✅ 未变 |
| Windows executor 是 pwsh | bundle yml `disabled` 表达式 | ✅ 确认 |
| 插件在 pwsh 下失败 | pwsh executor 实测 | ❌ ParserError |
| 插件在 bash 下降级正常 | bash executor 实测 | ✅ 走 fallback 分支 |
| Gate 4 CLI 空输出 | `npx tsx ... --format json` | ❌ 0 字节 / exit 0 |
| 规则触发率 | 构造违规文件 + `analyze()` | ❌ 1/15 |
| boy-scout 正常 | 直接调用其入口 | ✅ BLOCK / exit 1 |
| archlint diff（真 Gate 6） | `archlint diff --fail-on high` | ✅ exit 0 |
| `xp-gate arch` 失败 | `xp-gate arch --config` | ❌ RuleConfig schema |
| delphi runner 可用 | 直接调用 | ✅ 逻辑正常（缺 key） |
| 3 个 provider key | 环境变量 | ❌ 全未设置 |
| subagent 无模型选择 | bundle + settings 探测 | ❌ 默认关闭 |
| 198 个测试失败性质 | `spawnSync` piped vs inherit | ✅ 沙箱 EBUSY，非代码缺陷 |
| `--init-baseline` 破坏性 | 在仓库实测 | ❌ 静默写入 `{}`，丢弃已跟踪条目 |

> **关于 198 个测试失败**：`npm test` 报 198 failed / 28 files。已定位为 **DSH Windows 沙箱的命名管道边界**——`spawnSync(..., {stdio:'pipe'})` 抛 `EBUSY`，而 `{stdio:'inherit'}` 正常（exit 0）。这些测试大量以 subprocess 方式断言 CLI 行为，故集体失败。**与本次评估的代码结论无关，也不是插件缺陷**；在普通终端 / CI 中不会出现。同理，`scripts/test-plugins.mjs` 的 3 项失败（claude-code/opencode build、opencode tsc）实测**直接运行均成功**，只是 `spawnSync` 捕获输出触发同一沙箱限制。
