# DSH 原生插件（dsh-plugin）设计文档 v2

> 关联 Issue: #393　分支: dsh-plugin　Sprint: sprint-20260823-28　日期: 2026-08-23
> v2 = 根据 Round 1 Delphi 评审（3 专家 × REQUEST_CHANGES）逐条修订

---

## 0. 评审修订记录（Round 1 → v2）

Round 1 三位专家（architecture / technical / feasibility）均判 REQUEST_CHANGES，核心结论：**薄桥方向正确、DSH 契约描述准确，但存在加载期/运行时/安全缺口**。v2 修订：

| # | 缺口 | 修订 |
|---|------|------|
| R1 | 无 build/prepack/`files` → 发布包缺 `lib/index.js` 加载即崩 | §3.1 强制 `tsc` 编译 + `files` 白名单 + `prepack` + `publishConfig.access: public` |
| R2 | shell 注入（`"<path>"` 双引号插值，模型可控输入进 bash -c） | §3.3 `buildCommand()` 纯函数 + POSIX 单引号 `shq()` 转义 + `gates` enum 白名单 |
| R3 | 「返回 ABORTED」表述错 → 正确是 `throw HarnessError(…, TOOL_ABORTED)` | §3.4 取消语义更正 + 补 `@deepseek-ai/dsh-llm` 依赖 |
| R4 | 超时 ≠ 取消被混谈 | §3.4 拆分：timeout→`timedOut`（render 标记，不抛）；cancel→`aborted`（抛） |
| R5 | gate-arch `config` 的 schema `default` 是注释性 annotation，不注入 args | §3.4 execute 内 `args.config ?? "architecture.yaml"` 兜底 |
| R6 | 依赖清单不全（cordis/dsh-shell/dsh-llm 类型） | §3.5 完整 dependencies |
| R7 | CLI 随包 fallback 过重、与「零运行时依赖」冲突、且 pluginDir 未定义 | §3.3 改为【全局 xp-gate → 优雅降级】；**砍掉落地的 vendored CLI** |
| R8 | output.render 未指定；非零退出是 resolve 非 reject | §3.4 render 拼 stdout+stderr+`[exit code:N]`，处理 truncated/spillPath |
| R9 | 缺 workspace/相对路径解析 | §3.4 由 `exec.agent?.session.header.cwd` 取 cwd，相对 path resolve + 传 `workdir` |
| R10 | 技能用 customSkillDirs/cp 靠手工、错位 | §3.6 走平台原生 `bundledSkillDir`（`$DSH_BUNDLED_SKILL_DIR`），随包自动发现 |
| R11 | 沙箱契约（sandboxPolicy/dshEnv/denial）未落实 | §3.7 显式声明 shell 透传沙箱策略 + denial 标记处理 + 状态目录风险 |
| R12 | 分发/版本接线（sync-package-content.js / sync-version.cjs / build-plugin）未含第 6 个插件 | §3.9 列出接线清单 |

---

## 1. 需求摘要

将 XP-Gate 确定性质量门禁移植为 **DeepSeek Harness (DSH) 原生插件（bundle）**，使 DSH agent 通过工具调用 + 技能加载调用 xp-gate 门禁。目标环境 `@deepseek-ai/dsh@0.1.1-rc.2`。

范围（P0–P3）：
- **P0 冒烟**：最小 bundle（package.json + cordis.patch.yml + src/index.ts + tsc 产物），`apply(ctx)` 注册 `gate-check`，`dsh plugin add` 可加载进工具目录。
- **P1 三工具**：补 `gate-principles`/`gate-arch`，`xp-gate` CLI fallback。
- **P2 技能**：12 个 SKILL.md 随包走 `bundledSkillDir` 原生发现。
- **P3 收尾**：超时/取消、`.xp-gate/` 状态目录与沙箱调和、单测、npm 发布。

非目标：opencode 私有的 `session-reload-model`/`session-rename`；chat.message auto-update 钩子（二期）。

---

## 2. 候选方案与 trade-offs（同 v1，结论不变）

| 方案 | 说明 | 结论 |
|------|------|------|
| A. 薄桥注册三工具 | `ctx.tools.register(defineTool(...))`，execute 内 `ctx.shell.run` 调 xp-gate | ✅ 采纳（核心） |
| B. 技能-only | 只挂 SKILL.md | 部分采纳（作为 P2 叠加） |
| C. 独立 MCP server | 额外进程/生命周期 | ❌ 过度设计 |

---

## 3. 推荐方案（v2 详细设计）

### 3.1 包结构（强制编译 + 发布白名单）

```
plugins/dsh/
├── package.json          # name: @boyingliu01/dsh-plugin-xp-gate
│                         # type: module, main: lib/index.js, exports: {".": "./lib/index.js"}
│                         # "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
│                         # publishConfig: { access: "public", registry: "https://registry.npmjs.org" }
│                         # files: [lib/, cordis.patch.yml, skills/, README.md]
│                         # scripts: { build: "tsc", prepack: "npm run build && node ../scripts/copy-skills-into-plugin.mjs dsh" }
├── cordis.patch.yml      # - insert: - id: tool-xp-gate  name: '@boyingliu01/dsh-plugin-xp-gate'
├── src/index.ts          # export const name/inject + apply(ctx)（TS 源，见 §3.2）
├── src/index.test.ts     # 单测（TDD，见 §3.8）
├── lib/index.js          # tsc 编译产物（Cordis Loader 用原生 import()，只能加载编译后 JS）
├── tsconfig.json         # ESNext + moduleResolution bundler + noEmit:false + outDir:lib（不再 noEmit）
└── skills/…              # 12 个 SKILL.md（prepack 从仓库 skills/ 复制）
```

**关键修订（R1）**：`main` 必须指向 `tsc` 编译产物 `lib/index.js`，不能像 opencode 插件那样 `main: index.ts`（DSH 无 opencode 式转译）。`tsconfig` 用 `noEmit:false + outDir:lib`。

### 3.2 插件模块契约（已逐行反向验证）

```ts
// export 形态（对齐 dsh-tool-bash）
export const name = "tool-xp-gate"
export const inject = ["tools", "shell"] as const   // 无需 shellEnv（不传 dshEnv）

export function apply(ctx, config = {}) {
  ctx.tools.register(defineTool({
    name: "gate-check",
    description: "...",
    parameters: { path: { type: "string", required: true, description }, gates: { type: "array", items: { type: "string", enum: [...] }, description } },
    output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
    async execute(args, exec) { /* §3.4 */ },
    timeoutMs: 120_000,
  }))
  // gate-principles / gate-arch 同构（§3.4）
}
```

`defineTool`（`@deepseek-ai/dsh-tools`）字段：`name/description/parameters(output 用 value-schema DSL) /execute(args, exec) /timeoutMs? /isConcurrencySafe? /finalizeContent? /presentCall? /presentResult?`；`output.schema` 为必填（缺失即加载期抛错），`render(args, value) → ContentBlock[]`。

### 3.3 命令构造与 CLI fallback（安全修订 R2/R7）

**fallback 策略（R7 简化）**：不再「随包打进 CLI」（太重、撞零依赖、pluginDir 未定义）。改为：

1. 全局 `xp-gate` 命中 → `xp-gate <subcommand> ...`
2. 未命中 → 返回清晰可操作的降级消息（遵循项目「工具缺失 → SKIP 而非 BLOCK」约定），不抛错、不崩

**命令构造纯函数（R2 防注入）**：`buildCommand({ global, subcommand, target, gates })` —— 用 POSIX 单引号 `shq()` 转义所有模型可控输入（path/config/gates），`gates` 参数做 enum 白名单（固定 gate id 集合，非法值在校验层拒绝）。一次 `if command -v xp-gate >/dev/null 2>&1; then ...; fi` 生成。

### 3.4 三工具 execute 契约（R3/R4/R5/R8/R9）

```
execute(args, exec):
  cwd = exec.agent?.session?.header?.cwd ?? process.cwd()          # R9 workspace
  target = args.path 起点("/") ? args.path : resolve(cwd, args.path)
  config = args.config ?? "architecture.yaml"                      # R5 兜底
  request = { command: buildCommand(...), workdir: cwd, timeoutMs, signal: exec.signal }
  result = await ctx.shell.run(ctx.shell.resolve(request))          # 非零/超时/abort 均 resolve，仅基建故障 reject
  if result.aborted: throw new HarnessError("tool call aborted", TOOL_ABORTED)  # R3 取消语义
  if result.timedOut: /* 超时不抛，交给 render 标记 */                             # R4
  return text = renderGateResult(result)   # R8: stdout + 分区 stderr + [exit code:N] + truncated/spillPath 提示
```

- **取消**：`result.aborted` → `throw HarnessError("tool call aborted", TOOL_ABORTED)`（`error.name="AbortError"`）。
- **超时**：`result.timedOut` → 输出内标记 `[timed out after Nms]`，不抛错。
- **非零退出**：resolve 非 reject → render 拼 `stdout + stderr + [exit code:N]`。
- **gate-arch config**：schema `default` 是注释性 annotation，must 在 execute 兜底。

### 3.5 依赖（R6 完整清单）

```
dependencies:
  @deepseek-ai/dsh-tools    # defineTool / TOOL_ABORTED
  @deepseek-ai/dsh-llm      # HarnessError
  @deepseek-ai/schemastery  # Config schema（可选）
devDependencies:
  @deepseek-ai/cordis       # Context / Service 类型（module augmentation，strict TS + noImplicitAny 需要）
  @deepseek-ai/dsh-shell    # ShellRunResult 类型
  typescript, vitest
```

版本锁定 `0.1.1-rc.2`（DSH 目标版本）。

### 3.6 技能（R10 平台原生发现）

12 个 SKILL.md 随包进 `skills/`，通过 **`bundledSkillDir` / `$DSH_BUNDLED_SKILL_DIR`**（dsh-skill-filesystem 的 source=bundled 根）被 DSH 原生发现，而非靠用户手工 `customSkillDirs` / `cp`。`dsh plugin add` 后技能即可被 `skill` 工具加载，AC-5 不依赖手工操作。

### 3.7 沙箱与状态目录（R11）

- 工具在 `ctx.shell.run` 下执行，**透传 DSH 沙箱策略**；`result.sandbox?.denied` 时 render 出 denial 标记（同 dsh-tool-bash），不崩。
- 门禁会读 `~/.config/xp-gate`、写 `~/.xp-gate/`、spawn 外部工具（ast-grep/semgrep/…），这些落在 agent workspaceRoot 之外时可能触发沙箱 denial——**工具级降级**：denial → 输出 SKIP 语义提示，不 BLOCK。
- P3 明确调和 `.xp-gate/` 目录：作为文档化的已知限制，README 说明需 workspace-write scope。

### 3.8 测试策略（TDD，R-technical S1/S2）

- 单测**不 mock 模块系统**：`apply(fakeCtx)` 注入 fake ctx（`tools.register` 用捕获器、`shell` 用返回 canned result 的 stub），对捕获的 `tool.execute(args, {signal})` 断言。
- `buildCommand()` 纯函数直接做 RED 测试（含 shq 转义、gates 白名单、fallback 降级字符串）。
- AC-007 断言 `throw` 的 `code === "ABORTED"`。

### 3.9 分发/版本接线（R12）

| 文件 | 改动 |
|------|------|
| `src/npm-package/scripts/sync-package-content.js` | `PLUGINS` 增加 `'dsh'` |
| `scripts/build-plugin.mjs` | platform 支持 `dsh` |
| `scripts/sync-version.cjs` | 版本源文件计数/列表纳入 `plugins/dsh/package.json` |
| `scripts/test-plugins.mjs` | 26 项前的 manifest 清单纳入 dsh 包 |

---

## 4. 成功标准（可验证，对齐 specification AC）

| 编号 | 标准 | 验证 |
|------|------|------|
| AC-1 | 包含 `dsh.bundle.patch` + `lib/index.js`（tsc 产物）+ files 白名单；`dsh plugin add` 后进层栈 | 单测/pack 检查 |
| AC-2 | `apply(ctx)` 注册 gate-check，params 含 path(required)/gates(enum 白名单) | fake ctx 断言 |
| AC-3 | gate-principles 已注册，execute 调 `xp-gate principles <path>`（shq 转义） | buildCommand 单测 |
| AC-4 | gate-arch 已注册，config `?? "architecture.yaml"` 兜底 | 单测 |
| AC-5 | 无全局 xp-gate 时返回优雅降级消息（不抛、不崩） | buildCommand/execute 单测 |
| AC-6 | 12 个 SKILL.md frontmatter 满足 DSH 契约，经 bundledSkillDir 可发现 | 遍历解析单测 |
| AC-7 | `result.aborted` → `throw HarnessError(…, TOOL_ABORTED)` | 单测（断言 code） |
| AC-8 | 全量 `npm test` + `npm run lint` + `npx tsc --noEmit`（插件目录 tsc）通过、无回归 | CI 命令 |

---

## 5. 关键 API 证据源（已核实）

- `@deepseek-ai/dsh-tool-bash/lib/index.js` — apply/inject/defineTool/ctx.shell.resolve+run/sandboxPolicy/TOOL_ABORTED 真实写法
- `@deepseek-ai/dsh-tools/lib/types/{schema,index,testing}.d.ts` — defineTool/ValueSchemaSpec/ParameterSchemaSpec/defineContentToolFixture
- `@deepseek-ai/dsh-base/cordis.patch.yml` + `dsh/lib/plugin-*.js` — bundle insert 行格式 + `dsh?.bundle?.patch` reconcile
- `@deepseek-ai/dsh-skill-filesystem` — bundledSkillDir / customSkillDirs / 发现根
- 待移植参考：`plugins/opencode/index.ts`