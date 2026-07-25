# Sprint Flow — Phase Overview & Detailed Instructions

> **This file**: detailed phase descriptions, skill integration, parameter docs, output contract, templates, research evidence, and orchestration rules.
> **Router file**: `../SKILL.md` — description, triggers, workflow steps, constraints, anti-patterns only.

---

## 核心原则

| 原则 | 说明 |
|------|------|
| **单一入口** | 用户只需调用 `/sprint-flow`，自动串联全流程 |
| **自动流水线** | 自动执行多个阶段，原生步骤 + 内置 Matt Pocock skill |
| **关键节点暂停** | APPROVED 确认、DELPHI-GATE 通过、Ship 确认、⚠️ Phase 6 CLOSE 必须人工 |
| **承认 Emergent** | 用户验收环节必须人工，无法自动化（78% 失败不可见） |
| **复用现有 Skills** | 不重新发明，整合调用现有体系 |

---

## Unique Value Proposition

Sprint Flow is NOT just a sequential launcher of existing skills. Here's what makes it different from manually running each skill:

### Why Sprint Flow vs Manual Skill Execution

| Dimension | Manual Execution | Sprint Flow |
|-----------|-----------------|-------------|
| **Context Continuity** | Each skill starts fresh; lost design decisions between phases | Phase summaries + sprint-state.json maintain full traceability across 6 phases |
| **Gate Enforcement** | No enforcement — easy to skip Delphi, skip TDD, skip UAT | HARD-GATE: design must be APPROVED (≥90% Delphi consensus) before coding; UAT is mandatory (no bypass) |
| **Token Efficiency** | Linear context accumulation across phases — ~150K+ tokens | Ralph-loop default: 40-67% token savings via clean REQ-level contexts |
| **Emergent Requirements** | Discovered late, silently ignored or merged | Phase 6 CLOSE explicitly captures emergent issues via template; triggers Sprint 2 for critical issues |
| **Quality Ecosystem** | No integration with quality gates | Integrated with xp-gate's full quality ecosystem: Gate 5 (coverage), Gate M2 (mock density), Delphi code-walkthrough |
| **Progress Tracking** | Ad-hoc, memory-based | `.sprint-state/` persistence with phase history, timing, and metrics — `--status` renders progress dashboard |

### Key Differentiators

1. **40-67% Token Savings via Ralph Loop**: Phase 3 BUILD default (`ralph-loop`) processes one REQ at a time with clean context, avoiding the linear context accumulation that costs 150K+ tokens in parallel mode.

2. **HARD-GATE Discipline**: Design must pass Delphi review (≥90% consensus, ≥2 model providers, domestic models only) before Phase 3 BUILD can start. This is enforced both in SKILL.md instructions and via the Claude Code plugin's PreToolUse hook.

3. **Emergent Requirements Acknowledgment**: Based on research showing 78% of failures are invisible to AI (arXiv study), Phase 6 CLOSE includes mandatory manual UAT verification — cannot be automated, skipped, or bypassed.

4. **XP-Gate Quality Ecosystem Integration**: Sprint Flow is part of the broader xp-gate ecosystem. Phase 3 BUILD integrates with Gate 5 (test coverage ≥80%), Gate M2 (mock density ≤30%), and Gate MW (code-walkthrough validation). Phase 4 VERIFY runs Delphi code-walkthrough that generates `.code-walkthrough-result.json` for pre-push enforcement.

5. **Full Lifecycle Coverage**: From worktree isolation (PREP) to cleanup (CLOSE), sprint-flow covers the entire development lifecycle — not just the "write code" part. PREP (Phase 1/6) prevents over-engineering by routing lightweight changes through simplified workflows.

---

## 完整流程（默认无参数）

调用 `/sprint-flow "[需求描述]"` 后，自动执行以下流程：

```
Phase 1/6: PREP → worktree隔离 + 规模评估 + 流程路由
Phase 2/6: DESIGN → grill-with-docs → R1 需求评审 → 设计文档+APPROVAL → batch-grill-me → R2 delphi-review → to-issues → specification.yaml
Phase 3/6: BUILD → BUILD-ENTRY-CONTRACT → GITHOOKS-GATE → DELPHI-GATE → ralph-loop/TDD → blind-review (read-only subagent) → verification
Phase 4/6: VERIFY → delphi-review --mode code-walkthrough → test-alignment (#367 HARD-GATE) → xp-gate check --all → browser (Layer 4) → learnings + retro
Phase 5/6: SHIP → VERSION-GATE → 分支完成决策(4选项) → native ship (PR) → native land (merge+CI+canary)
Phase 6/6: CLOSE → USER ACCEPTANCE (⚠️ 人工) → #369 返工指标 → emergent issues → cleanup
```

**v2.0 Compact Redesign** (Issue #290): Merged from 11 phases to 6. PREP = old ISOLATE + AUTO-ESTIMATE. DESIGN = old THINK + PLAN. BUILD = old BUILD (unchanged). VERIFY = old REVIEW + FEEDBACK. SHIP = old SHIP + LAND. CLOSE = old USER ACCEPTANCE + CLEANUP.

---

## 暂停点设计（不是随时停，而是设计明确的暂停点）

- **Phase 1/6 PREP**: 保护分支强制隔离 → 输出警告或自动创建 worktree → 自动恢复；AUTO-ESTIMATE 结果展示 → 用户确认 → 按路由继续
- **Phase 2/6 DESIGN**: grill-with-docs 访谈 → R1 需求评审 GAPS_FOUND → 补充访谈（最多 2 轮）；设计文档未 APPROVED (HARD-GATE) → 用户修改 → APPROVED 后继续；batch-grill-me 批量决策 → 用户确认；R2 delphi-review 未 APPROVED → 修复 → APPROVED → specification.yaml
- **Phase 3/6 BUILD**: BUILD-ENTRY-CONTRACT 未通过 → BLOCK；DELPHI-GATE 未通过 → BLOCK；验证失败 > max3 → 用户决策修复/放弃；成本超阈值 → 用户确认
- **Phase 4/6 VERIFY**: delphi code-walkthrough REQUEST_CHANGES → 用户处理 → 重新评审；test-alignment 失败 (#367) → 回退 Phase 3（不暂停）；浏览器验证发现问题 → 回退 Phase 3（不暂停）
- **Phase 5/6 SHIP**: 分支完成决策 (4选项) → 确认；native ship PR → 用户确认合并；native land 完成/失败 → 用户确认；⚠️ SHIP must complete merge to main + release before Phase 6
- **Phase 6/6 CLOSE**: SHIP→CLOSE GATE (校验 merge 已完成 + git status clean + 当前在 main) → Backup sprint-state → #369 返工指标写入 → USER ACCEPTANCE ⚠️ 必须人工验收 → 用户确认后继续；cleanup 完成/失败 → 用户确认 → 结束流程

---

## Workflow Steps Detail

| Step | Phase | Name | Key Actions | Output |
|------|-------|------|-------------|--------|
| 1 | **1/6** | **PREP** | Detect protected branch → Create git worktree → AUTO-ESTIMATE sizing → Classify (lightweight/standard/complex) | Worktree path + impact assessment |
| 2 | **2/6** | **DESIGN** | grill-with-docs → R1 需求评审 → 设计文档+APPROVAL (HARD-GATE) → batch-grill-me → R2 delphi-review (≥90% consensus) → to-issues → specification.yaml | specification.yaml + slices-manifest.json + requirements-reviewed.json |
| 3 | **3/6** | **BUILD** | BUILD-ENTRY-CONTRACT → GITHOOKS-GATE → DELPHI-GATE → ralph-loop (default) or parallel → TDD → blind-review (read-only subagent) → verification | MVP code |
| 4 | **4/6** | **VERIFY** | delphi-review --mode code-walkthrough → test-specification-alignment (#367 HARD-GATE) → xp-gate check --all → browser (Layer 4 optional) → learnings + xp-gate retro | Review report + feedback-log.md + test-alignment-report.json |
| 5 | **5/6** | **SHIP** | VERSION-GATE → 分支完成决策 (4选项) → native ship (create PR) → native land (merge + CI + canary) → release | PR URL + deploy status + merge confirmation |
| 6 | **6/6** | **CLOSE** | SHIP→CLOSE GATE (merge + release verified) → Backup sprint-state → #369 返工指标 → USER ACCEPTANCE (⚠️ mandatory manual) → Capture emergent issues → Cleanup worktree + branch → Sprint summary | Emergent issues list + cleanup report + metrics |

**Phase Flow**:
```
PREP → DESIGN → BUILD → VERIFY → SHIP (merge to main + release) → CLOSE
                                                        ↑
                                               SHIP→CLOSE GATE
                                               (merge verified + main clean)
```

**Hard Gates**:
- **Phase 2/6 → 3/6 (DESIGN → BUILD)**: R1 需求评审 APPROVED + 设计文档用户 APPROVED + R2 delphi-review APPROVED (≥90% consensus) + GITHOOKS-GATE (hooks installed) + DELPHI-GATE (spec APPROVED) + BUILD-ENTRY-CONTRACT (manifest schema + slice↔REQ 一致性)
- **Phase 4/6 → 5/6 (VERIFY → SHIP)**: feedback-log.md must exist + test-alignment-report.json PASS (#367 程序化 HARD-GATE)
- **Phase 5/6 → 6/6 (SHIP → CLOSE)**: PR must be merged to main + release completed (HARD-GATE). See `references/phase-6-close.md#ship--close-gate`.

---

## 各 Phase 调用的 Skills

### ⚠️ 强制输出格式规范（Mandatory Output Format）

**执行每个 Phase 时，必须以以下固定格式输出阶段标题**，不可省略、不可合并、不可替换：

```markdown
## Phase 1/6: PREP (准备工作)
## Phase 2/6: DESIGN (设计)
## Phase 3/6: BUILD (构建)
## Phase 4/6: VERIFY (验证)
## Phase 5/6: SHIP (发布)
## Phase 6/6: CLOSE (收尾)
```

**规则**：
1. 每个 Phase **开始执行时必须首先输出**对应的 `## Phase X/6: NAME` 标题行（作为该 Phase 输出的第一行）
2. **禁止省略** "Phase" 关键词（如不能只写 "PREP" 或 "## 1/6"）
3. **禁止合并**多个 Phase 的输出（每个 Phase 必须有独立标题）
4. **格式必须精确匹配**：`## Phase X/6:` + 大写英文名 + ` (中文名)`
5. 跳过某个 Phase（如 `--resume-from build` 跳过了 PREP, DESIGN）时，不输出被跳过 Phase 的标题
6. 触发 `/sprint-flow` 后，**第一行输出应包含工作流阶段概览**：

```
Sprint Flow: PREP → DESIGN → BUILD → VERIFY → SHIP → CLOSE
```

### Phase 1/6: PREP (准备工作 — worktree 隔离 + 规模评估)

**执行时机**: `/sprint-flow` 启动后 → Phase 2/6 DESIGN 前。**自动执行**。

**对应旧模型**: Phase -1 ISOLATE + Phase -0.5 AUTO-ESTIMATE

**详细指令**: 参见 `references/phase-1-prep.md` — 包含步骤表、参数处理、错误回退、sprint-state 格式、AUTO-ESTIMATE 指标计算、路由决策。

**快速参考**:
1. 检测保护分支 (main/master/develop) → 自动创建 worktree `.worktrees/sprint/sprint-YYYY-MM-DD-NN`
2. Sprint Lock 检测（Issue #144）— stale 锁自动覆盖，非 stale 阻断
3. 项目 setup (`npm install`/`go mod download`/`pip install`)
4. `.gitignore` 校验 + Sprint State 记录 + 基线测试
5. 识别需求类型 → 收集指标（引用计数、跨模块依赖、循环依赖）→ **轻量** / **标准** / **复杂**
6. 输出评估结果 → 用户确认后按路由继续
7. **参数**: `--no-isolate` (跳过), `--branch-name <name>`, `--force` (绕过保护分支)

### Phase 2/6: DESIGN (设计 — 需求探索 + 双点评审)

**对应旧模型**: Phase 0 THINK + Phase 1 PLAN

**执行者**: orchestrator 直接执行全部步骤（交互式 skill）。

**详细指令**: 参见 `references/phase-2-design.md` — 完整流程、条件分支、HARD-GATE。

**快速参考**:
- **Step 0: CONTEXT.md 预检 (#322)**: 存在则 SKIP grill 访谈，但 R1 需求评审仍执行（CONTEXT.md 可能陈旧）
- **Step 1: grill-with-docs** — `skill(name="grill-with-docs")` — 逐个追问 + CONTEXT.md/ADR 沉淀。**HARD-GATE**: 设计未批准 → 不可进入实现
- **Step 2: R1 需求评审 (#368)** — `npx xp-gate delphi-review --mode requirements` — 轻量 2 专家 1 轮，输出 requirements-reviewed.json（含 requirements_hash 防陈旧绑定）。lightweight sprint 跳过 R1 合并入 R2
- **Step 3: 原生设计文档生成** — `docs/plans/YYYY-MM-DD-<topic>-design.md`（需求摘要、2-3 方案、推荐、成功标准）
- **Step 4: HARD-GATE APPROVAL** — 用户审批设计文档
- **Step 5: 路由分叉** — `change_type == "修改已存在代码"` → SKIP batch-grill-me, lightweight R2
- **Step 6: batch-grill-me** — `skill(name="batch-grill-me")` — 批量前置决策（替代 autoplan taste_decisions）
- **Step 7: R2 delphi-review** — `skill(name="delphi-review")` — 等待 APPROVED（≥90% 共识）
- **Step 8: to-issues** — `skill(name="to-issues")` — 垂直切片 Issue 拆分 → slices-manifest.json
- **Step 9: specification.yaml** — 从 APPROVED 设计文档自动提取（每 REQ 含验收标准 — #368）
- **Web 前端额外注入**: OPTIONAL design-shotgun（如已安装）

### Phase 2/6→3/6: GITHOOKS-GATE（质量门禁安装检查）

**执行时机**: Phase 2/6 DESIGN 完全通过、准备进入 Phase 3/6 BUILD 之前。

**必须执行**: 运行 `githooks/verify.sh` 检查当前项目的 hooks 是否安装。

**检查结果处理**:
- ✅ 全部存在 → 进入 Phase 3/6 BUILD 入口（仍必须先执行 DELPHI-GATE）
- ❌ 部分/全部缺失 → 运行 `githooks/install.sh` 安装（包括 `.git/hooks/pre-commit`、`.git/hooks/pre-push`、`githooks/adapter-common.sh`、`githooks/adapters/`）
  - 如果 githooks/ 目录不存在于项目根目录（即当前项目不是 xp-gate） → 从 xp-gate 仓库拉取 `githooks/` 目录结构
  - 安装完成后再次 `verify.sh` 确认

**核心原则**: 没有质量门禁的代码不可进入 BUILD 阶段。**GITHOOKS-GATE 失败 → 不可编码。**

### Phase 3/6: BUILD (构建 — ralph-loop 默认 + TDD + 盲评 + 验证)

**对应旧模型**: Phase 2 BUILD（功能不变）

**详细指令**: 参见 `references/phase-3-build.md`。

**快速参考**:
1. **BUILD-ENTRY-CONTRACT (MANDATORY — v0.18.0+)**: `phase-transition 3 in_progress` 校验 slices-manifest.json schema + slice↔REQ 一致性 → 不合法 BLOCK
2. **DELPHI-GATE**: 验证 `.sprint-state/delphi-reviewed.json` 存在且 `verdict = "APPROVED"` → 否则 BLOCK
3. **TDD-GATE (MANDATORY — v0.14.0+)**: 在 delegation 前验证每个 REQ 存在 failing test。无 test → mark `[TDD-RED]`（ralph-loop 创建）。有 test 且 GREEN 且无实现 → BLOCK（TDD bypass）。详见 `references/phase-3-build.md#tdd-gate-pre-implementation-tdd-check-mandatory`。
4. **输入**: `slices-manifest.json`（Phase 2/6 生成），按 `execution_order` 逐个执行
5. **模式**: 默认 `ralph-loop`（逐 REQ 迭代，token 节约 40-67%），可选 `--mode parallel`
6. **Skill 步骤**: BUILD-ENTRY-CONTRACT → hooks-install → TDD-GATE → TDD (RED/GREEN/REFACTOR) → blind-review (read-only subagent, tools: [Read, Grep, Glob]) → verification-before-completion → 成本监控 → learnings.md 写入
7. **Mock Minimization**: integration-first, mock 仅限 external services, 密度 > 30% 需 `@mock-justified`

### Phase 4/6: VERIFY (验证 — 代码走查 + QA + 反馈获取)

**对应旧模型**: Phase 3 REVIEW + Phase 4 FEEDBACK

**详细指令**: 参见 `references/phase-4-verify.md`。

**快速参考**:
- **Orchestrator 直接执行**: delphi-review code-walkthrough 需要用户确认 verdict（Issue #249），**必须由 orchestrator 直接调用** `skill(name="delphi-review")`
- **执行顺序**: `delphi-review --mode code-walkthrough` → 等待 APPROVED → `test-specification-alignment` (#367 程序化 HARD-GATE: test-alignment-report.json + head_commit + spec_hash) → `xp-gate check --all` → 浏览器验证 (Layer 4: gstack browse > browser-use MCP > SKIP)
- **Web 前端**: `xp-gate ui-review`（原生）+ OPTIONAL gstack qa/design-review/benchmark（如已安装）
- **Feedback 子阶段**: learnings.md 写入（原生）+ `xp-gate retro`（原生，含 #369 返工率区块）+ OPTIONAL systematic-debugging（Layer 4，保留"无根因不修复"纪律）
- 输出: 评审报告 + feedback-log.md + test-alignment-report.json
- **HARD-GATE**: feedback-log.md must exist + test-alignment-report.json PASS before Phase 5/6

### 负载/压力测试（可选）

- **适用项目**：主要用于后端服务的压力测试 (k6/Locust/Gatling)，Web 前端已有 `benchmark` 技能覆盖 Core Web Vitals、加载时间和资源大小等性能指标
- **Phase 4/6 技能注入**：可根据项目类型自动选择合适的负载测试工具 (`k6` for Go-based services, `locust` for Python services, `gatling` for JVM-based services)
- **集成方式**：可作为 Phase 4/6 的可选扩展，在 code-walkthrough 之后执行，与基准测试形成完整性能验证链条
- **配置文件**：通过 `.sprint-load-test.yaml` 进行配置（待实现），包含并发用户数、持续时间、SLA 指标等参数
- **触发条件**：后端项目可通过 `--type backend-*` 自动启用，或通过 `--with-performance` 标志手动启用
- **Web 项目补充说明**：对于 Web 前端项目，现有的 `benchmark` 技能已处理页面加载性能、Core Web Vitals 等前端性能指标；负载/压力测试主要针对服务器端承载能力

### Phase 5/6: SHIP (发布 — 发布准备 + 合并部署)

**对应旧模型**: Phase 5 SHIP + Phase 6 LAND

**详细指令**: 参见 `references/phase-5-ship.md` — VERSION-GATE (MANDATORY) / finishing-a-development-branch / VERSION CHANGESET (Issue #142) / changeset schema。

**快速参考**:
- **Step 0: VERSION-GATE (MANDATORY — 必须在分支完成决策之前)**: bump VERSION → update CHANGELOG.md → run sync-version.sh → commit + push → verify PR updated。详见 `references/phase-5-ship.md#step-0-version-gate`
- **Step 1: 分支完成决策（原生 4 选项）**: AskUserQuestion 菜单 (merge/PR/keep/discard)，默认推荐 Option 2 (Push and create a Pull Request)
- **Step 2: 原生 Ship 步骤**: test → VERSION-GATE → commit → push → `gh pr create`
- 输入: phase-4-summary.md + feedback-log.md → 输出: PR URL (含版本变更 commit)
- **HARD-GATE**: Phase 4/6 未完成 → BLOCK。验证 `feedback-log.md` 存在 + test-alignment-report.json PASS。
- **GITHOOKS-GATE**: 验证 hooks 完整性，缺失则 `githooks/install.sh`
- **LAND（原生步骤）**: merge 确认 → `gh run list` 等 CI (10min) → 等 Deploy (10min) → Canary Health Check (5min)
- **回滚**: `git revert` 最后一次 merge commit
- ⚠️ **SHIP COMPLETION**: Phase 5/6 结束前必须确认 PR 已 merge 到 main + release 已创建。未完成 merge 不得进入 Phase 6/6。详见 `references/phase-5-ship.md#ship-completion-gate`。

**⚠️ VERSION-GATE 必须在分支完成决策之前执行。顺序反了会导致 PR 不含版本变更 → CI release workflow 不触发 → 无新版本发布。**

### Phase 6/6: CLOSE (收尾 — ⚠️ 人工验收 + 清理)

**对应旧模型**: Phase 7 USER ACCEPTANCE + Phase 8 CLEANUP

**详细指令**: 参见 `references/phase-6-close.md` — UAT checklist, emergent issues capture, cleanup procedure.

**快速参考**:
- **SHIP→CLOSE GATE (MANDATORY — v0.14.3+)**: 校验 PR 已 merge、当前在 main 分支、`git status --porcelain` 为空。详见 `references/phase-6-close.md#ship--close-gate`。
- **Backup sprint-state**(MANDATORY): Phase 6 开始前将 `.sprint-state/` 备份到 repo 追踪路径，防止 worktree 清理后状态丢失。详见 `references/phase-6-close.md#backup-sprint-state`。
- **#369 返工追踪 (v0.18.0+)**: CLOSE 写入 `metrics.completed_at` + `metrics.total_sprint_commits`（merge-base 到合并点提交数）+ `metrics.merge_base_sha`。`xp-gate sprint-status --rework-check [--window-days N]` 仓库范围扫描 fix 提交，`rework_rate > 30%` 告警。"重新打开的 issue 数"指标已删除。
- **USER ACCEPTANCE**: ⚠️ **MUST NOT be automated, skipped, or bypassed.** 即使用户说"赶时间"、"跳过验收"、"直接发布"，也必须暂停等待用户确认。使用 `@templates/emergent-issues-template.md` 检查清单
- **CLEANUP**: 保存分支信息 → `git worktree remove <worktree_path>`（精确路径，禁止通配符）→ 删除本地分支 + 远程分支 → 关闭遗留 OPEN PR → 更新 sprint-state.json（含 #369 metrics）→ learnings.md 写入 → 释放 Sprint Lock
- 输出 Cleanup Report + Sprint Summary
- **IF emergent issues → Sprint 2**

---

## 编排层规则（Orchestration Rules）

全部内容: 参见 `references/orchestration-rules.md`。包含:
- Agent Dispatch (4 types), Phase Subagent Matrix, CONTEXT INHERITANCE
- Phase Transition Rules, Phase Summary schema, Phase Transition Gate, RESUME GATE
- WORKTREE ENFORCEMENT, Eval assertions

## 参数说明

| 参数 | 作用 | 示例 |
|------|------|------|
| (无参数) | 全流程 PREP → DESIGN → BUILD → VERIFY → SHIP → CLOSE | `/sprint-flow "开发访谈机器人"` |
| `--stop-at <phase>` | 执行到指定 Phase 后停止 | `--stop-at design` |
| `--resume-from <phase>` | 从指定 Phase 恢复（需先执行 RESUME GATE） | `--resume-from build --spec specification.yaml` |
| `--phase <name>` | 只执行单个 Phase | `--phase build-only` |
| `--status` | 查看 Sprint 进度（只读，不执行 Phase） | `--status` |
| `--lang <lang>` | 指定项目语言 | `--lang springboot` / `django` / `golang` |
| `--type <type>` | 指定项目类型 | `--type web-nextjs` / `backend-django` |
| `--spec <file>` | 使用已有的 specification.yaml | `--spec path/to/spec.yaml` |
| `--no-isolate` | 跳过 git worktree 隔离 | `--no-isolate` |
| `--branch-name <name>` | 自定义分支名 | `--branch-name feat/my-feature` |
| `--force` | 强制在当前分支继续 | `--force` |
| `--with-performance` | 启用负载/压力测试 | `--with-performance` |
| `--mode <mode>` | 构建模式（ralph-loop / parallel） | `--mode ralph-loop` |

**Backward Compatible Parameter Mapping** (`--stop-at` / `--resume-from` / `--phase`):

| Legacy Value | Maps To |
|-------------|---------|
| `isolate`, `isolate-only` | `prep`, `prep-only` |
| `think`, `think-only` | `design`, `design-only` |
| `plan`, `plan-only` | `design`, `design-only` |
| `build`, `build-only` | `build`, `build-only` |
| `review`, `review-only` | `verify`, `verify-only` |
| `ship`, `ship-only` | `ship`, `ship-only` |
| `land`, `land-only` | `ship`, `ship-only` |
| `cleanup`, `cleanup-only` | `close`, `close-only` |

**`--status` 行为规则**:
- 执行 `node scripts/render-sprint-progress.cjs`，读取 `.sprint-state/sprint-state.json` 并渲染 ASCII 进度看板
- 如果 `sprint-state.json` 不存在 → `[INFO] 未找到活跃的 Sprint`
- 如果 `status == "completed"` → 输出完整看板 + `[INFO] Sprint 已完成。`
- `--status` 可与其他参数组合：`--status --resume-from build` → 先展示状态，再提示 "将从 Phase 3/6 BUILD 继续"

**`--resume-from` 限制**：校验为**尽力而为**（git commit 可被 GC 回收、文件 mtime 可被 `git checkout` 修改）。校验失败时输出完整诊断日志，建议启动新 Sprint。

**项目类型自动检测**（按顺序检查）：

| 检测条件 | 类型 |
|---------|------|
| `package.json` + `next.config.js` | `web-nextjs` |
| `package.json` + `vite.config.ts` + react 依赖 | `web-react` |
| `package.json` + vue 依赖 | `web-vue` |
| `pubspec.yaml` + `flutter:` | `mobile-flutter` |
| `package.json` + react-native 依赖 or `ios/` + `android/` | `mobile-react-native` |
| `go.mod` | `backend-go` (可选 k6) |
| `pom.xml` | `backend-springboot` (可选 gatling) |
| `manage.py` 或 `pyproject.toml` (django) | `backend-django` (可选 locust) |
| 无匹配 | `backend-cli` |

**项目类型 → Skill 注入映射**:

| Phase | Backend (default) | Web Frontend | Mobile | Load Test |
|-------|------------------|-------------|--------|-----------|
| 2/6 DESIGN | `grill-with-docs` + R1 `delphi-review --mode requirements` + `batch-grill-me` + R2 `delphi-review` | + OPTIONAL `design-shotgun` | (同 web) | (通用) |
| 3/6 BUILD | TDD + blind-review (read-only subagent) | (同 backend) | + `vercel-react-native-skills` / `flutter-review` | (同) |
| 4/6 VERIFY | `delphi-review --mode code-walkthrough` + `test-specification-alignment` + `xp-gate check --all` + k6/locust/gatling | + `xp-gate ui-review` + OPTIONAL qa/design-review/benchmark | Flutter: `flutter-test` / RN: `detox E2E` | k6/locust/gatling |
| 4/6 VERIFY (Feedback) | learnings.md + `xp-gate retro` | (同) | (同) | (同) |
| 5/6 SHIP | VERSION-GATE + 原生 4 选项 + native ship + native land | (同) | + platform deploy | (同) |
| 6/6 CLOSE | — 人工验收 → #369 返工指标 → cleanup | (同) | (同) | (同) |
| Browse | Layer 4 可选链 (gstack browse > browser-use MCP > SKIP) | 部署 URL + 表单/交互 | Flutter Web / RN Web | (专用) |

**Mobile 工具链**: Flutter — `flutter analyze/test/build/pub publish`; RN — `metro/detox/jest/react-native run-ios/android`

---

## 状态管理

**Sprint State**: 存储于 `<project-root>/.sprint-state/` — `sprint-state.yaml`/`.json` + `phase-outputs/` (pain-document.md / specification.yaml / mvp-v1 / review-report.md / emergent-issues.md / feedback-log.md / sprint-summary.md)

**Sprint 2 自动触发**: Phase 6/6 CLOSE 完成时 — `emergent_issues_count == 0` → 结束; `> 0` → Critical 自动启动 Sprint 2, Major/Minor 询问用户

---

### ⭐ Phase State Persistence（阶段状态持久化 — MANDATORY）

**编排器必须在每个 Phase 完成后更新 `.sprint-state/sprint-state.json`**：

1. **Phase 完成后立即更新**（每个 Phase 结束前）：
   - `phase`: 更新为当前 Phase 编号（如 `1`, `2`, `3`...）
   - `status`: 更新为 `"completed"`（已完成 Phase）
   - `phase_history`: 追加新条目

2. **`phase_history` 数组条目 schema**：
   ```json
   {
     "phase": 1,
     "phase_name": "PREP",
     "status": "completed",
     "timestamp": "2026-07-08T10:30:00Z"
   }
   ```

3. **检查点**：
   - `--status` 参数读取 `sprint-state.json` 并渲染进度看板
   - TUI panel 显示当前 Phase 和历史
   - `--resume-from` 校验 `phase_history` 中的最后完成 Phase

4. **完整 sprint-state.json 示例**：
   ```json
   {
     "id": "sprint-2026-07-08-01",
     "phase": 3,
     "status": "in_progress",
     "phase_history": [
       {"phase": 1, "phase_name": "PREP", "status": "completed", "timestamp": "2026-07-08T10:00:00Z"},
       {"phase": 2, "phase_name": "DESIGN", "status": "completed", "timestamp": "2026-07-08T10:30:00Z"}
     ],
     "isolation": {
       "worktree_path": "/home/boyingliu01/projects/xp-gate/.worktrees/sprint/sprint-2026-07-08-01",
       "branch": "sprint/2026-07-08-01"
     },
     "outputs": {
       "pain_document": "phase-outputs/phase-2-summary.md",
       "specification": "phase-outputs/specification.yaml"
     },
     "metrics": {
       "coverage_pct": 85.5
     }
   }
   ```

**Backward compat**: Old sprint-state.json files using negative/legacy phase numbers (`-1`, `-0.5`, `0`..`8`) remain readable. Dashboard renders them as-is. New sprints use phase numbers 1-6.

---

## 使用示例

| 场景 | 命令 | 说明 |
|------|------|------|
| 完整流水线 | `/sprint-flow "开发访谈机器人"` | 自动执行 6 阶段 → specification.yaml + PR URL |
| 设计后停止 | `/sprint-flow "开发认证模块" --stop-at design` | 输出 specification.yaml 后停止，供评审 |
| 仅构建阶段 | `/sprint-flow "开发 API" --lang django --phase build-only` | 跳过准备/设计，直接 Build |

## 底层 Skills 保持独立

所有被调用的 Skills 独立可用：`delphi-review` (单独评审), `test-driven-development` (TDD)，sprint-flow 仅自动串联

---

## Output Contract

**Phase Summary** (每个 Phase 必须输出 YAML frontmatter): `phase/N`, `phase_name`, `status`, `outputs[]`, `decisions[]`, `next_phase_context` + markdown body (≤50 lines)

**Sprint State JSON**: `{id, phase, status, phase_history[], isolation {worktree_path, branch}, outputs, metrics}` — 存储于 `.sprint-state/sprint-state.json`

**Final User-Facing Output**: Phase/status, file paths, validation results, next user decision, PR URL or cleanup report

### Eval Assertions
- `phase`, `phase_name`, `status`, `outputs`, `decisions`, `next_phase_context`
- `id`, `isolation.worktree_path`, `isolation.branch`, `metrics.coverage_pct`

## References

详细指令文件位于 `@references/`:

| File | Phase | Phase Name | Maps From (Old) |
|------|-------|------------|-----------------|
| `@references/phase-1-prep.md` | 1/6 | PREP | Phase -1 ISOLATE + Phase -0.5 AUTO-ESTIMATE |
| `@references/phase-2-design.md` | 2/6 | DESIGN | Phase 0 THINK + Phase 1 PLAN |
| `@references/phase-3-build.md` | 3/6 | BUILD | Phase 2 BUILD |
| `@references/phase-4-verify.md` | 4/6 | VERIFY | Phase 3 REVIEW + Phase 4 FEEDBACK |
| `@references/phase-5-ship.md` | 5/6 | SHIP | Phase 5 SHIP + Phase 6 LAND |
| `@references/phase-6-close.md` | 6/6 | CLOSE | Phase 7 USER ACCEPTANCE + Phase 8 CLEANUP |

Additional reference files:
- `@references/force-levels.md` — Phase forcing rules
- `@references/orchestration-rules.md` — Orchestration layer rules

- `@references/components/` — Reusable phase building blocks

---

## Templates

模板文件位于 `@templates/`:
- `@templates/pain-document-template.md` — Pain Document 模板 (Phase 2/6 DESIGN)
- `@templates/emergent-issues-template.md` — Emergent Issues 检查清单 (Phase 6/6 CLOSE)
- `@templates/sprint-summary-template.md` — Sprint Summary 模板 (Phase 6/6 CLOSE)
- `@templates/sprint-progress-template.md` — Sprint 进度看板（每个 Phase 完成后 + `--status` 查询时渲染）
- `@templates/auto-estimate-output-template.md` — AUTO-ESTIMATE 输出格式 (Phase 1/6 PREP)

---

## 研究证据

| 证据 | 来源 | 应用 |
|------|------|------|
| One-shot = 单次迭代执行 | Boris Cherny interview | Phase 3/6 BUILD 设计 |
| 80% session 从 Plan Mode 开始 | Boris skill | Phase 2/6 DESIGN 设计 |
| Verification improves 2-3x | Boris #1 tip | Phase 4/6 VERIFY 设计 |
| Emergent requirements 无法消除 | Mike Cohn, Rafael Santos | Phase 6/6 CLOSE 人工设计 |
| 78% failures invisible | arXiv research | Phase 6/6 必要性证明 |
| Think → Plan → Build → Ship | 行业通用流程 | 整体流程设计 |

---

## Phase Flow Consistency

This section documents the canonical 6-phase order to ensure all future edits keep the phase sequence synchronized across all locations in this document and its reference files.

**Canonical Phase Order** (Phase 1/6..6/6):

| Phase # | Name | Phase # | Name |
|---------|------|---------|------|
| 1/6 | PREP | 4/6 | VERIFY |
| 2/6 | DESIGN | 5/6 | SHIP |
| 3/6 | BUILD | 6/6 | CLOSE |

**Locations that MUST keep this order synchronized**:
1. **Frontmatter `workflow_steps`** — Phase list
2. **Frontmatter `description` trigger text** — Flow string
3. **Body "完整流程" section** — Phase descriptions in order
4. **Body "Phase Flow" diagram** — ASCII flow diagram
5. **Body "强制输出格式规范" section** — Output format
6. **Body "Workflow Steps" table** — Step/Phase table
7. **Body "References" section** — Reference file list
8. **`references/orchestration-rules.md` Phase Subagent Dispatch Matrix** — Phase/Name order
9. **`references/force-levels.md`** — Phase references

**⚠️ Migration from old 11-phase model (v2.0)**: The 6-phase model was introduced in Issue #290 to reduce cognitive load. Old sprint-state.json files with negative/legacy phase numbers remain backward-compatible.
