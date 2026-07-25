# XP-Gate v0.17.1/v0.18.0 整合设计：Skill 依赖最小化 + 质量闭环强化

**日期**: 2026-07-24
**状态**: APPROVED-R2（Delphi Round 2 后批准，3/3 专家一致 APPROVED，详见 §16）
**目标版本**: v0.17.1（P0 patch：#370 + #367）→ v0.18.0（主线 A + #368 + #369）
**关联 Issues**: #367、#368、#369、#370
**关联需求**: 脱离 gstack/superpowers 依赖，仅保留 Matt Pocock skill 生态，最小化、轻量化

---

## 1. 背景与目标

本次整合两条主线：**(A) 外部 skill 依赖最小化** 与 **(B) 质量闭环修复（4 个 open issues）**。两条主线高度耦合——#367/#368 的根因都在 sprint-flow 编排层，正是主线 A 要重写的部分；#369 与新增的 `xp-gate retro` CLI 天然合并；#370 是同版本内的 P0 质量修复。

**版本拆分（Round 1 修订）**：P0 修复不等重构——#370 与 #367 拆为 **v0.17.1 patch** 先行交付；v0.18.0 承担重构主线。

### 1.1 主线 A：外部依赖问题

XP-Gate 的确定性门禁层（githooks/，Gate 0–9 + M/M2/M3）**本身零外部 skill 依赖**（已验证：githooks/ 目录无 gstack/superpowers 引用）。依赖全部集中在 **sprint-flow 编排层**：

| 依赖来源 | 数量 | 性质 |
|----------|------|------|
| gstack skills | 16 个 | 其中 6 个在 HARD-GATE 关键链路上 |
| superpowers skills | 5 个 | 其中 2 个在 HARD-GATE 关键链路上 |

另有**正典 skill 内的悬空引用**（Round 1 新发现，已实证）：test-specification-alignment SKILL.md 引用 gstack-ship 与 /freeze、to-issues SKILL.md 引用 dispatching-parallel-agents——编排层之外的残留依赖，一并清扫。

导致：环境耦合（干净 Qoder 环境断链）、安装臃肿（20+ 第三方 skill）、版本漂移不可控。

### 1.2 主线 B：4 个 Open Issues（质量闭环断裂）

| Issue | 级别 | 问题 | 根因位置 |
|-------|------|------|----------|
| #370 | P0 bug | audit.jsonl 的 duration_ms 出现 ~56 年异常值（实证 68 条，见 §9），审计数据不可信 | githooks/pre-commit 时间戳获取（Windows Git Bash `date +%s%3N` 输出污染） |
| #367 | P0 bug | test-specification-alignment 设计完善但**从未被实际调用**（467 条 audit 零痕迹） | sprint-flow Phase 4 仅有文本指令，无程序化 HARD-GATE，LLM 可忽略而不被阻断 |
| #368 | P1 enhancement | Delphi 评审缺失**需求层面**评审（原始意图：需求一次评审 + 设计一次评审，第一次被完全丢弃）；autoplan 与 brainstorming 功能重叠 | sprint-flow Phase 2 编排 + Delphi 评审模式配置 |
| #369 | P1 enhancement | Sprint 完成后无返工追踪——门禁全过、CLOSE completed，但之后 10+ fix commits | sprint-flow Phase 6 CLOSE 无 metrics |

**#367 与 #369 互为因果**：test-spec-alignment 缺失 → 场景驱动测试缺位 → 门禁全过但仍返工 → 又无返工指标暴露问题。本次整合一并闭环。

### 1.3 设计目标

| 目标 | 度量 |
|------|------|
| **零必需外部 skill** | 所有 HARD-GATE 链路只依赖 xp-gate 原生能力 + 内置 Matt Pocock skill |
| **Matt Pocock skill 最小内置** | 仅内置 4 个最小必需集（§6），其余 `xp-gate install-skill` 按需 |
| **优雅降级** | gstack/superpowers 与 browser-use MCP 均为"检测到则增强，缺失 SKIP"的可选槽位 |
| **能力不回退** | 6 阶段流水线交付效果不变 |
| **质量闭环修复** | 4 个 open issues 全部关闭，验收标准逐项达成 |

### 1.4 核心原则

> **HARD-GATE 绝不依赖外部 skill，且 HARD-GATE 必须程序化强制。** 文本指令不等于门禁——凡是"必须执行"的环节，都要有文件证据 + CLI 校验（#367 的教训）。证据必须**防陈旧绑定**（关联 HEAD commit / specification.yaml 哈希），防止旧证据复用。

---

## 2. 现状依赖审计（主线 A）

### 2.1 gstack 依赖（16 个）

| Skill | 使用位置 | 关键度 | 功能 |
|-------|----------|--------|------|
| `autoplan` | Phase 2 DESIGN | **关键链** | CEO→Design→Eng 自动评审流水线 + taste_decisions |
| `office-hours` | Phase 2 DESIGN | 可选 | YC 六问产品方向验证 |
| `design-shotgun` | Phase 2 DESIGN | 可选（web/mobile） | 多版 UI 设计变体 |
| `freeze`/`unfreeze` | Phase 3 BUILD | 标准步骤 | 盲评隔离 |
| `browse` | Phase 4 VERIFY | **关键链** | 浏览器自动化测试 |
| `qa` | Phase 4 VERIFY | 可选（web） | 三层 QA 系统化测试 |
| `design-review` | Phase 4 VERIFY | 可选（web） | UI 视觉审计 |
| `benchmark` | Phase 4 VERIFY | 可选（web） | Core Web Vitals 基线 |
| `learn` | Phase 4/6 + ralph-loop | 标准步骤 | 模式记录 |
| `retro` | Phase 4/6 | 标准步骤 | 工程回顾 |
| `finishing-a-development-branch`¹ | Phase 5 SHIP | **关键链** | 分支完成 4 选项菜单 |
| `ship` | Phase 5 SHIP | **关键链** | 测试+评审+VERSION+PR |
| `land-and-deploy` | Phase 5 SHIP | **关键链** | 合并+CI+canary |
| `cso` | middleware 安全审计 | 可选 | 基础设施安全审计 |
| `context-save`/`context-restore` | hooks 声明 | 可选 | 会话上下文保存 |
| `careful`/`guard` | hooks 声明 | 可选 | 破坏性命令护栏 |

¹ 实际属 superpowers 生态，按引用位置归类。

### 2.2 superpowers 依赖（5 个）

| Skill | 使用位置 | 关键度 | 功能 |
|-------|----------|--------|------|
| `brainstorming` | Phase 2 DESIGN | **HARD-GATE** | 结构化需求探索 + 设计文档 + 审批门 |
| `systematic-debugging` | Phase 4 VERIFY | 可选 | 根因调试 |
| `dispatching-parallel-agents` | to-issues SKILL.md:31 | 可选 | 无依赖切片并行派发 |
| `writing-plans` | brainstorming 传递调用 | 传递依赖 | 实现计划编写 |
| `using-git-worktrees` | Phase 1 PREP（隐式） | 已原生实现 | worktree 隔离（phase-1 已是原生 git 命令） |

### 2.3 正典 skill 内悬空引用（Round 1 新增）

| 位置 | 悬空引用 | 处置 |
|------|----------|------|
| test-specification-alignment/SKILL.md（约 :56） | gstack-ship | 改为原生 phase-5 步骤引用 |
| test-specification-alignment step 4 | /freeze | 改为"只读 subagent 约定"引用（§8.3） |
| to-issues/SKILL.md:31 | dispatching-parallel-agents | 改为原生 Task 并行派发表述 |

---

## 3. 替代映射总表（主线 A）

**图例**：🔵 原生实现｜🟢 Matt Pocock skill（内置适配）｜⚪ 可选槽位（检测即用，缺失 SKIP）｜❌ 移除

| 原依赖 | 替代方案 | 类型 |
|--------|----------|------|
| `brainstorming` | 🟢 **grill-with-docs**（访谈+CONTEXT.md+ADR）+ 🔵 原生"设计文档生成+APPROVAL 门" | 替代 |
| `autoplan` | 🟢 **batch-grill-me**（前置批量决策）+ delphi-review R1/R2 双点评审（原生）— 逐条等价见 §5.5；**与 Issue #368 建议方向一致** | 替代 |
| `office-hours` | 🟢 grilling 访谈覆盖方向验证 | 移除 |
| `design-shotgun` | ⚪ 可选槽位 | 降级 |
| `to-issues`（原生） | **保留原生，不替代**（Round 1 实证：to-issues 已有 blocked_by/dependency_graph/DAG 循环检测/拓扑排序，to-tickets 无替代收益） | 保留 |
| `freeze`/`unfreeze` | 🔵 只读 subagent 盲评约定（§8.3）——**降级为证据型标准步骤，非 HARD-GATE**；worktree 本身已是隔离边界 | 替代 |
| `browse` | ⚪ **Layer 4 可选链**：gstack browse（如已装）> browser-use MCP（如平台支持）> SKIP 并记录 | 降级 |
| `qa` | 🔵 原生 phase-4 web 检查清单 + ⚪ 可选 gstack qa | 降级 |
| `design-review` | 🔵 **xp-gate ui-review**（已存在）+ admin-template-guidelines（已内置） | 替代 |
| `benchmark` | ⚪ 可选槽位，默认 SKIP | 降级 |
| `learn` | 🔵 原生 `.sprint-history/learnings.md` 写入 | 替代 |
| `retro` | 🔵 **新增 `xp-gate retro` CLI**（含 #369 返工率区块） | 替代 |
| `systematic-debugging` | ⚪ 可选槽位（gstack investigate / 用户自选调试 skill），phase-4 仅保留"根因分析后方可修复"的文本纪律 | 降级 |
| `finishing-a-development-branch` | 🔵 phase-5 原生 4 选项菜单（逻辑早已在 phase-5-ship.md） | 替代 |
| `ship` | 🔵 phase-5 原生步骤（VERSION-GATE 已原生 + gh pr create） | 替代 |
| `land-and-deploy` | 🔵 phase-5 Part B 原生步骤（merge → wait CI → canary，去掉 skill() 调用壳） | 替代 |
| `cso` | 🔵 `xp-gate check --all`（Gate 7/8/9 已覆盖安全审计） | 替代 |
| `context-save`/`context-restore` | 🔵 sprint-state.json 原生持久化 + `--resume-from` | 替代 |
| `careful`/`guard` | 🔵 frontmatter `tools_denied` + Security Notes（已存在） | 替代 |
| `dispatching-parallel-agents` | 🔵 to-issues 原生 dependency_graph 判定 + 原生 Task 并行派发（同步修订 to-issues SKILL.md:31 悬空引用） | 替代 |
| `writing-plans` | 🔵 设计文档即计划（grill-with-docs 输出 + specification.yaml 覆盖） | 移除 |

**结果**：21 个外部依赖 → 0 个必需外部依赖（11 个原生吸收、4 个 Matt Pocock 替代、6 个降可选槽位/移除）。

**Note（Round 1 修订）**：`systematic-debugging` 原拟用 Matt Pocock `diagnosing-bugs` 替代，因内置集收缩为 4 个（§6），改为可选槽位；`handoff` 同理移出内置集，context-save 替代方案纯原生化。

---

## 4. 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: 可选增强槽（运行时发现，缺失 SKIP，永不 BLOCK）        │
│   gstack browse/qa/design-shotgun/benchmark/investigate、     │
│   browser-use MCP、superpowers systematic-debugging           │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: Sprint Flow 编排器（skills/sprint-flow/）            │
│   6 阶段 phase 逻辑、程序化 HARD-GATE、状态机 — 全部自包含     │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: 正典 Skills（skills/，随 npm 分发）                  │
│   现有 8 个 + Matt Pocock 内置 4 个（§6 最小集）              │
├─────────────────────────────────────────────────────────────┤
│ Layer 1: XP-Gate CLI（src/npm-package/，零安装分发）          │
│   现有 24 命令 + retro + sprint-status --rework-check         │
│   + phase-transition 证据校验增强（v0.17.1 先行）             │
├─────────────────────────────────────────────────────────────┤
│ Layer 0: 确定性门禁（githooks/）                               │
│   Gate 0–9 + M/M2/M3 + Delphi walkthrough 校验                │
│   + #370 时间戳修复（v0.17.1 先行）                           │
└─────────────────────────────────────────────────────────────┘
```

**依赖规则**：
- 上层可依赖下层，同层可依赖同层，**禁止依赖 Layer 4**
- browser-use MCP 是 Qoder 平台能力而非 xp-gate 原生能力，**归入 Layer 4**（Round 1 修订）
- Layer 4 仅在 `xp-gate doctor` 报告可用性，phase 文档统一表述：`OPTIONAL: 若检测到 X 则…否则 SKIP`
- 所有 HARD-GATE 采用"**文件证据 + CLI 校验 + 防陈旧绑定**"程序化模式（`.code-walkthrough-result.json` 模式泛化）

---

## 5. 核心变更：Phase 2 DESIGN 新链路（整合 #368）

### 5.1 Issue #368 分析结论

Issue #368 独立提出"**用 grill-me 替代 autoplan**"——与本设计主线 A 的替代方案方向一致，互为验证。其新增的诉求是**恢复需求层面评审**（原始意图：需求评审一次 + 设计评审一次，第一次被丢弃）。

### 5.2 旧链 vs 新链

```
旧链（外部依赖 3 个，需求评审缺失）:
  brainstorming(superpowers) → autoplan(gstack) → delphi-review(仅设计维度) → to-issues
       ↓ HARD-GATE                ↓ 与brainstorming重叠

新链（零外部依赖，双点评审）:
  grill-with-docs → R1 需求评审(轻量) → 原生设计文档+APPROVAL门 → batch-grill-me → R2 delphi-review(设计维度) → to-issues
       ↓                ↓ #368                 ↓ HARD-GATE              ↓              ↓ HARD-GATE
   CONTEXT.md+ADR   需求完整性/AC覆盖     用户审批设计文档      批量前置决策     ≥90% 共识
```

### 5.3 新链步骤详设

**Part A: THINK（需求探索 + 需求评审）**

1. **CONTEXT.md 预检**（保留 Issue #322 逻辑）：存在则跳过 grill 访谈——**但 R1 需求评审仍执行**（Round 1 修订：CONTEXT.md 可能陈旧，快速路径同样需要需求评审），评审对象为 CONTEXT.md + 本次需求陈述
2. 调用 `grill-with-docs`：逐个追问决策树（每题附推荐答案）；事实自行探查，决策留给用户；同步维护 `CONTEXT.md` + `docs/adr/ADR-NNNN-*.md`
3. **R1 需求评审（#368 恢复的第一点评审）**：grill 访谈达成共享理解后、设计文档生成前，调用 **`delphi-review --mode requirements`**（轻量：2 专家、1 轮）：
   - **复用现有 3 专家**（architecture/feasibility/technical），`--mode requirements` 仅切换评审焦点提示词（Round 1 修订：**不新增 delphi-requirements/Kimi 专家**，避免专家膨胀；需求维度通过提示词模式切换承载）
   - 评审焦点：用户场景遗漏、验收标准覆盖度与可测试性、用户画像清晰度、需求边界
   - **阻塞语义（程序化）**：输出 `.sprint-state/phase-outputs/requirements-reviewed.json`，含 `verdict: APPROVED | GAPS_FOUND`、评审时间戳、`requirements_hash`（对需求陈述+CONTEXT.md 内容的 SHA-256，**防陈旧绑定**）；`GAPS_FOUND` → 回到 step 2 补充访谈，最多 2 轮循环后升级给用户决策；`phase-transition 2 completed` 校验该文件存在、verdict=APPROVED 且 hash 匹配当前需求内容，否则 BLOCK
   - lightweight sprint（`change_type == "修改已存在代码"`）：跳过 R1，需求评审合并入 R2
4. **原生设计文档生成**：orchestrator 基于访谈记录 + CONTEXT.md + R1 评审结论生成 `docs/plans/YYYY-MM-DD-<topic>-design.md`（需求摘要、2–3 候选方案与 trade-offs、推荐方案、成功标准）
5. **HARD-GATE（保留 brainstorming 等价语义）**：用户 APPROVE 设计文档前，禁止进入 Part B

**Part B: PLAN（共识评审）**

6. **路由分叉**（保留 Issue #306 逻辑）：`change_type == "修改已存在代码"` → 跳过 step 7，直接 lightweight R2 delphi-review（2 专家 1 轮）
7. 调用 `batch-grill-me`（替代 autoplan taste_decisions）：前置已确定决策整批提出，用户一轮确认
8. **R2 设计评审**：调用 `delphi-review`（现有 3 专家，原生 HARD-GATE ≥90% 共识）
9. 调用 `to-issues`（原生保留）：垂直切片 + blocked_by/dependency_graph → `slices-manifest.json`（格式不变，ralph-loop 零改动）
10. 生成 `specification.yaml`（原生从 APPROVED 设计文档提取，**每个 REQ 必须含清晰验收标准** — #368 验收标准）

### 5.4 brainstorming 能力等价性论证

| brainstorming 能力 | 新链覆盖 |
|--------------------|----------|
| 探索项目上下文 | grill-with-docs 自行探查 + CONTEXT.md 预检 |
| 一次一个澄清问题 | grilling 核心纪律（完全一样） |
| 提出 2–3 方案含 trade-offs | 原生设计文档生成步骤 |
| 分节呈现获用户批准 | 原生 APPROVAL 门（语义不变） |
| 写设计文档到 docs/plans/ | 原生步骤（同路径同格式） |
| HARD-GATE 未批准不实现 | 原生门保留，行为等价 |

### 5.5 autoplan 能力逐条等价表（Round 1 新增）

| autoplan 能力 | 新链覆盖 |
|---------------|----------|
| CEO 视角（产品方向/野心/前提挑战） | R1 需求评审（需求边界/用户价值/场景完整性）+ grilling 方向追问 |
| Design 视角（设计维度评分） | R2 delphi-review architecture 专家 |
| Eng 视角（架构/数据流/边界情况/测试覆盖） | R2 delphi-review technical + feasibility 专家 |
| DX 视角（开发者体验） | R2 评审提示词含 DX 维度；xp-gate 自身 DX 由 `xp-gate doctor` 承载 |
| taste_decisions 批量前置决策 | batch-grill-me（一轮批量确认） |
| 最终 approval gate | 原生 APPROVAL 门（step 5） |

**结论**：autoplan 六项能力全部有等价承接，无功能丢失。

**新增收益**：CONTEXT.md/ADR 自动沉淀；R1 需求评审恢复（#368）；Phase 2 外部调用全部移除（autoplan/office-hours/writing-plans）。

---

## 6. Matt Pocock Skill 内置清单（最小集 4 个）

**Round 1 修订**：原 12 个内置收缩为**最小必需集 4 个**——只内置 HARD-GATE 关键链路必需的 skill，其余经 `xp-gate install-skill` 按需安装（不随 npm 分发，保持零安装包轻量）。

| # | Skill | 用途 | 内置理由 |
|---|-------|------|----------|
| 1 | `grilling` | 访谈核心引擎 | Phase 2 关键链，被 grill-with-docs 依赖 |
| 2 | `grill-with-docs` | Phase 2 THINK 主力 | Phase 2 关键链 |
| 3 | `batch-grill-me` | Phase 2 批量决策 | Phase 2 关键链（autoplan 替代） |
| 4 | `domain-modeling` | CONTEXT.md/ADR 维护 | 被 grill-with-docs 依赖，捆绑 CONTEXT-FORMAT.md + ADR-FORMAT.md |

**按需安装集**（文档推荐，不内置）：`grill-me`（用户触发入口）、`diagnosing-bugs`、`wayfinder`、`handoff`、`writing-great-skills`、`research`、`prototype`、`loop-me`、`to-tickets`。

**License 核查门（发布阻断项，Round 1 新增）**：实施阶段 C 的第 0 步——核查 mattpocock/skills 仓库 LICENSE 文件：
- 若为 MIT/Apache-2.0 等宽松许可 → 直接快照内置，保留版权声明与出处
- **若无 LICENSE 或条款不允许再分发** → 禁止复制原文，转为 **clean-room 重写**：依据功能规范（访谈纪律/文档格式/批量决策协议）重新撰写等效 SKILL.md，不复制原始表达
- 核查结论记录于实施报告；npm publish 前必须为"许可已确认"状态

**命名冲突处置（Round 1 新增）**：现有 `improve-codebase-architecture` skill 内含 "Grilling 循环" 概念。适配措施：内置 4 个 skill 的 frontmatter `triggers` 字段明确锚定需求访谈语境（如 "grill the plan/requirements"），并在 improve-codebase-architecture SKILL.md 加注区分（架构 grilling vs 需求 grilling），避免 skill 路由歧义。

**适配规范**：统一放入 `skills/<name>/`，经 `scripts/copy-skills.sh` 镜像到 `src/npm-package/skills/` 与 `plugins/*/skills/`；frontmatter 补 xp-gate 标准字段（triggers/Security Notes/Anti-Patterns/Output Format），经静态四章节检查脚本验证（§13）。

---

## 7. 其他 Phase 变更（整合 #367 / #369）

### Phase 1 PREP — 不变
worktree 隔离已是原生 git 命令，无外部依赖。

### Phase 3 BUILD
- `freeze/unfreeze` → **只读 subagent 盲评约定**（§8.3）：证据型标准步骤（reviewer 以 Task subagent 运行、工具集只读），**非 HARD-GATE**（Round 1 修订：不设程序化强制，避免过度门禁）
- ralph-loop、TDD、GITHOOKS-GATE、DELPHI-GATE：不变（全原生）
- ralph-loop 内 `gstack/learn` → 写入 `.sprint-history/learnings.md`
- **BUILD 入口契约校验（Round 1 新增，程序化）**：`phase-transition 3 in_progress` 时校验 `slices-manifest.json` schema 合法性 + **slice↔REQ 跨产物一致性**（manifest 每个 slice 引用的 REQ 必须存在于 specification.yaml），不合法 → BLOCK

### Phase 4 VERIFY（整合 #367：test-spec-alignment 程序化 HARD-GATE）

- `delphi-review --mode code-walkthrough`、`xp-gate check --all`：不变（全原生）
- **#367 修复 — test-specification-alignment 强制化**：
  1. test-specification-alignment 执行后**必须**输出 `.sprint-state/phase-outputs/test-alignment-report.json`，含 `alignment_status: PASS | FAIL`、REQ-测试映射、AC-断言映射、`head_commit`（HEAD SHA）与 `spec_hash`（specification.yaml 的 SHA-256）——**防陈旧绑定**（Round 1 新增）
  2. `xp-gate phase-transition 4 completed` **程序化校验**：文件缺失 / 状态非 PASS / head_commit 与当前 HEAD 不符 / spec_hash 与当前 specification.yaml 不符 → 拒绝转换，BLOCK 并提示
  3. 校验逻辑复用 `.code-walkthrough-result.json` 的现有验证模式（文件证据 + CLI 门禁），将 phase-transition 从"状态记录器"升级为"证据校验器"（§8.4）
  4. **TDD**：先写 RED 测试（模拟缺失/FAIL/陈旧报告时 phase-transition 必须退出非零）
- 浏览器验证 → **Layer 4 可选链**：gstack browse（如已装）> browser-use MCP（如平台支持）> SKIP 并记录（Round 1 修订：browser-use 不再是"原生替代"定位）
- web 项目：`qa`/`design-review`/`benchmark` → `xp-gate ui-review`（原生）+ 可选槽位
- `learn`/`retro` → 原生 learnings.md + `xp-gate retro`
- `systematic-debugging` → 可选槽位（Layer 4），保留"无根因不修复"文本纪律

### Phase 5 SHIP — 全原生化
- VERSION-GATE：不变（已原生）
- `finishing-a-development-branch` → phase 内 AskUserQuestion 4 选项（merge/PR/keep/discard）
- `ship` → 原生步骤序列（测试 → VERSION-GATE → commit → push → `gh pr create`）
- `land-and-deploy` → 原生步骤（merge 确认 → `gh run list` 等 CI → canary 健康检查 → 失败 `git revert`）
- NETWORK-RESILIENCE 段落：保留不变

### Phase 6 CLOSE（整合 #369：返工率追踪）

- SHIP→CLOSE GATE、UAT、emergent issues、worktree cleanup：不变（全原生）
- **#369 修复 — 返工追踪机制（Round 1 重写归属模型）**：
  1. CLOSE 完成时向 sprint-state.json 写入 `metrics.completed_at`（ISO 8601）与 `metrics.total_sprint_commits`（**精确定义**：sprint 分支 base（merge-base）到 sprint 合并点的提交数，CLOSE 时由 CLI 计算写入）
  2. 新增 `xp-gate sprint-status --rework-check [--window-days N]`（默认 7 天，可配置）：扫描**仓库范围**（Round 1 修订：不限同一分支——主工作流"合并 PR + 删除分支"下同分支判定恒为 0）在 completed_at 之后窗口期内的 fix 提交（conventional commits 优先：`^fix(\(.+\))?:`，辅以词边界关键词 `\b(fix|bugfix|hotfix|patch|修复)\b`）
  3. 计算 `rework_rate = fix_commits_in_window / total_sprint_commits`，写回 `metrics` 字段
  4. `rework_rate > 30%` → 告警输出（并纳入 `xp-gate retro` 报告区块）
  5. **删除"重新打开的 issue 数"指标**（Round 1 修订：零依赖原则下无可靠数据源）
  6. 纯 Node.js 实现，零依赖，符合 npm 包零安装约束
- `learn` 调用改为原生 learnings.md 写入

### middleware/hooks 声明
- `cso` → `xp-gate check --all`（Gate 7/8/9）
- `careful`/`guard`/`context-save`/`context-restore` 从 hooks 声明移除，保留 tools_denied + Security Notes + sprint-state 原生恢复

---

## 8. 新增原生能力

### 8.1 `xp-gate retro` CLI（新命令，含 #369 返工率区块）
读取 `git log`（本周提交）+ `.xp-gate/audit.jsonl`（门禁记录，聚合时排除 `duration_anomaly` 记录，见 §9）+ `.quality-history.jsonl`（质量趋势）+ `.sprint-history/`（含各 sprint metrics.rework_rate）→ 生成 Markdown 工程回顾报告，含**返工率趋势区块**（#369 数据消费端）与 **--skip-evidence 使用曝光区块**（§8.4）。约 150 行 Node.js，零依赖。

### 8.2 可选技能运行时探测
`xp-gate doctor` 新增报告段：检测 gstack/superpowers skill 与 browser-use MCP 可用性（检查 `~/.qoder/skills/` 等已知路径与 MCP 配置），输出 `OPTIONAL enhancements: browse ✓ / qa ✗ (SKIP)`。

### 8.3 只读盲评 subagent 约定（证据型标准步骤）
phase-3-build.md 定义盲评 reviewer 的 Task 调用模板：`tools: [Read, Grep, Glob]`，禁止 Write/Edit/Bash 写操作。作为**标准步骤**执行并留存评审记录（证据型），不设程序化阻断。

### 8.4 phase-transition 证据校验框架（#367 复用模式，v0.17.1 先行）
`xp-gate phase-transition` 升级为通用证据校验器：每个 phase 声明其必需证据文件（phase 2 → requirements-reviewed.json；phase 3 入口 → manifest 契约校验；phase 4 → test-alignment-report.json + .code-walkthrough-result.json），转换时程序化校验**存在性 + 状态 + 防陈旧绑定**。

**逃生口护栏（Round 1 新增）**：`--skip-evidence` 必须同时提供 `--reason "<text>"`；每次使用写入 audit.jsonl（`event: evidence_skipped, reason, phase`）；`xp-gate retro` 报告设曝光区块；单 sprint 使用 >2 次 → 告警。

**存量 sprint 版本门控（Round 1 新增）**：sprint-state.json 新增 `evidence_schema_version` 字段。v0.17.1 升级后：
- 存量 sprint（无该字段或版本 < 2）：证据缺失仅 **WARN**，不 BLOCK（避免误伤进行中流程）
- 新 sprint（版本 ≥ 2，升级后创建）：证据缺失 **BLOCK**

---

## 9. Bug 修复详设：#370 audit.jsonl duration_ms（Round 1 全面重写）

### 9.1 观测事实（已实证）

- `.xp-gate/audit.jsonl` 共 466 条记录，其中 **68 条** duration_ms > 1e12（gate-1: 63 条，gate-11: 5 条）——量级 ≈ epoch 毫秒本身（~1.77e12，即"56 年"）
- 代码锚点：`githooks/pre-commit` **行 758–761**（`gate_start_ms`）与**行 732**（`record_gate_audit` 内 `end_ms`），两处调用链**完全对称**：`date +%s%3N 2>/dev/null || node -e "console.log(Date.now())" 2>/dev/null || echo "0"`

### 9.2 根因分析（修正 Round 1 前的错误叙述）

Windows Git Bash 的 `date`(1) 不支持 `%N`：`date +%s%3N` 输出如 `1753001234N`（秒 + 字面量 N），且**命令成功退出（exit 0）**——`||` fallback 链**不会触发**（`||` 只捕获命令失败，无法捕获"成功但输出污染"）。污染值进入后续计算：数值化时（parseInt 截断 / bash 算术退化）start 退化为秒级数值（10 位），end 为毫秒级（13 位），`duration ≈ end_ms - start_s ≈ end_ms ≈ 1.77e12` ≈ 56 年。

**关键教训**：修复不能仅调整 date/node 优先级——必须对命令**输出做数值合法性校验**，才能覆盖"成功但污染"这一失效模式。

### 9.3 修复方案

1. **统一时间获取函数 `now_ms()`**：首选 `node -e 'console.log(Date.now())'`；对输出做 `^[0-9]+$` 正则校验；非法则 fallback `date +%s`（秒×1000，精度降级但数值合法）；再失败 `echo 0`
2. **duration 合理性校验**：`record_gate_audit()` 计算前校验 start/end 均为纯数字、`end >= start`、`duration <= max_duration_ms`（默认 7200000ms = 2h，`.xp-gate-config.json` 的 `audit.max_duration_ms` 可配置——Round 1 修订：10 分钟阈值会误伤 Gate 5 全量测试等合法慢门禁）；违反 → **原值照记 + 附加 `duration_anomaly: true` 标记**（Round 1 修订：只标记不改值，不 clamp，保留审计原始性）
3. **存量数据处理**：迁移脚本扫描 `.xp-gate/audit.jsonl`，为 68 条异常记录补记 `duration_anomaly: true`（保留原始值，不删除审计痕迹）
4. **消费端排除规则**：`src/npm-package/lib/gate-audit.ts` 的 `computeStats` 聚合 duration 统计（均值/分位）时**排除** `duration_anomaly: true` 记录，单独计数展示；dashboard 与 retro 同步容错
5. **TDD（Round 1 修正测试设计）**：BATS 测试先 RED——PATH 注入假 `date` 输出 `1753001234N`（exit 0），断言：(a) `now_ms()` 输出为纯数字；(b) 生成的 audit 记录 `duration_ms` 为合法数值且 < 阈值；(c) node 路径被实际采用（假 node 打标记文件断言）。另测 node 不可用时的 date 秒级 fallback 路径。（原设计"mock date 后断言 duration 落在合理区间"在 buggy 代码下恒绿——duration=0 也在合理区间内，测试无效，已修正为断言 node 路径被采用 + 数值合法性）

### 9.4 验收标准

Windows Git Bash 下全量 pre-commit 后新增记录 duration_ms 均为合法数值且 < 阈值；68 条存量异常记录被标记（原始值保留）；computeStats 排除 anomaly 记录；BATS 双路径测试通过。

---

## 10. 兼容性与迁移

| 项 | 策略 |
|----|------|
| `slices-manifest.json` 格式 | **冻结不变**，to-issues 原生保留，ralph-loop 零改动 |
| `specification.yaml` 生成 | 不变；新增约束"每 REQ 必须含验收标准"（#368） |
| `.sprint-state/` 状态机 | 新增 `evidence_schema_version` 字段；存量 sprint 证据缺失仅 WARN（§8.4 版本门控） |
| sprint-state.json schema | 新增 `metrics` 字段（#369），旧 sprint 无该字段时 rework-check 提示"无 completed_at 记录"而非报错 |
| audit.jsonl schema | 新增可选 `duration_anomaly` 字段，消费端（gate-audit.ts computeStats / dashboard / retro）容错并排除聚合 |
| 已有 gstack/superpowers 用户 | 无感升级——可选槽位自动探测，有则用、无则 SKIP |
| `to-issues` | **保留原生，不 deprecated**（Round 1 修订） |
| Delphi 配置 | `delphi-review` 新增 `--mode requirements` 提示词模式（复用现有 3 专家，无新增专家/agent 部署） |
| AGENTS.md / MANIFEST.md / CAPABILITIES.md | 同步更新 skill 清单、CLI 清单、依赖声明 |
| pre-commit/pre-push 门禁 | 仅 #370 时间戳修复，无行为变更 |

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| grill 访谈比 brainstorming 更"锋利"，用户体验变化 | 中 | 设计文档生成步骤保留方案对比结构；grilling 本身带推荐答案 |
| Phase 2 增加 R1 评审点后链路变长 | 中 | R1 为轻量（2 专家 1 轮）；lightweight sprint 跳过 R1 合并入 R2；batch-grill-me 批量决策抵消交互轮次 |
| phase-transition 证据校验误伤存量流程 | 中 | 存量 sprint 版本门控（WARN 不 BLOCK）；`--skip-evidence` 逃生口带护栏（reason 强制 + retro 曝光 + 频次告警） |
| 浏览器验证链弱于 gstack browse | 低 | Layer 4 优先级：gstack browse > browser-use > SKIP；VERIFY 浏览器检查可 SKIP |
| mattpocock/skills 无 LICENSE 无法内置 | **高（发布阻断）** | License 核查门（§6）：无许可则 clean-room 重写等效 skill，不复制原文 |
| 4 个内置 skill 质量参差 | 中 | 静态四章节检查脚本（§13）+ 人工评审；上游变更无感（快照内置） |
| #370 修复在纯 POSIX 环境回归 | 低 | node 首选路径在所有平台一致；BATS 覆盖双路径（node 可用/不可用 fallback） |
| rework 关键词误匹配（如 "prefix" 含 "fix"） | 低 | conventional commits 格式优先（`^fix(\(.+\))?:`）+ 正则词边界匹配 |
| R1 复用现有专家导致需求维度被设计思维稀释 | 中 | `--mode requirements` 独立提示词模板，评审焦点显式限定需求维度；R1 只评需求文档不评设计 |
| Matt 上游仓库变更 | 低 | 内置为快照，版本随 xp-gate 管控（这正是重构目的） |

---

## 12. 实施计划

### v0.17.1（patch，P0 先行）

| 阶段 | 内容 | 关联 | 产出 |
|------|------|------|------|
| **A. #370 修复** | `now_ms()` 统一 + 数值合法性校验 + duration 合理性标记 + 存量 68 条标记 + computeStats 排除（TDD：BATS 先 RED） | #370 | audit 数据可信 |
| **B. #367 修复** | test-specification-alignment 输出 test-alignment-report.json（含防陈旧绑定）+ phase-transition 证据校验框架 + 版本门控 + skip 护栏（TDD：vitest 先 RED） | #367 | Phase 4 程序化 HARD-GATE |

### v0.18.0（minor，重构主线）

| 阶段 | 内容 | 关联 | 产出 |
|------|------|------|------|
| **C0. License 核查门** | mattpocock/skills LICENSE 核查，结论记录；无许可则启动 clean-room 重写 | 主线 A | 发布阻断项清除 |
| **C. Skill 内置** | 4 个 Matt Pocock skill 适配入 `skills/`（四章节补全、镜像同步、命名冲突处置） | 主线 A | skills/ 12 个正典 skill |
| **E. 编排层重写** | sprint-flow phase-2/3/4/5/6 + orchestration-rules + middleware + tool-descriptions + skill-invocations 去外部化；悬空引用清扫（§2.3）；Phase 2 接入 R1/R2 双点评审；BUILD 入口契约校验 | 主线 A + #368 | 零外部依赖 phase 文档 |
| **F. Delphi 需求评审** | delphi-review `--mode requirements` 提示词模板 + requirements-reviewed.json 证据格式 + phase-transition 2 校验 | #368 | R1 评审点落地 |
| **G. 返工率追踪** | sprint-state metrics 字段 + `sprint-status --rework-check` + `xp-gate retro` CLI（TDD） | #369 | 返工闭环 |
| **H. 文档同步** | AGENTS.md / MANIFEST.md / CAPABILITIES.md / SKILL.md 触发词 / 按需安装集文档 | — | 文档一致 |
| **I. 验证** | 见 §13 全量验证 | — | 验证报告 |

**执行顺序说明**：v0.17.1（A/B）先行发布（P0 不等重构，且 B 的证据校验框架被 v0.18.0 的 F/G 复用）；v0.18.0 中 C0 是 C 的前置门；G 依赖 B 的 CLI 框架；H/I 收尾。

**TDD 约束**：A、B、G 涉及代码，须先 RED 后实现；E 为文档改动，以静态四章节检查 + 端到端 dry-run 为验证。

---

## 13. 验证方案

### 13.1 主线 A 验证
1. **依赖归零**：`grep -ri "gstack\|superpowers" skills/` 仅允许出现在"可选槽位"表述上下文；§2.3 三处悬空引用已清扫
2. **HARD-GATE 自包含**：DESIGN→BUILD、VERIFY→SHIP、SHIP→CLOSE 三门调用链无外部 skill
3. **内置 skill 结构检查**（Round 1 修订：skill-cert 在仓库已无可执行实现、CI job 已移除，改为可执行的静态检查）：脚本验证 4 个内置 skill 的 SKILL.md 均含 triggers/Security Notes/Anti-Patterns/Output Format 四章节 + frontmatter 合法（集成进 `scripts/test-plugins.mjs`）
4. **契约测试（程序化）**：`phase-transition 3 in_progress` 对非法 manifest / slice 引用不存在 REQ 的 fixture 必须 BLOCK（vitest）
5. **端到端**：干净环境（无 gstack/superpowers skill 目录、无 browser-use MCP）执行 `/sprint-flow` dry-run 全 6 阶段无断链，Layer 4 步骤全部正确 SKIP
6. **回归**：现有 BATS（22 文件）+ vitest 全量通过
7. **License**：npm publish 前 license 核查结论为"已确认"（宽松许可快照 或 clean-room 重写完成）

### 13.2 Issues 验收对照

| Issue | 验收标准 | 验证方式 |
|-------|----------|----------|
| #370 | Windows Git Bash 下新记录 duration_ms 合法且 < 阈值；68 条存量被标记；computeStats 排除 anomaly；BATS 双路径通过 | BATS（假 date 输出字面量 N + 假 node 标记断言）+ audit.jsonl 复扫报告 |
| #367 | 缺失/FAIL/陈旧（head_commit 或 spec_hash 不匹配）报告时 phase-transition 4 completed 被拒绝（v0.17.x 存量 sprint 仅 WARN）；audit.jsonl 出现 test-alignment 条目 | vitest（三类非法 fixture → 退出非零）+ 端到端 sprint 审计追踪 |
| #368 | R1 评审记录存在（requirements-reviewed.json 含 verdict + requirements_hash）；CONTEXT.md 快速路径同样触发 R1；Phase 2 外部 skill 调用数为零；specification.yaml 每 REQ 含验收标准 | R1 评审 dry-run + phase-transition 2 校验测试 + specification.yaml schema 校验 |
| #369 | sprint-state.json 含 metrics.total_sprint_commits / completed_at / rework_rate；sprint-status --rework-check 在合并 PR + 删除分支后仍能检出仓库范围 fix 提交；>30% 触发告警 | vitest（构造含 fix 提交的 git 历史 fixture，含分支删除场景）+ CLI 手动验证 |

---

## 14. 决策记录

| 决策 | 结论 | 理由 |
|------|------|------|
| brainstorming 替代选型 | grill-with-docs + 原生审批门 | 访谈纪律等价，额外沉淀 CONTEXT.md/ADR |
| autoplan 是否保留为可选 | 否，完全移除 | 六项能力逐条等价承接（§5.5）；**Issue #368 独立提出相同方向** |
| 需求评审恢复形式 | `delphi-review --mode requirements`（复用现有 3 专家，2 专家 1 轮轻量配置） | Round 1 修订：不新增专家/agent，提示词模式切换承载需求维度，避免专家膨胀与部署复杂度 |
| R1 评审点位置 | grill 访谈后、设计文档生成前；CONTEXT.md 快速路径同样执行 | 需求缺陷在设计文档之前拦截成本最低；快速路径的 CONTEXT.md 可能陈旧 |
| #367 修复模式 | phase-transition 升级为通用证据校验框架（v0.17.1 先行） | "文本指令无强制"是系统性风险，后续 HARD-GATE 均复用 |
| 证据防陈旧 | 所有证据文件绑定 HEAD commit / 内容哈希，校验时比对 | Round 1 新增：防止旧证据复用绕过门禁 |
| gstack 技能处理 | 不删除、不依赖 | 已装用户增强（可选槽位），未装不影响主链 |
| browser-use MCP 定位 | Layer 4 可选槽，非原生替代 | Round 1 修订：平台能力非 xp-gate 自有，不能放在必需链 |
| to-issues 去留 | **保留原生** | Round 1 实证：to-issues 已有 blocked_by/dependency_graph/DAG 循环检测/拓扑排序，to-tickets 无替代收益，原"超集"论断错误 |
| 内置 skill 范围 | 最小集 4 个（grilling/grill-with-docs/batch-grill-me/domain-modeling） | 只内置 HARD-GATE 关键链必需项；其余 install-skill 按需，保持包轻量 |
| Matt Pocock skill 许可 | License 核查门前置，无许可则 clean-room 重写 | Round 1 新增：发布阻断项 |
| 新增 CLI 范围 | retro + sprint-status --rework-check 扩展 + phase-transition 证据校验增强 | 复用现有命令面，控制膨胀 |
| 4 issues 交付节奏 | #370+#367 → v0.17.1 patch 先行；#368+#369 随 v0.18.0 | Round 1 修订：P0 不被重构阻塞；#367 框架被 v0.18.0 复用 |

---

## 15. Delphi Round 1 反馈处置表

Round 1 结果：3/3 专家一致 REQUEST_CHANGES（100% 共识）。全部 Critical + Major 反馈处置如下：

| # | 反馈 | 处置 | 位置 |
|---|------|------|------|
| 1 | R1 阻塞语义未定义、无程序化证据 | 定义 requirements-reviewed.json + phase-transition 2 校验 + 2 轮循环上限 | §5.3 |
| 2 | browser-use MCP 误归为原生能力 | 重归 Layer 4；浏览器验证优先级 gstack browse > browser-use > SKIP | §3/§4/§7 |
| 3 | freeze 盲评不应设为 HARD-GATE | 降级为证据型标准步骤 | §3/§7/§8.3 |
| 4 | #370 行号误植（732→实际 758-761）、失效链与代码对称性矛盾、存量清点错误（15→实证 68 条）、BATS RED 测试恒绿、600s 阈值误伤慢门禁 | §9 全面重写：行号锚定、对称链失效模式（成功但输出污染）、68 条清点、测试改断言 node 路径+数值合法性、阈值 2h 可配置、只标记不改值、computeStats 排除 | §9 |
| 5 | #369 同分支归属在主工作流恒为 0；"重开 issue 数"无数据源 | 改仓库范围+completed_at 窗口归属；total_sprint_commits 精确定义；删除重开 issue 指标；窗口可配置 | §7 Phase 6 |
| 6 | 存量 sprint 证据校验会误伤 | evidence_schema_version 版本门控（存量 WARN / 新建 BLOCK） | §8.4/§10 |
| 7 | manifest 契约仅靠"测试锁定"太弱 | phase-transition 3 入口程序化校验 manifest schema + slice↔REQ 一致性 | §7 Phase 3/§13 |
| 8 | mattpocock/skills 许可证未确认 | License 核查门（阶段 C0），无许可则 clean-room 重写，发布阻断 | §6/§12 |
| 9 | to-issues"被超集"论断事实错误 | 保留 to-issues 原生，放弃 to-tickets 替代 | §3/§5.3/§14 |
| 10 | 12 个内置过多 | 收缩为最小集 4 个，其余 install-skill 按需 | §6 |
| 11 | 新增 delphi-requirements/Kimi 专家膨胀 | 复用现有 3 专家 + `--mode requirements` 提示词切换 | §5.3/§14 |
| 12 | --skip-evidence 无护栏 | --reason 强制 + audit 记录 + retro 曝光 + 频次告警 | §8.4 |
| 13 | CONTEXT.md 快速路径跳过 R1 留下缺口 | 快速路径同样执行 R1（CONTEXT.md 可能陈旧） | §5.3 |
| 14 | 证据可复用绕过门禁 | 全部证据防陈旧绑定（HEAD commit / 内容哈希） | §1.4/§5.3/§7/§8.4 |
| 15 | 与 improve-codebase-architecture "Grilling 循环"命名冲突 | triggers 锚定需求访谈语境 + 对方加注区分 | §6 |
| 16 | P0 修复被重构阻塞 | #370+#367 拆 v0.17.1 patch 先行 | §1/§12 |
| 17 | autoplan 等价性论证不足 | §5.5 六项能力逐条等价表 | §5.5 |
| 18 | 正典 skill 内 gstack 悬空引用 | §2.3 清点三处，阶段 E 一并清扫 | §2.3/§12 |
| 19 | skill-cert 已无可执行实现 | 验收改静态四章节检查脚本（集成 test-plugins.mjs） | §13.1 |

---

## 16. Delphi Round 2 评审结论（2026-07-25）

### 16.1 评审配置

| 项 | 值 |
|---|---|
| 评审轮次 | Round 2（验证轮，基于 §15 Round 1 处置表） |
| 评审专家 | Architecture / Feasibility / Technical（同 Round 1 的 3 专家） |
| 评审对象 | `docs/plans/2026-07-24-skill-deps-minimalization-design.md`（§1-§15，DRAFT-R2 状态） |
| 共识阈值 | ≥90% APPROVED 裁决即可进入实施 |

### 16.2 裁决结果

| 专家 | 模型 | 裁决 | 置信度 | 关键问题 | 主要关注点 | 次要关注点 | Round 1 处置验证数 |
|------|------|------|--------|----------|-----------|-----------|-------------------|
| Architecture Expert | Qwen3.7-Max | **APPROVED** | 9/10 | 0 | 2 | 3 | 10/10 [#1,2,3,9,10,11,13,14,15,18] |
| Feasibility Expert | DeepSeek-V4-Pro | **APPROVED** | 8/10 | 0 | 2 | 3 | 8/8 [#4,5,6,7,8,12,16,17] |
| Technical Expert | GLM-5.2 | **APPROVED** | 8/10 | 0 | 5 | 3 | 2/2 [#4,#9] |

**共识统计**：3/3 APPROVED（100%，超过 90% 阈值）；平均置信度 8.33/10。

### 16.3 Round 1 处置项验证结论

所有 19 项 Round 1 反馈均被专家逐条核实并对源码（pre-commit L732/L758-761、audit.jsonl 68 条实证、`.xp-gate-config.json`、`.code-walkthrough-result.json` 模式、3 个 Delphi 专家配置、to-issues SKILL.md DAG/拓扑能力等）交叉验证：

- **全部实质性解决**，无形式化应付
- #370 代码锚点（pre-commit L732/L758-761 对称调用链）由 Technical Expert 逐行验证
- 68 条 audit 异常记录清点精确（gate-1:63, gate-11:5），由 Technical Expert 用 PowerShell 扫描审计
- mattpocock/skills 仓库许可由 Feasibility Expert 实证确认为 **MIT License**——§6 License 核查门已自动通过
- to-issues 的 blocked_by/dependency_graph/DAG 拓扑排序能力由 Technical Expert 在 SKILL.md 中实证

### 16.4 评审发现的关键澄清项（7 项）

所有澄清项均为**实施层规格**而非设计缺陷，于实施 kickoff 时逐项确认，不触发 Round 3。

| # | 关注点 | 来源 | 处置决议 |
|---|--------|------|----------|
| C1 | `phase-transition.js` 实为 CommonJS `.js`，非 `.ts`（文档/task 描述与代码库不符） | Architecture + Technical | v0.17.1 B 阶段保持 `.js` 一致性；新增 retro CLI 用 `.ts` |
| C2 | `test-specification-alignment SKILL.md` 的 Output Format 段需更新但未列入 B 阶段工作项 | Technical | B 阶段计划显式追加"更新 SKILL.md Output Format + 输出路径" |
| C3 | R1 评审"2 专家 1 轮"专家选择参数化机制未指定 | Technical | F 阶段决策：mode 模板内配置（推荐） vs `--max-experts N` CLI 参数 |
| C4 | 证据文件 JSON 畸形处理未定义 | Technical | B 阶段统一策略：畸形 JSON = 缺失证据 → 新 sprint BLOCK / 存量 WARN |
| C5 | `total_sprint_commits` 在 SHIP 删分支后无法直接通过 `git merge-base <branch>` 计算 | Technical | G 阶段前置：SHIP 阶段存入 `merge_base_sha` 到 sprint-state.json |
| C6 | `batch-grill-me` 未在 Matt Pocock 仓库 README 明确列出 | Feasibility | C0 阶段同步验证 4 个 skill 物理存在；不存在的立即启动 clean-room 重写 |
| C7 | 阶段 E（编排层重写 5+ 文件）是单点风险，建议拆分 E1 + E2 | Feasibility | 采纳：E1 = phase-2 + R1/R2 接入；E2 = phase-3/4/5/6 + 悬空引用清扫 |

### 16.5 评审证据文件

- **证据位置**: `.sprint-state/phase-outputs/requirements-reviewed.json`
- **证据绑定**:
  - `head_commit`: `d45a41897d4b49b9d366e7491c6a04f9d6705b78`
  - `requirements_hash`: SHA-256 of `docs/plans/2026-07-24-skill-deps-minimalization-design.md`
- **验证方式**: `phase-transition 2 completed` 将校验此文件存在、verdict=APPROVED 且 hash 匹配当前设计

### 16.6 结论

设计经 Round 2 评审达到可实施标准：

- ✅ 架构层面：Layer 0-4 分层清晰，依赖规则单向，phase-transition 升级为证据校验器具有系统性价值
- ✅ 可行性层面：v0.17.1 约 2-3 天、v0.18.0 约 5-7 天 solo dev 工期合理
- ✅ 技术层面：Round 1 全部反馈经源码实证验证，核心修复方案与现有架构模式一致
- ✅ 许可合规：mattpocock/skills MIT license 已实证，§6 License 核查门自动通过

**决策**: APPROVED，进入 v0.17.1 patch 实施（A 阶段 #370 → B 阶段 #367 证据框架）。

