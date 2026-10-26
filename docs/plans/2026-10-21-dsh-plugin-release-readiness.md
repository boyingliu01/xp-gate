# DSH 插件功能完备性评估 —— 面向 DeepSeek Harness 用户发布前的差距清单

> 评估日期: 2026-10-21　分支: main　VERSION: 0.30.5.0
> 评估对象: `plugins/dsh/` → 已发布包 `@boyingliu01/dsh-plugin-xp-gate@0.30.5`
> 实测运行环境: `@deepseek-ai/dsh@0.2.0-rc.2`（Windows 11 + PowerShell executor）
> 关联文档: `docs/plans/2026-08-23-dsh-plugin-design.md`（设计）、`docs/plans/2026-09-30-dsh-integration-assessment.md`（上一次评估）

---

## 摘要（结论先行）

**插件"能跑"，但目前"发不出去、也发不准"。**

代码质量本身是好的：88 个单测全绿、`tsc` 零错误、4 个工具在真实 Cordis 上下文里注册成功、PowerShell 方言字符串实测可解析执行。问题全部集中在**发布契约**和**能力覆盖**这两层，不在实现层。

| 等级 | 数量 | 说明 |
|---|---|---|
| **P0 阻断发布** | 3 | 装不上 / 兜底路径实际不可用 / 用户拿到插件后发现 skill 没生效 |
| **P1 明显缺口** | 5 | 与 Claude Code / OpenCode / Qoder 的能力不对等 |
| **P2 打磨** | 6 | 成熟度、可运维性、文档一致性 |

**一句话结论**：把 P0 三项修掉，这个插件才具备"能被用户安装"的最低条件；要称"成熟高效"，还需补齐 P1 的 hook 能力与 Gate MW 证据闭环。

---

## 1. 现状盘点：这个东西现在是什么

### 1.1 已实现的能力（实测确认可用）

| 组件 | 实现 | 实测结果 |
|---|---|---|
| `gate-check` | `xp-gate check <path> [--gates …]` | 工具已注册，参数 `path` + `gates`，timeout 120s |
| `gate-principles` | `xp-gate principles <path>` | 工具已注册，仅 `path` 参数 |
| `gate-arch` | `xp-gate arch [--use-config <cfg>]` | 工具已注册，`--use-config` 标志在 CLI 中确实存在（`arch.js:321`） |
| `delphi-review` | 直连 OpenAI 兼容网关，3 模型匿名交叉评审 + 迭代到共识 | 工具已注册，timeout 900s |
| 12 个 skill | prepack 从仓库 `skills/` 复制 | 65 个文件、12 个目录，与仓库逐一对应 |
| 平台方言层 | `detectDialect()` → POSIX / PowerShell 双方言 | 生成的 pwsh 串 `if (Get-Command …) {…} else { Write-Output … }` 实测无 ParserError |
| 安全 | `GATE_WHITELIST` enum + 单引号转义 + `resolveTarget` 绝对化 | 22 个命令构造单测覆盖注入场景 |

实测输出：

```
name: tool-xp-gate
inject: ["tools","shell"]
registered tool count: 4
  - gate-check | params: path,gates | timeoutMs: 120000 | hasRender: true
  - gate-principles | params: path | timeoutMs: 120000 | hasRender: true
  - gate-arch | params: config | timeoutMs: 120000 | hasRender: true
  - delphi-review | params: subject,addressed,maxRounds,cwd | timeoutMs: 900000 | hasRender: true
```

```
Test Files  10 passed (10)
     Tests  88 passed (88)
```

### 1.2 与三个历史平台的能力对比

| 能力 | Claude Code | OpenCode | Qoder | **DSH（当前）** |
|---|---|---|---|---|
| gate-check / principles / arch | ✅ | ✅ | 经 npx | ✅ |
| Delphi 多模型评审 | 经 skill + agent | 经 skill | ✅ 3 agents | ✅ **原生工具（DSP 独有优势）** |
| PreToolUse 守卫（未 APPROVED 阻断 Edit/Write） | ✅ bash hook | ❌ | ✅ bash hook | ❌ **缺失** |
| PostToolUse 保存即检 | ✅ | ❌ | ✅ | ❌ **缺失** |
| skill 分发 | ✅ 随包 | ✅ 随包 | ✅ 随包（已提交） | ⚠️ **随包但 DSH 不发现** |
| Gate MW 证据产出 | skill 手工写 | skill 手工写 | skill 手工写 | ⚠️ **工具评完不落盘** |

**DSH 唯一的差异化优势是 `delphi-review` 原生工具**——它绕开 DSH `subagent` 只能继承单一模型的限制，用外部网关保证"三个不同模型"这一硬不变量。Claude Code / OpenCode / Qoder 都没有等价物。这个优势值得保留并作为发布卖点，但下面的 P0 会让它根本到不了用户手里。

---

## 2. P0 —— 阻断发布（修掉才有资格发）

### P0-1　peerDependencies 导致安装直接被拒（最严重）

**这不是推测，是用 DSH 自己的校验器跑出来的结论。**

`plugins/dsh/package.json`：

```json
"peerDependencies": {
  "@deepseek-ai/cordis": "^4.0.1",
  "@deepseek-ai/dsh-llm": "^0.1.1-rc.2",
  "@deepseek-ai/dsh-shell": "^0.1.1-rc.2",
  "@deepseek-ai/dsh-tools": "^0.1.1-rc.2"
}
```

DSH 在 `dsh plugin add` **安装后**会对每个 `@deepseek-ai/dsh*` peer 做 SemVer 校验
（`@deepseek-ai/dsh-app-boot/lib/index.js:286` `evaluatePluginCompatibility`，
`{ includePrerelease: true }`），不满足就**回滚整个安装**：

```
Plugin @boyingliu01/dsh-plugin-xp-gate@0.30.5 is incompatible with dsh 0.2.0-rc.2:
peerDependencies {"@deepseek-ai/dsh-llm":"^0.1.1-rc.2","@deepseek-ai/dsh-shell":"^0.1.1-rc.2","@deepseek-ai/dsh-tools":"^0.1.1-rc.2"}.
Running it may cause crashes or data loss.
…
dsh: installation rejected: …
dsh: restored package.json, pnpm-lock.yaml, and node_modules.
```

原因是最基础的 semver 语义：**`^0.1.1-rc.2` 不包含 `0.2.0-rc.2`**（`0.x` 的 caret 只放行 patch）。

```
satisfies('0.2.0-rc.2','^0.1.1-rc.2',{includePrerelease:true}) === false
```

而当前运行的 DSH 是 `0.2.0-rc.2`，`dsh-llm` / `dsh-shell` / `dsh-tools` 三个包全部是 `0.2.0-rc.2`。

> 这正是 README 里那句"peerDeps 仍 pin `0.1.1-rc.2`，但实测运行在 `0.2.0-rc.2` 上签名未变，无需改写"的代价：**API 确实没变，但安装器不认这句话。** 上一份评估（2026-09-30）把这条列在"短期"的第 9 项，实际上它是唯一的 P0 级阻断。

**修复**：把三个 peer 改成 `>=0.2.0-rc.2`（或目标版本区间），`cordis` 保持 `^4.0.1`。**同时必须加一条回归测试**——直接调用 `evaluatePluginCompatibility(manifest)` 断言返回 `undefined`，否则下次版本漂移又会静默复发。

### P0-2　`plugin add` 之后 skill 一个都看不见

`package.json` 的 `files` 确实带了 `skills/`（65 个文件都在 tarball 里），但 **DSH 没有任何机制把"插件的 `skills/` 目录"变成发现根**。实测全仓搜索：

```
DSH_BUNDLED_SKILL_DIR  →  仅 dsh-skill-filesystem/lib/index.js:84 一处读取，无任何写入方
dsh-skill-filesystem/lib/index.js:181  if (this.bundledSkillDir !== void 0) roots.push(...)
```

也就是说 `bundledSkillDir` 只在用户/发行版**显式配置**时才生效。DSH 现成的两个先例都是**自建 provider**，而不是"把目录塞进发现根"：

- `@deepseek-ai/dsh-skill-office` —— `ctx.skills.registerProvider(...)`，`rank: BUNDLED_SKILL_RANK`（600）
- `@deepseek-ai/dsh-skill-badge` —— 同样走 `registerProvider`

**当前后果**：用户执行 `dsh plugin add @boyingliu01/dsh-plugin-xp-gate` 后，`gate-*` 和 `delphi-review` 四个工具能用，但 sprint-flow / delphi-review / ralph-loop 等 12 个 skill **完全不可见**。用户会认为"这插件只给几个门禁工具"，而 skill 恰恰是 XP-Gate 在工作流层面最有价值的部分。

`setup-dsh.ps1` 里的 junction 方案是**仓库开发者的自用路径**（把 `~/.dsh/skills` 指向本仓库），对 npm 用户不成立。

**修复**：在 `apply(ctx)` 里注册一个 bundled skill provider，`inject` 增加 `"skills"`：

```ts
export const inject = ["tools", "shell", "skills"]

const skillDir = fileURLToPath(new URL("../skills/", import.meta.url))
ctx.skills.registerProvider(() => ({
  name: "xp-gate",
  list: () => Promise.resolve(candidates),   // rank: BUNDLED_SKILL_RANK
  get: async (candidate) => ({ ...summary, content }),
}))
```

必须**每次调用时解析正文**（不能用模块级缓存），否则用户编辑 skill 后看不到更新。

### P0-3　降级兜底在"装了 CLI 但跑不起来"时静默给出假绿勾

`command.ts` 的兜底逻辑是：

```powershell
if (Get-Command xp-gate -ErrorAction SilentlyContinue) { xp-gate principles '…' } else { Write-Output '[XP-Gate] xp-gate CLI not installed…' }
```

判据是 **"命令能否解析"**，不是 **"命令能否执行"**。只要 `xp-gate.ps1` 在 PATH 上（哪怕它指向的 `node_modules` 已损坏、版本已过期、或执行被环境拦截），就走进执行分支；若此时 xp-gate 自身失败并把诊断写到 stderr、stdout 为空，模型拿到的就是一个**没有任何门禁结果的空输出**。

实测（本机）：`Get-Command xp-gate` 能解析，但实际执行时 shim 起来就失败，`$LASTEXITCODE` 仍为 0——**插件无从判断这次到底跑没跑**。

对这个插件来说这是结构性问题：**"绿勾"型静默失败正是 XP-Gate 一直在 Gate 4 上着力修复的那类缺陷，插件自己却复制了一份。**

**修复**：
1. 兜底判据从"能否解析"改为 `$LASTEXITCODE` / 输出非空双重判断；
2. 输出里显式带上 `[xp-gate exit: N]`（`renderGateResult` 已有 `[exit code: N]`，但只在非 0 时打印，且空输出时那行 `[XP-Gate] command completed (no output).` 会被误读为成功）；
3. 空 stdout + exit 0 时输出 `[XP-Gate] gate produced no output — treating as indeterminate, not PASS.`

---

## 3. P1 —— 与既有平台不对等的缺口

### P1-1　没有任何 DSH 原生 hook（`tools/pre-execute` 守卫缺失）

Claude Code 与 Qoder 插件都用 `PreToolUse` 钩子实现了"未通过 Delphi/走查前不许改代码"。DSH 有等价能力且**不受 shell 方言问题影响**：

```
@deepseek-ai/dsh-tools/lib/types/index.d.ts:45
'tools/pre-execute'(…, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>
```

`pre-execute` 可以返回 `deny` 并把 reason 原样回给模型。上一份评估（2026-09-30 §"附：DSH 原生 hook 也能做门禁"）已经点名这是可行方向，但至今**未实现**。

这是 DSH 插件从"提供工具"升级为"提供约束"的关键一步。没有它，插件只是一个"模型想调才调"的工具盒——而 XP-Gate 的整个立论是 **"模型无法阻止自己的 commit"**。

建议实现两个 hook：
- `tools/pre-execute` → Delphi/sprint 守卫（对齐 `plugins/claude-code/bin/delphi-review-guard.sh`）
- `tools/post-execute` → Edit/Write 后对改动文件跑 `xp-gate principles`（对齐 `xp-gate-check`，advisory 不阻断）

### P1-2　`delphi-review` 评完不落盘，Gate MW 永远拿不到证据

`pre-push` 的 Gate MW 会读 `.code-walkthrough-result.json` 并校验（`githooks/lib/validate-code-walkthrough.cjs`）：

- `commit` 必须等于 HEAD
- `branch` 必须等于当前分支
- `timestamp` / `expires` 必须是**恰好相差 1 小时**的 UTC ISO-8601
- `consensus_ratio` ∈ [0.90, 1]
- 3 个 expert，`role` 必须是 `architecture`/`technical`/`feasibility`，`verdict` 必须 `APPROVED`
- `result_type` 必须 `delphi_expert_result`，`channel` 必须 `external`|`local`
- `requested_model` 精确去空白后互异，`resolved_model` 忽略大小写后互异

而 `delphi-review` 工具**只返回格式化文本**（`formatOutcome`），从来不写这个文件。实测 `plugins/dsh/src/` 全目录无任何 `writeFile`（只有测试里的 `writeFileSync` 用于构造 fixture）。

**后果**：用户在 DSH 里跑完了 Delphi 评审，`git push` 仍然被 Gate MW 拦下，因为证据文件不存在。用户只能手写 JSON —— 而手写恰好是 `channel` 白名单当初专门要防的作弊路径。

**修复**：`delphi-review` 增加可选 `writeEvidence: boolean` 参数（默认 `false` 以免副作用），写入时严格按 validator 的 schema 生成，`timestamp`/`expires` 用 UTC 且固定 1 小时间隔。这样 DSH 就成为**唯一一个能自动闭环 Gate MW 的平台**。

### P1-3　`gate-*` 三个工具的能力面偏窄

对比 `xp-gate` CLI 现役 **40+ 子命令**（`check` / `principles` / `arch` 只是其中 3 个），插件暴露的覆盖面很小。sprint-flow 这个核心 skill 强依赖的 CLI 子命令统计如下：

| 子命令 | skill 中出现次数 | 插件是否暴露 |
|---|---|---|
| `xp-gate retro` | 10 | ❌ |
| `xp-gate check` | 8 | ✅ `gate-check` |
| `xp-gate phase-transition` | 6 | ❌ |
| `xp-gate ui-review` | 4 | ❌ |
| `xp-gate sprint-status` | 3 | ❌ |
| `xp-gate sprint-init` | 2 | ❌ |
| `xp-gate sprint-audit` | 1 | ❌ |

也就是说 **sprint-flow 在 DSH 里跑起来时，Phase 流转等关键步骤只能靠模型自己拼 `pwsh` 命令串**——绕过了插件的转义与白名单保护。

建议增加一个通用的 `gate-cli` 透传工具（子命令 enum 白名单 + 参数转义复用现有 `shellQuote`），覆盖上述 sprint 系子命令；或至少补齐 `sprint-status` / `phase-transition`。

### P1-4　`delphi-review` 不响应取消

`gate-*` 三个工具都把 `exec.signal` 传给了 `runXpGate`（`index.ts:50/76/101`），但 `delphi-review` 完全没有接收 signal：

```
index.ts:50/76/101  runXpGate(shell, exec.signal, …)
（delphi-review 的 execute 里无 signal）
```

用户在 GUI 里点"停止"后，3 个模型 × 最多 5 轮的请求仍会继续打完（timeout 上限 900s），继续消耗 token 和配额。

**修复**：`runRound` / `chatOnce` 已经支持 `AbortSignal`（内部 `controller`），把 `exec.signal` 接进去并在 abort 时抛 `HarnessError(TOOL_ABORTED)` 即可。

### P1-5　工具结果总是 `exit 0`，模型无法用 `isError` 区分失败

`runXpGate` 永远 `resolve` 一段文本（这是刻意的设计，见 `gate-runner.ts` 注释）。但对比 DSH 自己的 `dsh-tool-bash`：它同样把非零退出渲染成 `[exit code: N]` 文本而非错误，**行为一致，这点没问题**。

真正的缺口是：`gate-check` 的语义是"跑门禁"，而门禁失败（exit 1）与"工具挂了"（exit 2 / ParserError）在输出里长得差不多。建议在 `renderGateResult` 里把三者分开：`PASS` / `GATE FAILED` / `INDETERMINATE`，让模型能一眼分辨。

---

## 4. P2 —— 成熟度打磨

| # | 项 | 现状 | 建议 |
|---|---|---|---|
| P2-1 | 无 DSH 原生 slash command | `@deepseek-ai/dsh-commands` 提供 `ctx.commands.register(definition)`，插件未使用 | 注册 `/xp-gate:check`、`/xp-gate:delphi` 等，提升可发现性 |
| P2-2 | 版本检查缺失 | OpenCode 插件有 npm 版本检查（`~/.xp-gate/opencode-plugin-version-check.json`，24h TTL） | DSH 插件无任何版本提示，用户会长期停在旧版 |
| P2-3 | `GATE_WHITELIST` 与真实 gate 不对齐 | 白名单 8 项（`duplicates/complexity/principles/arch/architecture/iac/secrets/sast`），实际 invokable gate 有 15 个 | 补 `tests`/`python-health`/`test-layers`/`pbt`；`arch`+`architecture` 是同一 gate 的两个别名，冗余 |
| P2-4 | `xp-gate install-skill` 不认识 DSH | `install-skill.js` 只认 `~/.qoder/skills`、`~/.claude/skills`、`~/.config/opencode/skills` | 增加 `~/.dsh/skills` 目标（上一份评估 G4，仍未修） |
| P2-5 | `scripts/build-plugin.sh` 仍无 dsh | `.mjs` 已支持，`.sh` 落后（上一份评估"小缺口"） | 补齐或删除 `.sh` 避免双入口 |
| P2-6 | README 与现实脱节 | README 说"12 个 skill 随包 → DSH 原生发现"，实际 P0-2 证明不成立；说 peerDeps "无需改写"，实际导致装不上 | 随 P0-1/P0-2 一起更正 |

---

## 5. 发布就绪清单（按执行顺序）

### 必须（BLOCKING）

- [ ] **P0-1** peerDeps 改 `>=0.2.0-rc.2`；加 `evaluatePluginCompatibility` 回归测试
- [ ] **P0-2** `apply()` 注册 bundled skill provider，`inject` 加 `"skills"`
- [ ] **P0-3** 兜底判据改为执行结果判定；空输出标 `INDETERMINATE` 而非 PASS
- [ ] 端到端验收：干净 profile 里 `dsh plugin --profile web add @boyingliu01/dsh-plugin-xp-gate` → 4 工具 + 12 skill 全部可见

### 强烈建议（成熟度）

- [ ] **P1-1** `tools/pre-execute` Delphi/sprint 守卫 + `tools/post-execute` 保存即检
- [ ] **P1-2** `delphi-review --write-evidence` 产出合规 `.code-walkthrough-result.json`
- [ ] **P1-4** `delphi-review` 接 `exec.signal`
- [ ] **P1-3** 补 sprint 系子命令（至少 `sprint-status` / `phase-transition`）

### 可选

- [ ] P2-1 ~ P2-6

---

## 6. 一句话给用户的价值主张（发布文案草稿）

> **把 XP-Gate 的确定性质量门禁接进 DeepSeek Harness。**
> 4 个原生工具（`gate-check` / `gate-principles` / `gate-arch` / `delphi-review`）+ 12 个工作流 skill。
> 其中 `delphi-review` 是 DSH 独有能力：**用 3 个真正不同的模型做匿名交叉评审并迭代到 90% 共识**——
> 这是 DSH 原生 `subagent` 做不到的（它只能继承单模型），也是 Claude Code / OpenCode / Qoder 上
> 只能靠手工拼脚本才能勉强实现的东西。
> `gate-*` 工具在没装 `xp-gate` CLI 时**优雅降级**，绝不阻断会话；Windows 上走原生 PowerShell 方言。

---

## 附录 A：本次实测证据

| 验证项 | 方法 | 结果 |
|---|---|---|
| 插件编译 | `tsc -p tsconfig.build.json --noEmit` | ✅ 零错误 |
| 插件单测 | `node node_modules/vitest/vitest.mjs run` | ✅ **88 passed / 10 files** |
| Cordis 加载 + 工具注册 | 真实 `apply(fakeCtx)` | ✅ 注册 4 个工具，schema/render 齐全 |
| **peerDeps 兼容性** | `evaluatePluginCompatibility(manifest)` @ dsh 0.2.0-rc.2 | ❌ **INCOMPATIBLE**（3 个 peer 不满足） |
| **skill 发现机制** | 全仓搜 `DSH_BUNDLED_SKILL_DIR` / `bundledSkillDir` | ❌ **无自动注入方**，`plugin add` 后 skill 不可见 |
| PowerShell 方言 | 生成串 + 实跑 | ✅ 无 ParserError |
| **兜底判据** | 解析成功但执行失败的场景 | ❌ **静默假绿勾风险** |
| `gate-arch --use-config` | 查 `src/npm-package/lib/arch.js` | ✅ 标志存在（`:321`） |
| Gate MW 证据 schema | 读 `githooks/lib/validate-code-walkthrough.cjs` | ✅ 字段已核实；❌ 工具不产出 |
| `delphi-review` 取消 | 检查 `exec.signal` 传递 | ❌ 未传 |
| skill 文件完整性 | 仓库 65 文件 vs 插件 65 文件 | ✅ 一致（12 目录） |

## 附录 B：关键代码位置

| 主题 | 位置 |
|---|---|
| 工具注册入口 | `plugins/dsh/src/index.ts:177-186` |
| 命令构造 / 兜底 | `plugins/dsh/src/command.ts:80-99` |
| 方言判定 | `plugins/dsh/src/dialect.ts:38-40` |
| 结果渲染 | `plugins/dsh/src/gate-runner.ts:15-36` |
| Delphi 编排 | `plugins/dsh/src/delphi-run.ts:69-109` |
| Delphi 传输 | `plugins/dsh/src/delphi.ts:134-185` |
| 配置解析（含全局兜底） | `plugins/dsh/src/delphi-config.ts:220-264` |
| DSH peer 校验器 | `@deepseek-ai/dsh-app-boot/lib/index.js:286` |
| DSH skill 发现根 | `@deepseek-ai/dsh-skill-filesystem/lib/index.js:150-188` |
| DSH bundled provider 先例 | `@deepseek-ai/dsh-skill-office/lib/index.js:54-100` |
| DSH `pre-execute` hook | `@deepseek-ai/dsh-tools/lib/types/index.d.ts:45` |
| Gate MW 校验器 | `githooks/lib/validate-code-walkthrough.cjs:112-145` |
