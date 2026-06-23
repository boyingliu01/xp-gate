---
name: sprint-flow
version: 1.0.0
description: >
  One-Shot Sprint 自动流水线。单一入口，自动串联 Think → Plan → Build → 
  Review → Ship 流程。整合 brainstorming + autoplan + delphi-review + TDD +
  delphi-review --mode code-walkthrough + ship 等现有 Skills。关键节点暂停等待用户决策。
  承认 Emergent Requirements 限制，设计用户验收环节。
  
  TRIGGER: 
  - "开发新功能"
  - "实现 X"
  - "start sprint"
  - "一键开发"
  - "/sprint-flow"
  触发后第一行输出: `Sprint Flow: ISOLATE → AUTO-ESTIMATE → THINK → PLAN → BUILD → REVIEW → USER ACCEPTANCE → FEEDBACK → SHIP → LAND → CLEANUP`
  用法: /sprint-flow "[需求描述]"
  示例: /sprint-flow "开发访谈机器人，支持多轮对话"
  可选参数:
  --no-isolate: 跳过自动 worktree 隔离（⚠️ 在保护分支上有污染风险）
  --branch-name <name>: 自定义分支名（默认自动生成 sprint/YYYY-MM-DD-NN）
  --force: 强制在当前分支继续（即使已是保护分支，⚠️ 输出警告）
  --stop-at <phase>: 执行到指定阶段后停止 (isolate/think/plan/build/review/ship/land/cleanup)
  --resume-from <phase>: 从指定阶段继续，跳过前面阶段
  --phase <phase>: 只执行单个阶段 (isolate-only/think-only/plan-only/build-only/review-only/ship-only/land-only/cleanup-only)
  --lang <language>: 指定项目语言 (springboot/django/golang)
  --type <project_type>: 指定项目类型 (web-nextjs/web-react/web-vue/mobile-flutter/mobile-react-native/backend-django/backend-go/backend-springboot)
  --spec <file>: 使用已有的 specification.yaml 文件
  --with-performance: 启用负载/压力测试（后端项目）
  --mode <build_mode>: 指定 Phase 2 构建模式。默认 = ralph-loop（逐 REQ 迭代，token 节约）。parallel = 旧有并行模式（一次性 dispatch 所有需求）
  --status: 查看当前 Sprint 进度看板（不执行任何阶段，仅读取 sprint-state.json 并渲染进度）
  Use when asked to "开发新功能", "实现 X", "start sprint", "一键开发", or "/sprint-flow" for end-to-end feature development.
maturity: beta
triggers:
  - "/sprint-flow"
  - "start sprint"
  - "开发新功能"
  - "实现 X"
  - "一键开发"
workflow_steps:
  - "Phase -1: ISOLATE"
  - "Phase -0.5: AUTO-ESTIMATE"
  - "Phase 0: THINK"
  - "Phase 1: PLAN"
  - "Phase 2: BUILD"
  - "Phase 3: REVIEW"
  - "Phase 4: USER ACCEPTANCE"
  - "Phase 5: FEEDBACK"
  - "Phase 6: SHIP"
  - "Phase 7: LAND"
  - "Phase 8: CLEANUP"
---

## Triggers

| Trigger Type | Phrases |
|--------------|---------|
| **中文** | "开发新功能", "实现 X", "start sprint", "一键开发", "/sprint-flow", "开发用户登录", "创建 XXX 模块" |
| **English** | "implement feature", "build X", "start sprint", "one-shot development", "create XXX", "develop new functionality" |

**Usage**: `/sprint-flow "[需求描述]"`

**Examples**:
- `/sprint-flow "开发访谈机器人，支持多轮对话"`
- `/sprint-flow "实现用户认证模块，支持 OAuth2"`
- `/sprint-flow "开发 REST API 端点"`

**Optional Parameters**:
- `--no-isolate`: Skip auto worktree isolation (⚠️ risk of polluting protected branches)
- `--branch-name <name>`: Custom branch name (default: `sprint/YYYY-MM-DD-NN`)
- `--force`: Force continue on current branch even if protected (⚠️ requires explicit confirmation)
- `--stop-at <phase>`: Stop after specified phase (isolate/think/plan/build/review/ship/land/cleanup)
- `--resume-from <phase>`: Resume from specified phase, skipping earlier phases
- `--phase <phase>`: Execute only single phase (isolate-only/think-only/plan-only/build-only/review-only/ship-only/land-only/cleanup-only)
- `--lang <language>`: Specify project language (springboot/django/golang)
- `--type <project_type>`: Specify project type (web-nextjs/web-react/web-vue/mobile-flutter/mobile-react-native/backend-django/backend-go/backend-springboot)
- `--spec <file>`: Use existing specification.yaml file
- `--with-performance`: Enable load/stress testing (backend projects)
- `--mode <build_mode>`: Phase 2 build mode. Default = ralph-loop (REQ-level iteration, token-efficient). parallel = legacy all-at-once mode

# Sprint Flow Skill

## Security Notes

- sprint-flow **不执行任何破坏性命令**（no `rm -rf`, `git push --force`, `DROP TABLE` 等）
- `git worktree remove` 仅删除 sprint 创建的临时 worktree 目录，不影响主仓库
- Phase 6 SHIP 仅创建 PR（`gh pr create`），不自动 merge（除非用户显式确认）
- Phase 7 LAND 使用 `gh pr merge --squash`（非 force push），merge 前等待 CI 通过
- 文档中 `+ platform deploy` 等描述仅表示可选的部署步骤映射，**不是可执行命令**
- sprint-flow 不下载、安装或执行任何外部二进制文件

## Permissions

- `git`: read/write (worktree, branch, commit)
- `gh` (GitHub CLI): read/write (PR create, merge, CI query)
- `filesystem`: read/write (project dir + `.worktrees/` only)
- `network`: read-only (CI status, canary health)

## 核心原则

| 原则 | 说明 |
|------|------|
| **单一入口** | 用户只需调用 `/sprint-flow`，自动串联全流程 |
| **自动流水线** | 类似 autoplan，自动执行多个阶段 |
| **关键节点暂停** | APPROVED 确认、Gate 1 通过、Ship 确认、⚠️ Phase 4 必须人工 |
| **承认 Emergent** | 用户验收环节必须人工，无法自动化（78% 失败不可见） |
| **复用现有 Skills** | 不重新发明，整合调用现有体系 |

---

## 完整流程（默认无参数）

调用 `/sprint-flow "[需求描述]"` 后，自动执行以下流程：

```
Phase -1: ISOLATE → 保护分支检测→强制worktree
Phase -0.5: AUTO-ESTIMATE → 展示评估结果→用户确认路由(轻量/标准/复杂)
Phase 0: THINK → brainstorming → ⚠️ HARD-GATE(设计未批准→阻断)
Phase 1: PLAN → autoplan → delphi-review(等待APPROVED)→specification.yaml
Phase 2: BUILD → GITHOOKS-GATE → ralph-loop/TDD → freeze/盲评→verification
Phase 3: REVIEW → delphi-review --mode code-walkthrough → test-alignment → browse
Phase 4: ⚠️ USER ACCEPTANCE → 必须人工验收 → Emergent Issues List
Phase 5: FEEDBACK → learn + retro + systematic-debugging
Phase 6: SHIP → finishing-a-development-branch → ship(PR)
Phase 7: ⚠️ LAND → land-and-deploy → merge + CI + canary
Phase 8: CLEANUP → worktree remove + branch delete + sprint summary
```

---

## 暂停点设计（不是随时停，而是设计明确的暂停点）

- **Phase -1**: 保护分支强制隔离 → 输出警告或自动创建 worktree → 自动恢复
- **Phase -0.5**: AUTO-ESTIMATE 结果展示 → 用户确认 → 按路由继续
- **Phase 0**: 设计未 APPROVED (HARD-GATE) → 用户修改 → APPROVED 后继续
- **Phase 1**: autoplan taste_decisions → 用户确认 / delphi-review 未APPROVED → 修复→APPROVED
- **Phase 2**: 验证失败>max3 → 用户决策修复/放弃 / 成本超阈值 → 用户确认
- **Phase 3**: browse 发现问题 → 回退 Phase 2（不暂停）
- **Phase 4**: ⚠️ 必须人工验收 → 用户确认后继续
- **Phase 5**: ⚠️ 不可跳过 (HARD-GATE) → feedback-log.md 生成后自动继续
- **Phase 6**: finishing-a-development-branch(4选项) → 确认; ship PR → 用户确认合并
- **Phase 7**: land-and-deploy 完成/失败 → 用户确认合并结果/处理部署失败
- **Phase 8**: worktree 清理完成/失败 → 用户确认 → 结束流程

---

## Workflow Steps

| Step | Phase | Name | Key Actions | Output |
|------|-------|------|-------------|--------|
| 1 | **-1** | **ISOLATE** | Detect protected branch → Create git worktree → Setup project → Validate .gitignore → Record sprint state | Worktree path |
| 2 | **-0.5** | **AUTO-ESTIMATE** | Analyze code structure → Count references → Assess cross-module impact → Classify (lightweight/standard/complex) | Impact assessment + flow recommendation |
| 3 | **0** | **THINK** | brainstorming → Generate design doc + CONTEXT.md + ADR | Design document |
| 4 | **1** | **PLAN** | autoplan → delphi-review (mandatory; lightweight allowed) → Generate specification.yaml + slices-manifest.json | specification.yaml |
| 5 | **2** | **BUILD** | GITHOOKS-GATE → ralph-loop (default) or parallel → TDD → freeze → blind review → verification | MVP code |
| 6 | **3** | **REVIEW** | delphi-review --mode code-walkthrough → test-specification-alignment → browse QA → benchmark (optional) | Review report |
| 7 | **4** | **USER ACCEPT** | **Manual verification** → Capture emergent issues | Emergent issues list |
| 8 | **5** | **FEEDBACK** | learn → retro → systematic-debugging | feedback-log.md |
| 9 | **6** | **SHIP** | finishing-a-development-branch → ship (create PR) | PR URL |
| 10 | **7** | **LAND** | land-and-deploy → merge PR → wait CI → canary health check → rollback on failure | Deploy status |
| 11 | **8** | **CLEANUP** | Safe worktree removal → Update sprint state → Sprint summary | Cleanup report |

**Phase Flow**:
```
ISOLATE → AUTO-ESTIMATE → THINK → PLAN → [GITHOOKS-GATE] → BUILD → REVIEW → USER ACCEPT → FEEDBACK → SHIP → LAND → CLEANUP
```

**Hard Gates**:
- **Phase 0→1**: Design must be APPROVED by delphi-review (≥90% consensus)
- **Phase 1→2**: GITHOOKS-GATE (hooks must be installed) + DELPHI-GATE (spec must be APPROVED)
- **Phase 4→5**: User acceptance must be completed (mandatory manual step)
- **Phase 5→6**: feedback-log.md must exist (HARD-GATE)

---

## 各 Phase 调用的 Skills

### ⚠️ 强制输出格式规范（Mandatory Output Format）

**执行每个 Phase 时，必须以以下固定格式输出阶段标题**，不可省略、不可合并、不可替换：

```markdown
## Phase -1: ISOLATE (隔离)
## Phase -0.5: AUTO-ESTIMATE (规模评估)
## Phase 0: THINK (思考)
## Phase 1: PLAN (规划)
## Phase 2: BUILD (构建)
## Phase 3: REVIEW (评审)
## Phase 4: USER ACCEPTANCE (用户验收)
## Phase 5: FEEDBACK (反馈)
## Phase 6: SHIP (发布)
## Phase 7: LAND (部署)
## Phase 8: CLEANUP (清理)
```

**规则**：
1. 每个 Phase **开始执行时必须首先输出**对应的 `## Phase X: NAME` 标题行（作为该 Phase 输出的第一行）
2. **禁止省略** "Phase" 关键词（如不能只写 "ISOLATE" 或 "## -1"）
3. **禁止合并**多个 Phase 的输出（每个 Phase 必须有独立标题）
4. **格式必须精确匹配**：`## Phase ` + 数字 + `: ` + 大写英文名 + ` (中文名)`
5. 跳过某个 Phase（如 `--resume-from build` 跳过了 -1, -0.5, 0, 1）时，不输出被跳过 Phase 的标题
6. 触发 `/sprint-flow` 后，**第一行输出应包含工作流阶段概览**：

```
Sprint Flow: ISOLATE → AUTO-ESTIMATE → THINK → PLAN → BUILD → REVIEW → USER ACCEPTANCE → FEEDBACK → SHIP → LAND → CLEANUP
```

### Phase -1: ISOLATE（git worktree 隔离）

**执行时机**: `/sprint-flow` 启动后 → Phase 0 THINK 前。**自动执行**。

**详细指令**: 参见 `references/phase-minus-1-isolate.md` — 包含步骤表、参数处理、错误回退、sprint-state 格式。

**快速参考**:
1. 检测保护分支 (main/master/develop) → 自动创建 worktree `.worktrees/sprint/sprint-YYYY-MM-DD-NN`
2. Sprint Lock 检测（Issue #144）— stale 锁自动覆盖，非 stale 阻断
3. 项目 setup (`npm install`/`go mod download`/`pip install`)
4. `.gitignore` 校验 + Sprint State 记录 + 基线测试
5. **参数**: `--no-isolate` (跳过)，`--branch-name <name>`，`--force` (绕过保护分支)

### Phase -0.5: AUTO-ESTIMATE（自动化规模评估与流程路由）

**执行时机**: Phase -1 ISOLATE 完成后 → Phase 0 THINK 前。**自动执行**。

**详细指令**: 参见 `references/phase-minus-0-5-auto-estimate.md` — 包含步骤、决策表、输出格式、纠偏机制。

**快速参考**:
1. 识别需求类型（删除/修改/新增/BugFix）→ 收集指标（引用计数、跨模块依赖、循环依赖）
2. 综合打分 → **轻量** (≤3 ref, 同模块) / **标准** (4-10 ref, 1-2 modules) / **复杂** (>10 ref 或循环依赖)
3. 输出评估结果（使用 `templates/auto-estimate-output-template.md`）→ 用户确认后路由至对应 Phase
4. **所有路由必须产生** `delphi-reviewed.json` (verdict: APPROVED) 才能进入 Phase 2 BUILD

### Phase 0: THINK（需求探索与设计）
- **Orchestrator 直接执行**: brainstorming 是交互式 skill，**必须由 orchestrator 直接调用** `skill(name="brainstorming")`，不可 dispatch 到 subagent（Issue #217, #225, #248）
- 输入: Phase -1 summary（worktree 路径）+ 用户原始需求
- 输出: 结构化设计文档 → 直接作为 Phase 1 PLAN 的输入
- **HARD-GATE**: 设计未批准 → 不可进入实现

### Phase 1: PLAN（共识评审）
- **注意**: `autoplan` 是交互式 skill（taste_decisions 节点暂停等待用户输入），**必须由 orchestrator 直接执行**（Issue #225, #248）
- **执行模式（两阶段）**:
  1. **Orchestrator 直接执行 autoplan**: `skill(name="autoplan")` → 用户确认 taste_decisions
  2. **Subagent 执行 delphi-review + to-issues**: `task(category="deep", load_skills=["delphi-review", "to-issues"])` — 非交互式，可在 subagent 中自动运行至 APPROVED
- 输入: phase-0-summary.md + 设计文档
- 输出: `specification.yaml`（含 user_stories[]）+ `slices-manifest.json`

**条件分支逻辑**:
- IF autoplan AUTO_APPROVED + 无 taste_decisions → 可执行 **lightweight delphi-review**（2 专家、1 轮、2/2 APPROVED，参考 `references/force-levels.md`）
- IF autoplan NEEDS_REVIEW OR taste_decisions > 0 → 调用标准 delphi-review（3 专家）
- **delphi-review 必须产生** `.sprint-state/delphi-reviewed.json` 且 `verdict = "APPROVED"` → 生成 specification.yaml（含 user_stories[]） → **调用 /to-issues** 拆解为垂直切片 → slices-manifest.json → Phase 2 按 execution_order 执行

### Phase 1→2: GITHOOKS-GATE（质量门禁安装检查）

**执行时机**: Phase 1 完全通过、准备进入 Phase 2 BUILD 之前.

**必须执行**: 运行 `githooks/verify.sh` 检查当前项目的 hooks 是否安装。

**检查结果处理**:
- ✅ 全部存在 → 进入 Phase 2 BUILD 入口（仍必须先执行 DELPHI-GATE）
- ❌ 部分/全部缺失 → 运行 `githooks/install.sh` 安装（包括 `.git/hooks/pre-commit`、`.git/hooks/pre-push`、`githooks/adapter-common.sh`、`githooks/adapters/`）
  - 如果 githooks/ 目录不存在于项目根目录（即当前项目不是 xp-gate） → 从 xp-gate 仓库拉取 `githooks/` 目录结构
  - 安装完成后再次 `verify.sh` 确认

**核心原则**: 没有质量门禁的代码不可进入 BUILD 阶段。**GITHOOKS-GATE 失败 → 不可编码。**

### Phase 2: BUILD（ralph-loop 默认 + TDD + 盲评 + 验证）

**详细指令**: 参见 `references/phase-2-build.md`。

**快速参考**:
1. **DELPHI-GATE**: 验证 `.sprint-state/delphi-reviewed.json` 存在且 `verdict = "APPROVED"` → 否则 BLOCK
2. **输入**: `slices-manifest.json`（Phase 1 生成），按 `execution_order` 逐个执行
3. **模式**: 默认 `ralph-loop`（逐 REQ 迭代，token 节约 40-67%），可选 `--mode parallel`
4. **Skill 步骤**: hooks-install → dispatching-parallel-agents → TDD (RED/GREEN/REFACTOR) → freeze → blind-review → unfreeze → verification-before-completion → 成本监控
5. **Mock Minimization**: integration-first, mock 仅限 external services, 密度 > 30% 需 `@mock-justified`

### Phase 3: REVIEW + TEST（验证）
- **Subagent dispatch**: orchestrator 通过 `task(category="deep", load_skills=["delphi-review", "test-specification-alignment"])` 启动独立 session
- 输入: phase-2-summary.md + MVP 代码
- 输出: 评审报告 + 测试对齐结果
- `delphi-review --mode code-walkthrough` — 多专家匿名代码走查
- `test-specification-alignment` — 测试与 Spec 对齐验证
- `browse` (gstack) — 浏览器自动化测试
- `k6` / `locust` / `gatling` — 负载/压力测试（可选，后端项目）

### 负载/压力测试（可选）
- **适用项目**：主要用于后端服务的压力测试 (k6/Locust/Gatling)，Web 前端已有 `benchmark` 技能覆盖 Core Web Vitals、加载时间和资源大小等性能指标
- **Phase 3 技能注入**：可根据项目类型自动选择合适的负载测试工具 (`k6` for Go-based services, `locust` for Python services, `gatling` for JVM-based services)  
- **集成方式**：可作为 Phase 3 的可选扩展，在 code-walkthrough 之后执行，与基准测试形成完整性能验证链条
- **配置文件**：通过 `.sprint-load-test.yaml` 进行配置（待实现），包含并发用户数、持续时间、SLA 指标等参数
- **触发条件**：后端项目可通过 `--type backend-*` 自动启用，或通过 `--with-performance` 标志手动启用
- **Web 项目补充说明**：对于 Web 前端项目，现有的 `benchmark` 技能已处理页面加载性能、Core Web Vitals 等前端性能指标；负载/压力测试主要针对服务器端承载能力

### Phase 4: USER ACCEPTANCE（⚠️ 人工验收）
- **无 Skill** — 必须人工
- ⚠️ **MUST NOT be automated, skipped, or bypassed under any circumstances**
- 即使用户说"赶时间"、"跳过验收"、"直接发布"，也必须暂停等待用户确认
- 使用 `@templates/emergent-issues-template.md` 检查清单

### Phase 5: FEEDBACK CAPTURE（反馈获取）
- **Subagent**: `task(category="quick", load_skills=["learn", "retro", "systematic-debugging"])`
- 输入: phase-4-summary.md + emergent-issues.md → 输出: `feedback-log.md`
- **HARD-GATE**: 不可跳过。`learn` (Sprint 级复盘, 默认提炼模板) + `retro` (工程回顾) + `systematic-debugging` (根因调试)

### Phase 6: SHIP（发布准备）

**详细指令**: 参见 `references/phase-6-ship.md` — GITHOOKS-GATE / VERSION-GATE / VERSION CHANGESET (Issue #142) / changeset schema。

**快速参考**:
- **Dispatch**: `task(category="quick", load_skills=["finishing-a-development-branch", "ship"])`
- 输入: phase-5-summary.md + feedback-log.md → 输出: PR URL
- **HARD-GATE**: Phase 5 未完成 → BLOCK。验证 `feedback-log.md` 存在。
- **GITHOOKS-GATE**: 验证 hooks 完整性，缺失则 `githooks/install.sh`
- **VERSION-GATE**: bump PATCH/MINOR/MAJOR → `sync-version.sh` → CHANGELOG.md → `git diff VERSION` 验证

### Phase 7:  LAND（合并 + 部署）

**详细指令**: 参见 `references/phase-7-land.md` — 完整流程、SLA 指标、回滚策略。

**快速参考**:
- **Dispatch**: `task(category="deep", load_skills=["land-and-deploy"])`
- 输入: phase-6-summary.md + PR URL → 输出: 部署状态 + Canary 报告
- 流程: Merge PR → 等待 CI (10min) → 等待 Deploy (10min) → Canary Health Check (5min)
- **回滚**: `git revert` 最后一次 merge commit
- 条件跳过: 无部署配置时仅 merge + CI

### Phase 8: CLEANUP（安全清理 + 总结）

**执行时机**: Phase 7 LAND 成功后。**详细指令**: 参见 `references/phase-8-cleanup.md`。

**快速参考**:
1. 保存分支信息 → `git worktree remove <worktree_path>`（精确路径，禁止通配符）
2. 删除本地分支 (`git branch -D`) + 远程分支 (`git push origin --delete`)
3. 关闭遗留 OPEN PR (`gh pr list --head`)
4. 更新 sprint-state.json (phase:8, status: merged) + 释放 Sprint Lock (Issue #144)
5. 输出 Cleanup Report + Sprint Summary
6. **IF emergent issues → Sprint 2**. **条件跳过**: `--no-isolate` 路径

---

## 编排层规则（Orchestration Rules）

全部内容: 参见 `references/orchestration-rules.md`。包含:
- Agent Dispatch (4 types), Phase Subagent Matrix, CONTEXT INHERITANCE
- Phase Transition Rules, Phase Summary schema, Phase Transition Gate, RESUME GATE
- WORKTREE ENFORCEMENT, Eval assertions

## 参数说明

| 参数 | 作用 | 示例 |
|------|------|------|
| (无参数) | 全流程 Think → Plan → Build → Review → Ship | `/sprint-flow "开发访谈机器人"` |
| `--stop-at <phase>` | 执行到指定 Phase 后停止 | `--stop-at plan` |
| `--resume-from <phase>` | 从指定 Phase 恢复（需先执行 RESUME GATE） | `--resume-from build --spec specification.yaml` |
| `--phase <name>` | 只执行单个 Phase | `--phase review-only` |
| `--status` | 查看 Sprint 进度（只读，不执行 Phase） | `--status` |
| `--lang <lang>` | 指定项目语言 | `--lang springboot` / `django` / `golang` |
| `--type <type>` | 指定项目类型 | `--type web-nextjs` / `backend-django` |
| `--spec <file>` | 使用已有的 specification.yaml | `--spec path/to/spec.yaml` |
| `--no-isolate` | 跳过 git worktree 隔离 | `--no-isolate` |
| `--branch-name <name>` | 自定义分支名 | `--branch-name feat/my-feature` |
| `--force` | 强制在当前分支继续 | `--force` |
| `--with-performance` | 启用负载/压力测试 | `--with-performance` |
| `--mode <mode>` | 构建模式（ralph-loop / parallel） | `--mode ralph-loop` |

**`--status` 行为规则**:
- 执行 `node scripts/render-sprint-progress.cjs`，读取 `.sprint-state/sprint-state.json` 并渲染 ASCII 进度看板
- 如果 `sprint-state.json` 不存在 → `[INFO] 未找到活跃的 Sprint`
- 如果 `status == "completed"` → 输出完整看板 + `[INFO] Sprint 已完成。`
- `--status` 可与其他参数组合：`--status --resume-from build` → 先展示状态，再提示 "将从 Phase 2 BUILD 继续"

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
| 0 THINK | `brainstorming` | (同) | (同) | (通用) |
| 1 PLAN | `autoplan` + `delphi-review` | + `design-shotgun` | (同 web) | (同) |
| 2 BUILD | TDD + blind-review | (同 backend) | + `vercel-react-native-skills` / `flutter-review` | (同) |
| 3 REVIEW | `delphi-review --mode code-walkthrough` + `test-specification-alignment` + k6/locust/gatling | + `qa` + `design-review` + `benchmark` | Flutter: `flutter-test` / RN: `detox E2E` | k6/locust/gatling |
| 5 FEEDBACK | `learn` + `retro` | (同) | (同) | (同) |
| 6 SHIP | `finishing-a-development-branch` + `ship` | (同) | + platform deploy | (同) |
| 7 LAND | `land-and-deploy` + canary | (同) | (同) | (同) |
| 8 CLEANUP | worktree remove + branch delete + state update | (同) | (同) | (同) |
| Browse | `localhost:3000` | 部署 URL + 表单/交互 | Flutter Web / RN Web | (专用) |

**Mobile 工具链**: Flutter — `flutter analyze/test/build/pub publish`; RN — `metro/detox/jest/react-native run-ios/android`

---

## 状态管理

**Sprint State**: 存储于 `<project-root>/.sprint-state/` — `sprint-state.yaml`/`.json` + `phase-outputs/` (pain-document.md / specification.yaml / mvp-v1 / review-report.md / emergent-issues.md / feedback-log.md / sprint-summary.md)

**Sprint 2 自动触发**: Phase 6 完成时 — `emergent_issues_count == 0` → 结束; `> 0` → Critical 自动启动 Sprint 2, Major/Minor 询问用户

---

### ⭐ Phase State Persistence（阶段状态持久化 — MANDATORY）

**编排器必须在每个 Phase 完成后更新 `.sprint-state/sprint-state.json`**：

1. **Phase 完成后立即更新**（每个 Phase 结束前）：
   - `phase`: 更新为当前 Phase 编号（如 `0`, `1`, `2`...）
   - `status`: 更新为 `"completed"`（已完成 Phase）
   - `phase_history`: 追加新条目

2. **`phase_history` 数组条目 schema**：
   ```json
   {
     "phase": 0,
     "phase_name": "THINK",
     "status": "completed",
     "timestamp": "2026-06-20T10:30:00Z"
   }
   ```

3. **检查点**：
   - `--status` 参数读取 `sprint-state.json` 并渲染进度看板
   - TUI panel 显示当前 Phase 和历史
   - `--resume-from` 校验 `phase_history` 中的最后完成 Phase

4. **完整 sprint-state.json 示例**：
   ```json
   {
     "id": "sprint-2026-06-20-01",
     "phase": 2,
     "status": "in_progress",
     "phase_history": [
       {"phase": -1, "phase_name": "ISOLATE", "status": "completed", "timestamp": "2026-06-20T10:00:00Z"},
       {"phase": -0.5, "phase_name": "AUTO-ESTIMATE", "status": "completed", "timestamp": "2026-06-20T10:05:00Z"},
       {"phase": 0, "phase_name": "THINK", "status": "completed", "timestamp": "2026-06-20T10:15:00Z"},
       {"phase": 1, "phase_name": "PLAN", "status": "completed", "timestamp": "2026-06-20T10:30:00Z"}
     ],
     "isolation": {
       "worktree_path": "/home/boyingliu01/projects/xp-gate/.worktrees/sprint/sprint-2026-06-20-01",
       "branch": "sprint/2026-06-20-01"
     },
     "outputs": {
       "pain_document": "phase-outputs/phase-0-summary.md",
       "specification": "phase-outputs/specification.yaml"
     },
     "metrics": {
       "coverage_pct": 85.5
     }
   }
   ```

---

## 使用示例

| 场景 | 命令 | 说明 |
|------|------|------|
| 完整流水线 | `/sprint-flow "开发访谈机器人"` | 自动执行 11 阶段 → specification.yaml + PR URL |
| 规划后停止 | `/sprint-flow "开发认证模块" --stop-at plan` | 输出 specification.yaml 后停止，供评审 |
| 仅构建阶段 | `/sprint-flow "开发 API" --lang django --phase build-only` | 跳过隔离/规划，直接 Build |

## 底层 Skills 保持独立

所有被调用的 Skills 独立可用：`delphi-review` (单独评审), `test-driven-development` (TDD)，sprint-flow 仅自动串联

---

## Anti-Patterns

| 错误 | 正确 |
|------|------|
| 把普通问答、解释、代码检索请求路由到 sprint-flow | 仅在用户明确要求开发/实现/一键开发完整需求时触发 sprint-flow |
| 跳过 Phase -1 隔离，直接在 main/master/develop 上改代码 | 默认创建 worktree；除非用户显式使用 `--no-isolate` 或 `--force` 并确认风险 |
| 未完成 Phase -0.5 AUTO-ESTIMATE 就套用完整重流程 | 先评估轻量/标准/复杂，再按推荐流程或用户确认后的流程执行 |
| Plan 阶段跳过 Delphi 评审直接 Build | 所有需求级别（轻量/标准/复杂）必须经过 autoplan + delphi-review；未 APPROVED 禁止编码 |
| 跳过 TDD 直接实现代码 | Phase 2 必须遵循 RED → GREEN → REFACTOR，测试与实现一起交付 |
| 跳过用户验收直接 Ship | Phase 4 USER ACCEPTANCE 必须人工完成；不得自动化、跳过或伪造 |
| 验证失败后继续追加随机修改 | 最多 3 次修复循环；仍失败则 BLOCK 并请求用户决策 |
| 未生成 Phase Summary 就进入下一阶段 | 每个 Phase 必须写入 `.sprint-state/phase-outputs/phase-{N}-summary.md` 并通过 transition gate |

## Output Format

See [Output Contract](#output-contract) below for the canonical machine-readable output schema.

### Eval Assertions
- `phase`, `phase_name`, `status`, `outputs`, `decisions`, `next_phase_context`
- `id`, `isolation.worktree_path`, `isolation.branch`, `metrics.coverage_pct`

## Output Contract

**Phase Summary** (每个 Phase 必须输出 YAML frontmatter): `phase/N`, `phase_name`, `status`, `outputs[]`, `decisions[]`, `next_phase_context` + markdown body (≤50 lines)

**Sprint State JSON**: `{id, phase, status, phase_history[], isolation {worktree_path, branch}, outputs, metrics}` — 存储于 `.sprint-state/sprint-state.json`

**Final User-Facing Output**: Phase/status, file paths, validation results, next user decision, PR URL or cleanup report

## References

详细指令文件位于 `@references/`:
- `@references/phase-minus-1-isolate.md` — Phase -1 详细指令
- `@references/phase-minus-0-5-auto-estimate.md` — Phase -0.5 详细指令
- `@references/phase-0-think.md` — Phase 0 详细指令
- `@references/phase-1-plan.md` — Phase 1 详细指令
- `@references/phase-2-build.md` — Phase 2 详细指令
- `@references/phase-3-review.md` — Phase 3 详细指令
- `@references/phase-4-uat.md` — Phase 4 详细指令（人工）
- `@references/phase-5-feedback.md` — Phase 5 详细指令
- `@references/phase-6-ship.md` — Phase 6 详细指令
- `@references/phase-7-land.md` — Phase 7 详细指令
- `@references/phase-8-cleanup.md` — Phase 8 详细指令

---

## Templates

模板文件位于 `@templates/`:
- `@templates/pain-document-template.md` — Pain Document 模板
- `@templates/emergent-issues-template.md` — Emergent Issues 检查清单
- `@templates/sprint-summary-template.md` — Sprint Summary 模板
- `@templates/sprint-progress-template.md` — Sprint 进度看板（每个 Phase 完成后 + `--status` 查询时渲染）

---

## 研究证据

| 证据 | 来源 | 应用 |
|------|------|------|
| One-shot = 单次迭代执行 | Boris Cherny interview | Phase 2 设计 |
| 80% session 从 Plan Mode 开始 | Boris skill | Phase 1 设计 |
| Verification improves 2-3x | Boris #1 tip | Phase 3 设计 |
| Emergent requirements 无法消除 | Mike Cohn, Rafael Santos | Phase 4 人工设计 |
| 78% failures invisible | arXiv research | Phase 4 必要性证明 |
| Think → Plan → Build → Ship | gstack ETHOS | 整体流程设计 |

