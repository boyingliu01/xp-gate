# DSH Agent Teams 能否承载 delphi-review？—— 调查结论

> 调查日期: 2026-09-30　环境: DSH 0.2.0-rc.2, profile `web`
> 相关 issue: #443（DSH delphi-review 适配）
> 结论: **能承载「编排」，不能承载「模型差异」**。必须走双通道。

---

## 一、你的直觉是对的：Agent Teams ≈ WorkBuddy 专家团

两者的结构确实同构，这不是巧合：

| 维度 | WorkBuddy 专家团（#437） | DSH Agent Teams |
|------|--------------------------|-----------------|
| 角色结构 | 主理人 + 3 专家 | Team Lead + N teammates（`maxMembers: 8`） |
| 派发工具 | `Agent`（带 `model` 参数） | `spawn_teammate`（**无** model 参数） |
| 共享任务板 | 专家团内协作 | `team_task_create` / `claim` / `complete` + 依赖 + write-scope |
| 成员间通信 | 团队内消息 | `send_message` + 持久 mailbox |
| 对等发现 | — | `list_agents`（含状态/诊断） |

DSH 的 Agent Teams 在**编排能力上比 WorkBuddy 专家团更完整**：有显式的共享任务板（`blocked_by` 依赖、`write_scopes` 冲突告警）、持久化邮箱、成员生命周期状态机（`provisioning`/`active`/`inactive`/`failed`）。这些恰好是 Delphi 编排需要的（匿名化、并行派发、交叉质询、收敛判定）。

**所以：编排层完全可以用 Agent Teams 实现，而且比现在 SKILL.md 里描述的更规范。**

---

## 二、但它不能解决 Delphi 的核心不变量

Delphi 的硬性要求是 **3 个专家使用 3 个 distinct model IDs**。Agent Teams 在这一层是**结构性做不到**的，证据如下（全部来自已安装的 `0.2.0-rc.2` 源码）。

### 证据 1：`spawn_teammate` 工具**没有** model 参数

`dsh-experimental-tool-agent-team/lib/index.js:242-266`：

```js
register(scoped.tools.register(defineTool({
    name: "spawn_teammate",
    parameters: {
        name:        { type: "string", required: true },
        description: { type: "string", required: true },
        prompt:      { type: "string", required: true },
        context:     { type: "string", enum: ["fresh","fork"] }
    },                                    // ← 只有 4 个参数，无 model / provider
```

而 `provider` 是**从配置硬编码**的，不是每次调用传入的（同文件 290 行）：

```js
provider: context === "fork" ? config.forkProvider : config.freshProvider,
```

配置定义（同文件 16-19 行）：
```js
const Config = z.object({
    freshProvider: z.string().default("spawn"),
    forkProvider:  z.string().default("fork")
});
```

**注意：这里的 `provider` 是「子代理运行机制」（spawn/fork），不是 LLM 供应商。** 这一点极易误读 —— 成员视图里的 `provider` 字段值是 `"spawn"`，不是 `"whalecloud"`。

### 证据 2：底层 API `SpawnTeammateRequest` **也没有** model 字段

`dsh-experimental-agent-team/lib/types/types.d.ts:138-146`：

```ts
/** Input for creating one durable teammate. */
export interface SpawnTeammateRequest {
    readonly name: string;
    readonly description: string;
    readonly prompt: ContentBlock[];
    readonly context: 'fresh' | 'fork';
    readonly provider: string;        // ← 子代理机制，非 LLM provider
    readonly signal: AbortSignal;
}                                     // ← 无 model 字段
```

即**即使自己写一个 DSH 插件直接调 `ctx.agentTeams.spawnTeammate()`，也无法指定模型**。

### 证据 3：成员的 model 是**继承**来的，不是指定的

`dsh-experimental-agent-team/lib/types/roster.js:117`（`list()` 中）：

```js
const live = this.ctx.agents.get(member.id);
const model = live?.options.model ?? root.options.model;   // ← 回退到 Lead 的模型
```

`TeamMemberView.model` 只是**如实报告**了 children 实际解析到的模型（`types.d.ts:50`）。它出现在**输出** schema（`SPAWN_VALUE_SCHEMA`，`tool-agent-team/lib/index.js:64`），不在**输入** schema。

**所以：`list_agents` 会显示每个成员的 model，但你没有手段让它们不同 —— 除非上游把 `model` 加进 `SpawnTeammateRequest`。**

### 证据 4：挂载 Agent Teams 会**禁用** `tool-subagent`

`dsh-experimental-agent-team-profile/cordis.patch.yml:4-14`：

```yaml
- id: tool-subagent-control
  disabled: true
- id: tool-subagent-list-agents
  disabled: true
- id: tool-subagent
  disabled: true        # ← 正是支持 model 参数的那个工具
- id: tool-subagent-fork
  disabled: true
```

而 `tool-subagent` 恰恰是**唯一**支持 `provider`/`model` 参数的委派工具（通过 host 设置 `subagentModelSelection` 启用）。

**这是关键：Agent Teams 不是「另一个能做同样事的工具」，而是把能做模型选择的工具关掉、换成做不到的。** 二者互斥。

### 证据 5：当前 profile 确实已挂载 Agent Teams

`C:\Users\think\.dsh\profiles\web\package.json`：
```json
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@deepseek-ai/dsh-experimental-agent-team-profile"   // ← 已挂载
] } }
```

这解释了为什么本会话的 `spawn_teammate` / `team_task_*` 工具是活的，以及为什么我**没有** `subagent` 工具的 model 参数。

---

## 三、结论与方案

### 结论

| 能力 | Agent Teams | 说明 |
|------|-------------|------|
| 并行派发 N 个专家 | ✅ | 比 SKILL.md 现状更规范 |
| 匿名化（去角色标签） | ✅ | 靠 prompt 设计 + 共享任务板 |
| 交叉质询 / 多轮收敛 | ✅ | mailbox + task board 天然支持 |
| 持久化评审进度 | ✅ | durable journal + projection |
| **每个专家用不同模型** | ❌ | **结构性缺失（证据 1-4）** |
| 读取执行层模型证据 | ⚠️ | `list_agents` 报告 model，但可能是继承值 |

**编排（orchestration）可以搬进 Agent Teams；模型差异（model diversity）不能。**

### 采用方案：双通道（native 优先 + external 兜底）

与你选的方案一致，也与 #414（Qoder）/ #437（WorkBuddy）既有先例一致。

```
delphi-review 启动
  │
  ├─ 探测：能否拿到 ≥3 个互异的可执行模型？
  │    ├─ 通道 A (native)：tool-subagent 暴露 provider/model 参数
  │    │                    + host 设置 subagentModelSelection.enabled=true
  │    │                    + allowedModels 有 ≥3 条互异 route
  │    │   → 用 subagent 工具，每次调用显式传 provider/model
  │    │   ⚠️ 需与 Agent Teams 二选一（互斥，见证据 4）
  │    │
  │    └─ 通道 B (external)：scripts/delphi-external-review.cjs
  │         → OpenAI 兼容 HTTP，平台中立，完全不依赖 DSH 委派机制
  │         → 需 DASHSCOPE_API_KEY / ZHIPU_API_KEY / DEEPSEEK_API_KEY
  │
  └─ 两通道皆不可用 → BLOCK（保持不变量，不降级为单专家）
```

**Agent Teams 的定位**：作为**编排层**（匿名化、任务板、交叉质询、收敛），与模型来源（A/B）正交。也就是说 —— 即使走通道 B（external HTTP），Agent Teams 仍可用来管理评审流程与任务依赖。

### 与 #437 的验证标准对齐

#437 遇到「WorkBuddy 无 per-request 路由日志」，采用的过渡标准是「参数级校准 + `requested_model` 如实记录 + 报告注明执行层验证待平台支持」。

DSH 的处境**更好也需留意**：
- 通道 A：`list_agents` 会报告 model（`TeamMemberView.model`），但按证据 3 它可能是**继承值**而非真实路由 —— 不能单独作为 distinct 的证据。
- 需新增：`resolved_model` 与 `requested_model` 分别记录 + 证据强度标注（与 #423 直接相关）。
- 通道 B：`delphi-external-review.cjs` 有真实 HTTP 响应，provenance 最强。

### 建议的探测实现（REQ-5 的具体化）

```
canUseNativeChannel() :=
      subagent 工具 schema 含 "model" 参数          # 证据：tool-subagent 启用后新增
   && allowedModels.length >= 3
   && uniq(allowedModels.map(m => `${m.provider}/${m.model}`)).length >= 3
```

三者需**同时**成立。任一不成立即走 external。

---

## 四、给上游的建议（可选）

DSH 若想让 Agent Teams 支持异构团队，只需两处改动：

1. `SpawnTeammateRequest` 增加可选 `model?: string`（`types.d.ts:139`）
2. `spawn_teammate` 工具参数增加 `model`（`tool-agent-team/lib/index.js:245`），并在 `provider` 硬编码处一并传递

这样 Agent Teams 就能完全取代 `tool-subagent` 的模型选择能力，Delphi 的 native 通道会真正可用。可作为 DSH 的 feature request。

---

## 附：本结论用到的全部证据位置

| # | 文件 | 行 | 说明 |
|---|------|-----|------|
| 1 | `@deepseek-ai/dsh-experimental-tool-agent-team/lib/index.js` | 242-266 | `spawn_teammate` 参数仅 4 个 |
| 2 | 同上 | 290 | provider 来自 config，非 per-call |
| 3 | 同上 | 16-19 | `freshProvider: "spawn"` / `forkProvider: "fork"` |
| 4 | 同上 | 64 | `model` 在**输出** schema |
| 5 | `@deepseek-ai/dsh-experimental-agent-team/lib/types/types.d.ts` | 138-146 | `SpawnTeammateRequest` 无 model |
| 6 | 同上 | 42-52 | `TeamMemberView` 有 `provider?`/`model?`（输出） |
| 7 | `@deepseek-ai/dsh-experimental-agent-team/lib/types/roster.js` | 117 | `live?.options.model ?? root.options.model` |
| 8 | `@deepseek-ai/dsh-experimental-agent-team-profile/cordis.patch.yml` | 4-14 | 挂载 Teams 即禁用 `tool-subagent` |
| 9 | `C:\Users\think\.dsh\profiles\web\package.json` | — | 该 profile 层已挂载 |
