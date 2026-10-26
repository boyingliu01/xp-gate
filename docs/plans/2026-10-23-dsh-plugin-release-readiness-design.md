# DSH 插件发布就绪设计（v2）— 从"能跑"到"能发"

**日期**: 2026-10-23
**Sprint**: `sprint-20261023-15`
**状态**: 待 R2 delphi-review 评审
**前序文档**:
- `docs/plans/2026-08-23-dsh-plugin-design.md`（v1 设计，AC-6 假设已被证伪）
- `docs/plans/2026-10-21-dsh-plugin-release-readiness.md`（差距评估，本设计的输入）

---

## 0. 这份设计要解决什么

v1 设计（2026-08-23）的 8 条 AC 全部按"插件能在 DSH 里加载并注册工具"来写，实测这 8 条**大部分成立**：88 个单测全绿、`tsc` 零错误、4 个工具在真实 Cordis 上下文里注册成功、PowerShell 方言串实跑无 ParserError。

但"能加载"不等于"能发布"。评估暴露出三类问题，全部位于**发布契约层**而非实现层：

| 类别 | 问题 | 后果 |
|---|---|---|
| **装不上** | peerDeps pin `^0.1.1-rc.2`，运行时 `0.2.0-rc.2` | `dsh plugin add` 回滚整个安装 |
| **装上是空的** | 65 个 skill 文件在 tarball 里，但 DSH 永不发现 | 用户只拿到 4 个工具 |
| **装上也可能是坏的** | Delphi 凭证只读 `process.env`，而 key 在 DSH 凭据库里 | `delphi-review` 直接报错 |

因此 v2 设计的目标不是"补功能"，而是**建立三条可验证的发布不变量**：

- **INV-1 可安装**：在干净的 DSH 0.2.x 上 `dsh plugin add` 必须成功
- **INV-2 可交付**：装完后 12 个 skill 与 4 个工具**全部**对模型可见
- **INV-3 可运行**：`delphi-review` 能在 DSH 内取到凭据并完成一轮真实评审

P1 项（hooks / evidence / signal / sprint 子命令）建立在这三条之上，属于"成熟度"而非"能发布"。

---

## 1. 设计原则

### 1.1 对齐 DSH 原生范式，而非移植其他平台的机制

Claude Code / Qoder 用 shell hook 实现门禁守卫，因为那是它们唯一的扩展点。DSH 提供了结构化的 `tools/pre-execute` waterfall，返回类型化的 `PreToolDecision`，**不受 shell 方言问题影响**。把 bash hook 搬过来是错的，应该用 DSH 的 seam。

**判定标准**：如果某个能力在 DSH 有声明式 seam，就必须用 seam，不允许 shell 出。

### 1.2 优雅降级，但绝不静默假绿

v1 的"CLI 未安装就返回提示、不阻断会话"这个方向是对的，必须保留。但它把**判据**搞错了：用"命令能否解析"代替"命令能否成功执行"，导致装了坏 CLI 时返回空输出，被模型读成绿勾。

这正是 XP-Gate 在 Gate 8 / Gate 10 上反复修的那类缺陷——**一个不能跑的安全门禁不得报告成功**。插件不能自己再犯一次。

**判定标准**：任何工具输出必须能区分 `PASS` / `GATE FAILED` / `INDETERMINATE` 三态，不允许二元。

### 1.3 证据产物必须由校验器反向定义

`.code-walkthrough-result.json` 的字段契约由 `githooks/lib/validate-code-walkthrough.cjs` 定义，而这个文件**刚刚收严**（#574）：存在 `.delphi-config.json` 时，每个 expert 的 `requested_model` 必须等于该 role 在**活动 profile** 里配置的席位。

设计不能自己发明 schema，必须**逐字段对齐校验器**，并且实现后要能跑过真实 validator。

### 1.4 不引入新的单点

Delphi 的价值在于"三个真正不同的模型"。DSH 原生 `subagent` 只能继承单一主机模型，所以 v1 绕开 subagent 直连外部网关——**这个决策是对的，v2 保留**。但 v1 让凭证依附于 `process.env` 这一个单点，v2 改为走 DSH 的 `ctx.credentials` seam。

---

## 2. 架构

### 2.1 新增模块

```
plugins/dsh/src/
├── index.ts            # 修改：inject 增加 "skills"；注册 4 工具 + 2 hooks；调 skill provider
├── skill-provider.ts   # 新增：bundled skill provider（P0-2）
├── credentials.ts      # 新增：DSH 凭据解析 + env 兜底（P1-5）
├── evidence.ts         # 新增：Gate MW 证据生成（P1-2）
├── hooks.ts            # 新增：pre-execute 守卫 + post-execute 检查（P1-1）
├── command.ts          # 修改：兜底判据 + sprint 子命令白名单（P0-3, P1-3）
├── gate-runner.ts      # 修改：三态渲染（P0-3）
├── delphi-run.ts       # 修改：signal 透传 + 调 evidence（P1-2, P1-4）
├── delphi.ts           # 修改：signal 透传（P1-4）
├── delphi-config.ts    # 修改：接受已解析的 apiKey（P1-5）
└── package.json        # 修改：peerDeps 区间（P0-1）
```

### 2.2 依赖注入方向

```
index.ts (apply)
  ├─ 读 ctx.shell → 方言检测 → 工具工厂
  ├─ 读 ctx.skills  → registerProvider(xpGateSkills(assetRoot))
  ├─ 读 ctx.credentials → 构造 resolveApiKey(ref)
  └─ 注册 hooks：
       tools/pre-execute  → delphiGuard(cwd)
       tools/post-execute → principlesCheck(cwd, shell, dialect)
```

所有新模块**只依赖注入进来的能力**，不在模块顶层读 `process.env` 或 `process.cwd()`。这保证单测可以完全离线跑（v1 的 88 个测试已经建立这个风格，延续它）。

---

## 3. 逐项设计

### P0-1　peerDependencies 改为区间

**现状**（`plugins/dsh/package.json`）：

```json
"@deepseek-ai/dsh-llm": "^0.1.1-rc.2",
"@deepseek-ai/dsh-shell": "^0.1.1-rc.2",
"@deepseek-ai/dsh-tools": "^0.1.1-rc.2"
```

`^0.1.1-rc.2` 在 0.x 下只放行 patch，不含 `0.2.0-rc.2`。DSH 的 `evaluatePluginCompatibility` 判定不兼容后**回滚安装**。

**设计**：

```json
"@deepseek-ai/dsh-llm": ">=0.2.0-rc.2 <0.3.0-0",
"@deepseek-ai/dsh-shell": ">=0.2.0-rc.2 <0.3.0-0",
"@deepseek-ai/dsh-tools": ">=0.2.0-rc.2 <0.3.0-0"
```

选 `>=X <Y` 而非 `^`：0.x 阶段 `^` 语义过窄（只放行 patch），而 DSH 处于 rc 期，minor 会带 API 变化。

#### 上界必须写 `<0.3.0-0`，不是 `<0.3.0`（实测修正，2026-10-23）

初版设计写的是 `<0.3.0`，**实测发现它拦不住 `0.3.0-rc.1`**。

DSH 的 `evaluatePluginCompatibility` 以 `{ includePrerelease: true }` 调用 `semver.satisfies`。在该模式下，`<0.3.0` 会**包含** `0.3.0-rc.1`（预发布版本排在正式版之前）。用 `semver` 逐版本实测：

| version | `>=0.1.1-rc.2 <0.3.0` | `>=0.2.0-rc.2 <0.3.0-0` |
|---|---|---|
| `0.2.0-rc.2`（当前运行时） | IN | **IN** ✅ |
| `0.2.1` / `0.2.9` | IN | **IN** ✅ |
| `0.3.0-rc.1` | **IN ❌（本应拦住）** | **out** ✅ |
| `0.3.0` / `0.3.1` | out | out ✅ |
| `0.1.1-rc.2` | IN | out |
| `0.1.0` | out | out |

`<0.3.0-0` 中的 `-0` 是 semver 的「最小预发布」哨兵，表示「连 `0.3.0` 的第 0 个预发布都不包含」，从而真正封死整个 `0.3.0` 线。

**下界取 `0.2.0-rc.2` 而非 `0.1.1-rc.2`**：`0.2.0-rc.2` 是唯一实测过的运行时。声明支持一个没测过的版本，正是"silent 假绿"的另一种形式——与设计原则 1.2 一致，声明必须与证据匹配。若未来要支持更早版本，需先补实测。

**为什么不用 `*` 或 `>=0.1.1`**：那等于放弃兼容性声明。DSH 的校验器是保护机制，绕开它就失去了"版本漂移时安装器会拦住"的价值。区间的作用是**允许已实测的版本，拦住未实测的版本**。

**这条修正也说明 `compat.test.ts` 必须测边界值**（`0.3.0-rc.1` 必须判 incompatible），而不只是断言"当前版本能装"——否则上界写错时测试不会红。


**验证**：新增 `compat.test.ts`，直接调 `evaluatePluginCompatibility` 断言返回 `undefined`。这条测试的价值在于——**下次版本漂移时会自动红**，而不是等用户装不上才发现。

**风险**：`dsh plugin allow-version` 的豁免是按 `name@version` 精确匹配的，每次发版都要重新申请。这是 DSH 侧机制，插件无法规避，但**扩大区间能显著降低触发频率**。

---

### P0-2　bundled skill provider

**现状**：`files` 含 `skills/`（65 个文件确在 tarball 里），但 DSH 的发现根里没有任何一项指向插件目录。实测 `DSH_BUNDLED_SKILL_DIR` **只有读、没有写**，全仓无一处设置它。

**设计**：注册一个 `SkillProvider`，以 `BUNDLED_SKILL_RANK`（600）参与优先级。

参照 `@deepseek-ai/dsh-skill-office` 的实测实现（这是 DSH 自己的官方先例）：

```ts
// skill-provider.ts
const assetRoot = fileURLToPath(new URL("../skills/", import.meta.url))

// list(): 预扫描 frontmatter，返回候选（不含正文）
const candidates: SkillCandidate[] = dirs.map(name => ({
  name,
  description,                       // 从 SKILL.md frontmatter 解析
  invocation: { modelInvocable: true, userInvocable: true },
  provider: "xp-gate",
  source: "bundled",
  rank: BUNDLED_SKILL_RANK,
  resourceBase: { kind: "directory", path: dir },  // references/ 与 templates/ 靠它解析
  locator: skillMdPath,
}))

// get(): 每次调用读取正文 —— 不缓存
async get(candidate, options) {
  const raw = await readFile(candidate.locator, { encoding: "utf8", signal: options.signal })
  return { ...summary, content: parseBody(raw) }
}
```

**关键设计点**：

1. **`resourceBase` 必须是 `{ kind: "directory", path: dir }`**。12 个 skill 里有 8 个引用 `references/*.md` 和 `templates/*`，缺了它相对路径无法解析，skill 会指向不存在的资源。
2. **`get()` 每次读盘，`list()` 只读一次**。office 的实现就是这个形状：list 的候选在 `apply()` 时扫描一次（skill 集合随包固定，不会运行时变化），正文每次加载。这样用户修改 skill 后无需重启即可生效，同时避免每次 list 都做 12 次 IO。
3. **`inject` 必须加 `"skills"`**，否则 `ctx.skills` 可能尚未就绪。当前 `inject = ["tools", "shell"]`。
4. **`assetRoot` 用 `import.meta.url` 解析到 `../skills/`**，不用 `process.cwd()`。这与 `dsh-skill-office` 完全一致，也是 npm 安装后唯一正确的定位方式。

**优先级语义**（需在设计评审中确认）：

| 发现根 | rank |
|---|---|
| 项目 `.dsh/skills` | 100 |
| 项目 `.agents/skills` | 200 |
| `customSkillDirs` | 300 |
| `~/.dsh/skills` | 400 |
| `~/.agents/skills` | 500 |
| **bundled（本插件）** | **600** |

数字小者优先。所以用户的本地 skill 会**覆盖**插件自带的同名 skill —— 这是正确行为（本地修改优先），也让 `setup-dsh.ps1` 的 junction 方案退化为"开发期可选加速"，而非必需。

**v1 的 AC-6 必须修改**：它写的是"经 bundledSkillDir 可发现"，而 `bundledSkillDir` 是需要用户手动配置的字段，不是插件能自设的。正确表述是"经插件注册的 SkillProvider 可发现"。

---

### P0-3　三态渲染与兜底判据

**现状**（`command.ts`）：

```powershell
if (Get-Command xp-gate -ErrorAction SilentlyContinue) { xp-gate principles '...' }
else { Write-Output '[XP-Gate] xp-gate CLI not installed...' }
```

判据是"能否解析"。实测存在"能解析但执行失败、退出码仍为 0"的情形，此时输出为空，模型读成绿勾。

**设计**：把判据从"解析"改为"执行结果"，并把输出归一为三态：

| 态 | 判据 | 模型可见文案 |
|---|---|---|
| `PASS` | exit 0 **且** stdout 非空 | `[XP-Gate] PASS` |
| `GATE FAILED` | exit ≠ 0 | `[XP-Gate] GATE FAILED [exit code: N]` + stderr |
| `INDETERMINATE` | exit 0 但 stdout 为空，或 CLI 不可执行 | `[XP-Gate] INDETERMINATE — gate produced no output; NOT a pass` |

#### 三态的完整判定表（回应 R1 technical R4）

评审（technical R4）指出：原定义只覆盖"空 stdout + exit 0"，未定义"非零退出但 stdout 为空"、"有输出但缺字段"等边界。**成立**，补全判定表：

| exit code | stdout | stderr | 判定 | 理由 |
|---|---|---|---|---|
| 0 | 非空 | 任意 | `PASS` | 正常通过 |
| 0 | 空 | 任意 | **`INDETERMINATE`** | 命令成功了但没说话——不能当通过 |
| 非 0 | 非空 | 任意 | `GATE FAILED` | 门禁确实拦了，附完整输出 |
| 非 0 | 空 | 非空 | `GATE FAILED` | 失败且只有 stderr，附 stderr |
| 非 0 | 空 | 空 | **`INDETERMINATE`** | 既没结论也没原因，典型如 command-not-found |
| 任意 | 超时 / 输出被截断 | — | `INDETERMINATE` | 未取得完整结论 |

**关于"JSON 但缺字段"**：门禁工具的 stdout 是**给人/模型读的文本**，不是结构化协议，所以不做字段级校验。真正需要结构化断言的地方是证据文件（P1-2），那里由 validator 负责——两处职责不混。

**判定实现顺序**（不可调换）：

```
1. 收集 stdout / stderr / exitCode（已由 shell seam 提供）
2. if (timedOut || truncated)      → INDETERMINATE
3. if (exit === 0 && stdout === "") → INDETERMINATE
4. if (exit === 0)                 → PASS
5. else                            → GATE FAILED
```

第 2 步必须在第 3、4 步之前：超时的情况下 exit code 可能是 0（进程被 SIGTERM 前的残留状态），若先判 exit 会把超时当通过。

**每个分支都要有单测**（AC-5/AC-6 扩充为 6 条，逐行覆盖上表）。


命令构造改为**单一形态**，不再依赖 shell 分支判断可用性：

- POSIX：`xp-gate <sub> <args> 2>&1 || echo "[XP-Gate] exit:$?"`
- PowerShell：`xp-gate <sub> <args> 2>&1; "[XP-Gate] exit:$LASTEXITCODE"`

即**无论是否存在 CLI 都执行**，把"不存在"自然变成非零退出（command not found），由 `renderGateResult` 判为 `INDETERMINATE` 并附安装提示。这样少一个分支，也消除了"解析成功但跑不起来"的盲区。

**为什么不再保留 "not installed" 特判**：因为无法可靠区分"未安装"与"安装了但坏了"。诚实地报 `INDETERMINATE` 比猜一个具体原因更有用，且安装提示可以无条件附上。

---

### P1-1　DSH 原生 hooks

**设计**：注册两个 hook，逻辑对齐 Claude Code 的 `delphi-review-guard.sh` 与 `xp-gate-check`，但用 DSH 的原生 seam。

#### pre-execute 守卫

```ts
ctx.on("tools/pre-execute", async (exec, next) => {
  const EDIT_TOOLS = new Set(["write", "edit", "str_replace_editor"])
  if (!EDIT_TOOLS.has(exec.tool.name)) return next()
  const verdict = readDelphiVerdict(cwd)          // .sprint-state/delphi-reviewed.json
  if (verdict === undefined) return next()        // 无 .sprint-state → 非 sprint 项目，放行
  if (verdict === "APPROVED") return next()
  return { kind: "deny", reason: "delphi-review not APPROVED..." }
})
```

**工具名已实测确认**：`dsh-tool-fs` 注册 `read` / `write` / `edit` / `read_image`，`dsh-tool-str-replace-editor` 注册 `str_replace_editor`。编辑类是 `write`、`edit`、`str_replace_editor`（`read`/`read_image` 是只读，不拦）。

**降级语义**（沿用 Claude Code 的成熟策略）：

| 状态 | 行为 |
|---|---|
| 无 `.sprint-state/` 目录 | **放行**（非 sprint 项目，不该被门禁打扰） |
| 有目录但无 `delphi-reviewed.json` | **拒绝**（sprint 进行中，评审未完成） |
| verdict ≠ APPROVED | **拒绝**，reason 带当前 verdict |
| verdict = APPROVED | **放行** |

#### post-execute 检查

对 `write` / `edit` / `str_replace_editor` 的结果，取被改动文件路径跑 `xp-gate principles`，把结果作为**附加上下文**返回（`kind: "accept"` + `additionalContexts`），不阻断。

**为什么不用 `kind: "block"`**：保存即检的目的是**尽早暴露**问题，而不是在模型写文件写到一半时打断它——那会让模型陷入"改一个报一个"的反复。Claude Code 的 `xp-gate-check` 也是 `exit 0` always。

#### 性能约束（回应 R2 feasibility MA-02）

评审指出：每次 write/edit 都起一个子进程跑 `xp-gate principles`，在 agentic 编码会话里会造成明显延迟。

这条成立。`xp-gate principles` 是 Node CLI，冷启动约 200-400ms，而一次会话里的编辑操作可能有几十上百次。

**设计约束（三条，必须全部落实）**：

1. **扩展名白名单**：只对 principles 引擎真正覆盖的语言触发
   ```
   .ts .tsx .js .jsx .py .go .java .kt .c .cpp .h .swift .m .dart .sh .ps1
   ```
   对 `.md` / `.json` / `.yaml` / 二进制文件**直接跳过**。文档提交占 XP-Gate 使用场景的很大比例，跳过它们能砍掉大部分开销。

2. **按路径去重，同一文件每会话只检一次**
   ```ts
   const checked = new Set<string>()   // 会话级
   if (checked.has(absPath)) return next()
   checked.add(absPath)
   ```
   模型改同一个文件 10 次，只跑 1 次检查。第二次以后的编辑往往是在修第一次报出的问题，重复检查没有增量价值。

3. **失败保持静默**：任何异常（CLI 缺失、超时、解析失败）→ 记录并 `return next()`，**绝不让 hook 抛错**。post-execute 抛错会让整个工具调用失败，代价远大于漏一次检查。

**兜底开关**：插件 config 提供 `principlesCheck: "auto" | "off"`，默认 `auto`。`off` 时不注册 post-execute。这是给重度用户的逃生舱。

**不做异步 offload**：`additionalContexts` 的语义是"附到下一个请求"，天然不是阻塞式的；真正的成本在子进程启动，异步化解决不了，反而引入竞态。用上面三条直接砍掉调用次数更有效。

#### 插件配置键的完整定义（回应 R1 architecture 意见 2）

评审指出"可配置关闭 lacks a defined configuration key, default value, and documentation path"。**成立**，补齐完整规格：

```ts
// plugins/dsh 的 Cordis 插件 config schema
interface XpGatePluginConfig {
  /** 保存即检：auto = 按白名单+去重启用；off = 不注册 post-execute */
  principlesCheck: "auto" | "off"      // 默认 "auto"
  /** 门禁守卫：auto = 按 .sprint-state 存在性启用；off = 不注册 pre-execute */
  delphiGuard: "auto" | "off"          // 默认 "auto"
  /** gate 工具超时（ms） */
  timeoutMs: number                    // 默认 120_000
  /** delphi-review 超时（ms） */
  delphiTimeoutMs: number              // 默认 900_000
}
```

配置写入位置（三者按此优先级合并）：

1. bundle 的 `cordis.patch.yml` 中该插件的 `config:` 段
2. 用户 profile 的 `cordis.patch.yml` 覆盖
3. 环境变量 `XP_GATE_DSH_PRINCIPLES_CHECK=off`（仅供调试，不写入文档主流程）

**文档落点**：`plugins/dsh/README.md` 的 "Configuration" 章节，逐键给出默认值、可选值与影响。

**为什么两个开关都默认 `auto` 而非 `off`**：默认关闭等于功能不存在，用户永远不知道有这能力；默认开启 + 明确可关，才是"默认安全、可退出"。



#### 为什么不用 `tools/execute` 或 `registerGuard`

- `tools/execute` 能拿到完整调用参数，但它在 pre-execute **之后**执行，无法阻止动作
- `registerGuard` 是单调守卫（只增不减），适合不可覆盖的不变量；而 Delphi 守卫需要可被用户放行，用 waterfall 更合适

---

### P1-2　Gate MW 证据产出

**设计**：`delphi-review` 增加可选参数 `writeEvidence?: boolean`（默认 `false`，避免默认产生文件副作用）。

**产出必须逐字段满足** `githooks/lib/validate-code-walkthrough.cjs`：

| 字段 | 层级 | 要求 | 来源 |
|---|---|---|---|
| `commit` | 顶层 | 等于 HEAD | `git rev-parse HEAD` |
| `branch` | 顶层 | 等于当前分支 | `git rev-parse --abbrev-ref HEAD` |
| `timestamp` / `expires` | 顶层 | 规范 UTC ISO-8601，**恰好差 3600000 ms** | 生成时取 now，expires = now + 1h |
| `consensus_ratio` | 顶层 | ∈ [0.90, 1] | 评审得到的实际比例 |
| `verdict` | 顶层 **且** 每个 expert | 必须 `APPROVED` | 评审结论 |
| `result_type` | **每个 expert** | 必须 `delphi_expert_result` | 常量 |
| `channel` | 每个 expert | ∈ {`external`, `local`} | 由网关 base_url 判定 |
| `experts` | 顶层 | 恰好 3 个，`role` ∈ {architecture, technical, feasibility} | 配置席位 |
| `requested_model` | 每个 expert | 等于配置席位（#574） | `loadDelphiConfig().seats[i].model` |
| `resolved_model` | 每个 expert | 网关返回，且互不相同 | 评审响应 |

> **实测踩坑（2026-10-23）**：首次生成的证据被 validator 拒绝 —— `expert architecture must be a successful Delphi expert result.`
> 原因：`result_type` 被误放在顶层，而 `validateExpert()` 是在 **expert 级别**检查 `expert.result_type !== 'delphi_expert_result'`。
> 修正后 validator 通过。**这条必须由 AC-10 的单测钉住**，否则实现时极易重犯——毕竟顶层也"看起来"该有这个字段。

**#574 新增的约束（关键）**：存在 `.delphi-config.json` 时，每个 expert 的 `requested_model` 必须等于该 role 在**活动 profile** 里配置的席位。

这意味着证据生成必须复用 `loadDelphiConfig()` 的结果，**不能**从评审响应里读模型名。这点很重要：网关返回的 `resolved_model`（如 `Qwen3_8-flash-next`）与配置的 `requested_model`（`local-qwen3.8-flash`）**不是同一个值**，实测已确认。

因此：

```
requested_model ← 配置席位（loadDelphiConfig().seats[i].model）
resolved_model  ← 网关响应（评审时记录）
```

两者分别写入，且都要求互不相同（validator 对两者都检查 distinctness）。

**`channel` 判定**：`external` 当 base_url 不是 localhost/内网；`local` 当指向本机。本项目的 `https://lab.iwhalecloud.com/gpt-proxy` 属于 external。

#### 活动 profile 的解析（回应 R2 technical MA-01）

评审提出"多 profile 时可能取错席位"。**逐行核对后，取错的路径不存在，但存在一个更隐蔽的真实缺口。**

先看两处实现的 profile 解析语义对比：

| 场景 | `delphi-config.ts:selectProfile` | `validate-code-walkthrough.cjs:resolveBindingSeats` | 是否一致 |
|---|---|---|---|
| 有 profiles、无有效 `active_profile` | 抛 `DelphiSetupError` | `fail(...)` 拒绝 | ✅ 一致 |
| `active_profile` 指向不存在的 profile | 抛错 | `fail` | ✅ 一致 |
| 无 profiles、顶层有 `experts` | 返回 `cfg` 本身 | `seatsFromExperts(config.experts)` | ✅ 一致 |
| **有 profiles、`active_profile` 有效** | 用该 profile 的 seats | 用同一 profile 的 seats | ✅ 一致 |

**结论：取错 profile 的风险不成立**——两处实现在所有分支上语义对齐，且遇到无解情形都是硬失败而非静默降级。

**但真实缺口在配置文件的查找路径上**：

| 实现 | 查找顺序 |
|---|---|
| `loadDelphiConfig` | `<cwd>/.delphi-config.json` → **ENOENT 时回退** `~/.config/xp-gate/.delphi-config.json` |
| `loadBindingSeats` | **只读** `<projectRoot>/.delphi-config.json`，ENOENT 直接 `return null`（判定为"无配置，不绑定"） |

由此产生一个**会让证据被静默接受、实际却未绑定**的场景：

> 项目目录没有本地 `.delphi-config.json`，但存在全局 `~/.config/xp-gate/.delphi-config.json`。
> 插件用**全局**席位评审并生成证据；validator 读不到**项目级**配置，返回 `null` → **跳过绑定校验**。

这不是"证据被拒"，而是**证据被放行但没有受 #574 保护**——比被拒更糟，因为它让 #574 的修复在这条路径上失效。

**设计决策：证据生成必须显式记录席位来源，并在来源与 validator 可见范围不一致时拒绝产出。**

```ts
interface EvidenceSeatsProvenance {
  configPath: string        // 实际读取的配置文件绝对路径
  scope: "project" | "global"
  profile: string           // 解析出的活动 profile 名
}
```

生成逻辑：

1. `loadDelphiConfig` 的记录实际来源路径与 scope
2. **若 `scope === "global"`**：
   - 说明 validator 将看不到这份配置（它只读项目级）
   - 此时**必须**输出明确警告并**拒绝** `writeEvidence`
   - 理由：产出"看似合规但不受 #574 保护"的证据，等于制造假绿
   - 修复指引：让用户把全局配置复制一份到项目根，或显式传 `cwd`
3. 若 `scope === "project"`：正常产出，并把 `configPath` 写进工具输出（不写进 JSON，validator 不认该字段）

**为什么不改 validator 去读全局配置**：validator 属于技术债线刚收紧的契约（#574），“只读项目级”是**刻意的**——`loadBindingSeats` 的注释写明了 root 必须由调用方显式传入、不得从 cwd 推导。改它会把两条线的契约耦死。插件侧做适配是正确方向。

#### 与 validator 的关系：只对齐 schema，不 import 代码（回应 R1 feasibility 意见 2）

评审（feasibility）认为"要求通过 `githooks/lib/validate-code-walkthrough.cjs` 校验，构成对宿主内部路径的硬依赖，违反封装"。

**这条部分成立，需要澄清设计边界。** 事实核对：

| 事实 | 证据 |
|---|---|
| validator 随 npm 包分发到**用户仓库** | `src/npm-package/hooks/lib/validate-code-walkthrough.cjs` 存在 |
| 运行时位置是用户仓库的 hooks 目录 | `pre-push:1234  MW_VALIDATOR="$HOOK_DIR/lib/..."` |

**这意味着插件在运行时根本无法、也不应该找到这个文件**——它属于用户仓库，不属于插件依赖树，而且不同用户的路径完全不同。

**设计边界（明确）**：

1. **生产代码不 import、不 exec validator**。插件只把 schema 当**文档契约**实现，产出符合该 schema 的 JSON。
2. **单测可以调用 validator**（测试时它就在本仓库里，路径已知）。这是"用契约的参考实现验证我的实现"，不是运行时依赖。
3. **端到端验证由用户的 `git push` 完成**——那是 validator 真正的运行场景。

**为什么单测调 validator 是值得的**：实测证明它抓到了我 schema 写错（`result_type` 层级）。如果只按文档实现，这个错误会一直潜伏到用户 push 时才暴露。**测试期的强耦合换来运行时零耦合，这个取舍是对的。**

#### 部分配置的边界（回应 R1 technical R6）

评审问："部分缺失的项目级配置怎么办？validator 是抛异常还是返回 false？"

读 `loadBindingSeats` 的实际实现，四种情形是明确的：

| 项目级配置状态 | validator 行为 | 插件应做什么 |
|---|---|---|
| 文件不存在（ENOENT） | 返回 `null`，**跳过绑定** | 若实际用了全局配置 → **拒绝产出**（见上） |
| 存在但 JSON 非法 | `fail(...)` 抛错 | **拒绝产出**（配置本身坏了） |
| 存在但缺某 role 席位 | `fail(...)` 抛错 | **拒绝产出** |
| 存在且完整 | 返回 seats，逐 role 比对 | 正常产出 |

所以不存在"部分配置"这种模糊态——validator 要么能解析出完整三席，要么硬失败。插件侧只需在**产出前**做同样的四项预检，把失败提前到工具调用时，而不是等用户 push 才看到。

**关键：validator 是抛异常（`fail` → 非零退出），不是返回 false。** 所以 AC-10 的单测必须用 `execFileSync` 捕获非零退出并检查 stderr，而不是检查返回值。这一点在设计阶段就已实测确认。

---

**闭环价值**：补上这条后，DSH 成为**唯一能自动产出合规 Gate MW 证据的平台**（Claude Code / OpenCode / Qoder 都要手工写 JSON，而手写正是 `channel` 白名单要防的作弊路径）。

---

### P1-3　sprint 子命令暴露

**现状**：`GATE_WHITELIST` 8 项，与 CLI 实际的 gate 别名不对齐。且 `sprint-status` / `phase-transition` / `retro` 等**完全未暴露**，而 `sprint-flow` skill 强依赖它们。

实测 skill 中的引用次数：

| 子命令 | 引用次数 | 当前可调 |
|---|---|---|
| `xp-gate retro` | 10 | ❌ |
| `xp-gate phase-transition` | 6 | ❌ |
| `xp-gate ui-review` | 4 | ❌ |
| `xp-gate sprint-status` | 3 | ❌ |
| `xp-gate sprint-init` | 2 | ❌ |
| `xp-gate sprint-audit` | 1 | ❌ |

**设计**：新增 `sprint` 工具，覆盖上述只读/状态类子命令，用 enum 白名单约束子命令名，参数复用现有 `shellQuote` 转义。

**为什么不做一个万能透传**：万能透传等于把 shell 注入面放大到整个 CLI。枚举子命令 + 结构化参数保持现有安全边界——v1 的 22 个注入防护单测证明这条边界是有效的，不能为便利性退回。

`phase-transition` 需要 `<phase> <status>` 两个位置参数，其中 status 也必须是 enum。

---

### P1-4　`delphi-review` 响应取消

**现状**：三个 `gate-*` 工具都传了 `exec.signal`，`delphi-review` 完全没接。用户在 GUI 点停止后，3 模型 × 最多 5 轮的请求仍会继续（上限 900s）。

**设计**：`runReview()` 与 `chatOnce()` 已有 `AbortSignal` 通路，把 `exec.signal` 透传进去，abort 时抛 `HarnessError(TOOL_ABORTED)` —— 与三个 gate 工具的行为一致。

---

### P1-5　Delphi 凭证走 DSH 凭据 seam（新增项，原评估未覆盖）

**现状**：`loadDelphiConfig(cwd, env = process.env)` 只读 `process.env`。

实测三处证据：

| 检查 | 结果 |
|---|---|
| `process.env.WHALECLOUD_API_KEY`（DSH 子进程） | **未设置** |
| 用户级环境变量 | 已设置（len 114） |
| `~/.dsh/.credentials.yaml` | **已存该 key** |

**结论**：`delphi-review` 目前在 DSH 里**根本跑不起来**——即使 P0 全修完。这条必须在 P1 里做，否则插件"装得上、看得见、用不了"。

**设计**：

```ts
// credentials.ts
export type ApiKeyResolver = (ref: string) => Promise<string | undefined>

export function dshCredentialResolver(ctx: Context): ApiKeyResolver {
  return async (ref) => {
    if (!isCredentialRefName(ref)) return undefined
    const r = await ctx.credentials.resolve(credentialRef(ref))
    return r?.value
  }
}
```

`loadDelphiConfig` 改为接受一个**已解析的 apiKey 覆盖值**，而不是自己去读 env：

```ts
loadDelphiConfig(cwd, { apiKeyOverride?: string, env?: ProcessEnv })
```

#### 凭证优先级 —— 单层，不存在"双兜底"（回应 R1 technical R3）

评审（technical R3）问："runtime probe + process.env fallback 的优先级和双重失败处理未定义"。

**这条意见成立，而且它指出了我原设计的一个真实缺陷。** 逐字核对 `dsh-credentials` 的类型定义后确认：

```
A CredentialRef answers "what is behind this environment-variable name", layered over
the process environment, the provider-managed store, and .env files.
```

**`ctx.credentials.resolve()` 内部已经包含 env → 存储库 → .env 三层的完整兜底。** 所以原设计里"再叠一层 `process.env` 兜底"是**重复兜底**，不仅无用，还会造成优先级歧义（credential 库返回 undefined 时，到底该不该再看 env？看了就等于绕过库的层序）。

**修正后的优先级（单层，无歧义）**：

| 情况 | 解析路径 | 结果 |
|---|---|---|
| `ctx.credentials` 可用 | `ctx.credentials.resolve(ref)` | 库内部已按 env → store → .env 层序解析；`undefined` 即"确实没有" |
| `ctx.credentials` 不可用 | `process.env[ref]` | 仅此一条 |
| 两者都无值 | 不解析出密钥 | `DelphiSetupError` 明确点名缺失的变量名 |

关键点：**当 `ctx.credentials` 可用且返回 `undefined` 时，不再回看 `process.env`**。因为库已经看过 env 了，再看一遍只会让"explicitly unset"变成"隐式有值"，破坏语义。

**为什么不把两处都查一遍"更保险"**：那会让 DSH 会话与 CLI 会话走不同层序，出现"同一份配置在 GUI 里能跑、在终端里不能"的诡异不一致——这正是 P1-5 要消除的单点问题，不能换个形式复现。


**为什么是覆盖而非替换**：`.delphi-config.json` 里写的是 `${WHALECLOUD_API_KEY}` 这种引用形式，`expandEnv` 负责展开。如果 ctx.credentials 能解析出值，就用它替换该引用的展开结果；不能解析时退回 env 展开，保持 CLI 场景（无 DSH）不变。

**降级**：`ctx.credentials` 不可用（如凭据插件未加载）时，退回 `process.env`，并在工具输出里注明取值来源，便于用户排查。

**`inject` 是否加 `"credentials"` —— 已查实，结论是不加，改运行时探测。**

证据（`@deepseek-ai/dsh-base/cordis.patch.yml:117-118`）：

```yaml
- id: credentials
  name: '@deepseek-ai/dsh-credentials-local'
```

该条目**没有 `disabled:` 守卫**（对比同文件 `settings` 条目带 `disabled: !!js "!ctx.get('profileContext')"`），因此在 `dsh-base` 套餐里是无条件启用的。理论上 `inject: ["credentials"]` 在标准安装下不会阻塞加载。

但**仍选择运行时探测**，理由：

1. `inject` 是 cordis 的**硬依赖声明**，声明后就要求该服务在插件的整个生命周期内存在；而本插件对凭据的需求是"有则用，无则退回 env"，本质上不是硬依赖
2. 用户可能自定义 profile、裁掉 `credentials` 插件，或未来 DSH 把它拆成可选包。硬注入会让插件**加载失败**，而不仅仅是不工作——这与设计原则 1.2「优雅降级」直接冲突
3. 运行时探测的代价只是 `ctx.credentials === undefined` 一次判断，收益是插件在任何组合下都能加载

实现形态：

```ts
// index.ts apply()
const apiKeyResolver: ApiKeyResolver = ctx.credentials
  ? dshCredentialResolver(ctx.credentials)
  : envKeyResolver(process.env)
```

`inject = ["tools", "shell", "skills"]` —— 只注入确实必需的三项。`skills` 是 P0-2 的必需依赖（provider 注册目标），无法探测替代，故硬注入。

---

## 4. 验收标准

| AC | 内容 | 验证方式 |
|---|---|---|
| AC-1 | `evaluatePluginCompatibility(manifest)` 在 dsh 0.2.0-rc.2 下返回 `undefined` | 单测直接调该函数 |
| AC-2 | `apply(ctx)` 注册 4 个工具 + 1 个 skill provider + 2 个 hook | fake ctx 断言调用次数与形态 |
| AC-3 | provider `list()` 返回 12 个候选，每个含 `resourceBase.kind === "directory"` | 单测遍历 |
| AC-4 | provider `get()` 返回的 content 非空，且包含 `# ` 标题 | 单测 |
| **AC-4b** | **INV-2 端到端：在真实 DSH 会话中 `ctx.skills.list()` 能列出 12 个 xp-gate skill，且 `ctx.skills.get(name)` 返回非空正文** | **真实运行 DSH，脚本化断言（见 §4.1）** |
| AC-5 | 无 CLI 时命令输出含 `INDETERMINATE` 且不含 `PASS` 字样 | buildCommand + renderGateResult 单测 |
| AC-6 | 有 CLI 但空输出时判为 `INDETERMINATE` | 单测 |
| AC-7 | `pre-execute` 对 `write`/`edit`/`str_replace_editor` 在无 verdict 时返回 `deny` | hook 单测 |
| AC-8 | `pre-execute` 对 `read` 在同样的状态下返回 `allow` | 单测（防误拦只读） |
| AC-9 | 无 `.sprint-state/` 时守卫放行 | 单测 |
| AC-10 | `writeEvidence: true` 产出的 JSON 通过 `validate-code-walkthrough.cjs` 校验 | 单测调 validator 可执行文件 |
| AC-11 | 证据的 `requested_model` 等于配置席位，`resolved_model` 等于网关返回 | 单测（含 #574 seat binding 断言） |
| **AC-11b** | **仅全局配置、无项目级配置时，`writeEvidence` 拒绝产出并给出明确指引** | 单测（见 §3 P1-2 活动 profile 解析） |
| AC-12 | `delphi-review` 在 `exec.signal` abort 时抛 `TOOL_ABORTED` | 单测 |
| AC-13 | `sprint` 工具拒绝不在 enum 内的子命令 | 单测 |
| AC-14 | `loadDelphiConfig` 在传入 `apiKeyOverride` 时优先使用它 | 单测 |
| AC-15 | 全套 `npx vitest run` 通过，无回归 | CI |

### 4.1 为什么 AC-4b 必须存在（回应 R2 feasibility MA-01）

评审指出：AC-3/AC-4 只验证了 provider 的**内部契约**（list 返回 12 个、get 返回非空），**没有验证 DSH 的模型上下文真的收到了这些 skill**。INV-2 因此是未被证明的。

这条意见**完全成立，而且正是本次发布的根本病根**——v1 设计的 AC-6 写的是"经 bundledSkillDir 可发现"，测试通过，但事实上 DSH 从来不会发现它。**一个只测自己实现、不测系统行为的验收标准，恰好会复刻它要修的 bug。**

#### REQ-2 不是"改 DSH 核心"（反驳 R1 feasibility 意见 1）

评审（feasibility）认为"实现 SkillProvider 注册等于修改 DSH 核心或依赖未文档化 API，是平台特性而非插件修复"。**这条不成立，有直接反证。**

DSH **官方**插件 `@deepseek-ai/dsh-skill-office` 的全部注册代码就是：

```js
const inject = ["skills"];
// ...build candidates...
ctx.skills.registerProvider(() => provider);
```

两行，完全在插件层，不改 DSH 任何代码。`SkillProvider` / `SkillCandidate` / `registerProvider` 全部是 `@deepseek-ai/dsh-skill` 的**公开导出类型**（`lib/types/index.d.ts`），`rank: BUNDLED_SKILL_RANK`（600）也是公开常量。

DSH 的设计意图就是让插件自带 skill —— `dsh-skill-office`、`dsh-skill-badge` 两个官方包都是这个形状。本插件做的是**照搬官方范式**，不是扩展平台。

#### AC-4b 的具体测试脚手架（回应 R1 architecture 意见 3）

评审要求"真实 DSH 运行时断言"给出可复现的 fixture 规格。补齐：

```
scripts/verify-dsh-skills.mjs
  1. 建临时 DSH_HOME（os.tmpdir()/dsh-verify-<rand>），确保不污染 ~/.dsh
  2. 写入最小 profile：{ bundles: ["@deepseek-ai/dsh-base"], dependencies: { "@boyingliu01/dsh-plugin-xp-gate": "file:<repo>/plugins/dsh" } }
  3. 动态 import @deepseek-ai/dsh-app-boot，按该 profile 启动 headless 运行时
  4. 断言 ctx.skills.list({}) 中存在 12 个 name ∈ SKILL_NAMES 且 provider === "xp-gate"
  5. 断言每个 ctx.skills.get(name) 返回 content.length > 0
  6. 清理临时 DSH_HOME
```

**关键**：`list()` 必须返回 `provider === "xp-gate"` 的条目，否则可能匹配到 `~/.dsh/skills` 里 junction 来的同名 skill，测试就变成假绿——这正是我们要防的那类错误。所以断言**按 provider 名过滤**，不是按 name 匹配。

**该脚本不进入 `npm test` 默认套件**（它需要真实启动 DSH、耗时且依赖本机环境），而是作为发布前手动/CI 独立 job 执行。理由：单测要快且离线，端到端验证要真。两者不能混。

同理，AC-2 的 fake-ctx 断言只证明"调用了 registerProvider"，不能证明"provider 被注册进了模型的目录"，所以两者都需要，缺一不可。

> 这条 AC 的成本最高（需要真实启动 DSH、隔离 profile），但它是发布门槛。替代方案是发布后由用户发现 skill 不可见——那正是我们已经在修的问题。

---

## 5. 风险与未决问题

| 风险 | 影响 | 应对 |
|---|---|---|
| peerDeps 区间选错导致 DSH 0.3 装不上 | 中 | 上界设 `<0.3.0`；0.3 发布后需重新验证并放宽 |
| skill provider 与 `~/.dsh/skills` 的 junction 冲突 | 低 | rank 600 最低，本地永远覆盖；junction 仅供开发加速 |
| `post-execute` 每次都跑 principles，可能拖慢写文件 | 中 | 可加开关；或只对 `.ts/.js/.py` 触发 |
| Delphi 单轮耗时触及 900s 上限 | 中 | 已有 timeout；P1-4 的 signal 让用户可主动中止 |
| 三个读取方各自实现 `.delphi-config.json` 解析 | 中 | 本设计复用 `loadDelphiConfig`，不新增第四份解析 |
| 运行时探测 `ctx.credentials` 的时序 | 低 | `apply()` 时服务可能尚未就绪 → 改为在工具 `execute()` 内每次解析，天然规避 |

> **已消解**：原"`ctx.credentials` 可选性"风险已查实解决 —— 见 §3 P1-5。结论：不加 `inject`，改运行时探测。

### 未决问题（需评审决策）

1. **`sprint` 工具的子命令范围**：是否需要包含写操作类（`sprint-init`、`phase-transition` 的 completed）？写操作会改 `.sprint-state`，风险高于只读。
2. **`writeEvidence` 的默认值**：默认 `false`（保守）还是 `true`（开箱即闭环）？
3. **hooks 是否需要配置开关**：无条件启用会让所有 DSH 用户都被 Delphi 守卫影响，包括不用 sprint-flow 的人。
4. **peerDeps 上界**：`<0.3.0` 还是更宽？取决于 DSH 对 0.x 的兼容承诺。

---

## 6. 范围分级与分批发布（回应 R1 feasibility 意见 3）

评审（feasibility）指出："scope 对单个 publish-readiness sprint 而言过宽。"**这条成立**，且是三个专家里最需要认真对待的工程判断。

原设计把 8 项（3 P0 + 5 P1）当作一个整体，但实际上它们的**发布必要性不同**：

| 批次 | 内容 | 发布必要性 | 判据 |
|---|---|---|---|
| **Milestone 1（必须）** | P0-1 peerDeps、P0-2 skill provider、P0-3 三态、P1-5 凭证 | **不修就装不上/装上没用** | INV-1/2/3 全部成立 |
| **Milestone 2（应有）** | P1-4 signal、P1-2 证据闭环、P1-1 hooks | 达到与 Claude Code / Qoder 能力对等 | 成熟度 |
| **Milestone 3（可选）** | P1-3 sprint 子命令 | 补齐 CLI 覆盖面 | 便利性 |

**发布策略**：

- Milestone 1 完成 → 可以发 **v0.32.x**（"可安装、可交付、可运行"），这是最小可发布单元
- Milestone 2 完成 → 发 **v0.33.x**（"成熟"）
- Milestone 3 视用户反馈决定是否做

**为什么这样切**：Milestone 1 的 4 项有强依赖关系（凭证修不好，delphi-review 就是坏的；skill provider 不修，65 个文件就是死重），必须一起发。而 P1-1 hooks 会**改变所有 DSH 用户的行为**（写文件被拦），这种改动不该塞进"首次可安装"的版本——用户会把它理解成 bug。

**这直接回答了原设计的一个隐含错误**：把"能发布"和"成熟"混在一个 sprint 里，导致验收标准既过于严格（阻塞首次发布）又过于宽松（hooks 的行为影响没被单独评估）。

---

## 7. 不在本设计范围


| 项 | 理由 |
|---|---|
| P2-1 slash command | 非发布阻断，等 P0/P1 稳定后再排 |
| P2-2 版本检查 | 同上 |
| P2-4 `install-skill` 支持 DSH | 属 CLI 侧改动，与技术债线有重叠，另立 |
| `setup-dsh.ps1` 的通用化 | 有了 P0-2 后该脚本只剩开发加速用途，可降级为文档 |
| DSH client UI (`dsh.client`) | 纯体验项，无用户请求 |
