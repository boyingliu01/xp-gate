---
name: sprint-flow
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
  
  用法: /sprint-flow "[需求描述]"
  示例: /sprint-flow "开发访谈机器人，支持多轮对话"
  
  可选参数:
  --no-isolate: 跳过自动 worktree 隔离（⚠️ 在保护分支上有污染风险）
  --branch-name <name>: 自定义分支名（默认自动生成 sprint/YYYY-MM-DD-NN）
  --force: 强制在当前分支继续（即使已是保护分支，⚠️ 输出警告）
  --stop-at <phase>: 执行到指定阶段后停止 (isolate/think/plan/build/review/ship)
  --resume-from <phase>: 从指定阶段继续，跳过前面阶段
  --phase <phase>: 只执行单个阶段 (isolate-only/think-only/plan-only/build-only/review-only/ship-only)
  --lang <language>: 指定项目语言 (springboot/django/golang)
  --type <project_type>: 指定项目类型 (web-nextjs/web-react/web-vue/mobile-flutter/mobile-react-native/backend-django/backend-go/backend-springboot)
  --spec <file>: 使用已有的 specification.yaml 文件
  --with-performance: 启用负载/压力测试（后端项目）
  --mode <build_mode>: 指定 Phase 2 构建模式。默认 = ralph-loop（逐 REQ 迭代，token 节约）。parallel = 旧有并行模式（一次性 dispatch 所有需求）

maturity: beta
---

# Sprint Flow Skill

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
Phase -1: ISOLATE → ⚠️ 检测保护分支(main/master/develop/trunk/mainline) → 强制创建 git worktree
            → 已在 worktree 中 → 跳过 → 项目 setup → .gitignore 校验 → sprint-state isolation 记录
Phase 0: THINK → brainstorming → ⚠️ HARD-GATE: 设计未批准 → 不可进入实现 → Design Document
Phase 1: PLAN → autoplan → ⚠️ (如有taste_decisions，暂停等用户确认)
           → delphi-review → ⚠️ (等待 APPROVED)
           → 自动生成 specification.yaml（无需独立 skill）
Phase 2: BUILD → ⚠️ GITHOOKS-GATE: 检查并安装 Git Hooks（缺失→阻断）
           → dispatching-parallel-agents (并行检测) + executing-plans (隔离执行)
           → test-driven-development (RED→GREEN→REFACTOR)
           → freeze (盲评隔离) → requesting-code-review → unfreeze
           → verification-before-completion → ⚠️ (验证失败超过 max 3)
           → MVP v1
Phase 3: REVIEW → delphi-review --mode code-walkthrough → test-specification-alignment
           → browse → ⚠️ (验证失败)
Phase 4: ⚠️ ⚠️ USER ACCEPTANCE → 必须人工验收 → Emergent Issues List
Phase 5: FEEDBACK → learn + retro（工程回顾）+ systematic-debugging（根因调试）
Phase 6: SHIP → finishing-a-development-branch (4 选项) → ship / land-and-deploy
           → canary → Sprint Summary
           → IF emergent issues → Sprint 2
```

---

## 暂停点设计（不是随时停，而是设计明确的暂停点）

| 暂停点位置 | 触发条件 | 用户操作 | 自动恢复条件 |
|-----------|---------|---------|-------------|
| **Phase -1** | ⚠️ **保护分支强制隔离 / --no-isolate 跳过** | 输出 ⚠️ 警告或自动创建 worktree | 自动创建或用户确认后继续 |
| **Phase 0** | ⚠️ **设计未 APPROVED (HARD-GATE)** | 根据反馈修改设计 | 设计 APPROVED 后继续 |
| Phase 1 | autoplan surfacing taste_decisions | 用户确认每个决策 | 确认后自动继续 |
| Phase 1 | delphi-review 未 APPROVED | 修复并重新评审 | APPROVED 后自动继续 |
| Phase 2 | 验证失败超过 max 3 | 用户决定修复或放弃 | 验证通过后自动继续 |
| Phase 2 | 成本超阈值 | 用户决定继续或暂停 | 用户确认后自动继续 |
| Phase 3 | browse 发现问题 | 回退 Phase 2（不暂停） | 验证通过后自动继续 |
| **Phase 4** | ⚠️ **必须人工验收** | 用户实际使用后确认 | 用户确认后继续 |
| Phase 6 | finishing-a-development-branch | 用户选择 4 选项 (merge/PR/discard/keep) | 确认后自动继续 |
| Phase 6 | ship PR 创建（PR 路径）| 用户确认合并 | 合并后自动继续 |

---

## 各 Phase 调用的 Skills

### Phase -1: ISOLATE（git worktree 隔离）

**执行时机**: `/sprint-flow` 启动后、Phase 0 THINK 之前。**自动执行**。

**目的**: 默认在 git worktree 中隔离 sprint 工作，防止在保护分支上直接运行导致代码污染。

**AI agent 直接执行 bash 命令**（不需要调用外部 skill），步骤如下：

| 步骤 | 动作 | 说明 |
|------|------|------|
| 0 | **检测当前环境** | 运行 `git rev-parse --git-dir` 和 `git rev-parse --git-common-dir`。如果 `GIT_DIR != GIT_COMMON`：已在 worktree 中 → 输出 "Already in isolated worktree" → 进入 Phase 0 |
| 1 | **检查保护分支** | 获取当前分支名 `git branch --show-current`。保护分支列表: `main, master, develop, trunk, mainline`。保护分支 → 强制创建 worktree。非保护分支 → 依然创建 worktree（推荐，不阻断） |
| 2 | **创建 worktree** | 创建目录: `mkdir -p .worktrees/sprint`。检测已有 NN 编号: `ls .worktrees/sprint/ 2>/dev/null | grep -oE '[0-9]{2}$' | sort -n | tail -1`（取最后两位数字，数值排序，取最大），NN = 结果 + 1（无结果则从 01 开始）。运行 `git worktree add .worktrees/sprint/sprint-YYYY-MM-DD-NN -b sprint/YYYY-MM-DD-NN`。**注意**: `cd` 在 AI agent 单次工具调用中不保持状态，步骤 3-6 必须通过 `workdir` 参数或 `&&` 链式命令在新 worktree 目录下执行 |
| 3 | **项目 setup** | 在 worktree 目录下: 检测项目类型: `package.json` → `npm install`, `go.mod` → `go mod download`, `pyproject.toml` → `pip/poetry install` |
| 4 | **.gitignore 校验** | 在**仓库根目录**（非 worktree）执行: `git check-ignore -q .worktrees`。如果未忽略 → 将 `.worktrees/` 添加到 `.gitignore` → `git add .gitignore` → `git commit -m 'chore: ignore .worktrees directory'` |
| 5 | **Sprint State 记录** | `mkdir -p .sprint-state` 在 worktree 目录下。写入 `.sprint-state/sprint-state.json`（如已存在则合并，保留原有字段），新增/更新 `isolation` 对象，设置 `phase: -1`，`status: "running"` |
| 6 | **基线验证** | 在 worktree 目录下: 检测测试方式（package.json 有 "test" script → `npm test`, go.mod → `go test ./...`, pyproject.toml → `pytest`）。测试失败 → 输出失败信息 → 询问用户是否继续 |

**参数处理**:

- `--no-isolate`: 跳过自动创建，输出 ⚠️ 警告 `'[WARN] 未创建 worktree 隔离，在 {branch} 分支上直接运行 sprint 有污染风险'` → 进入 Phase 0
- `--branch-name <name>`: 使用自定义分支名（默认自动生成 `sprint/YYYY-MM-DD-NN`），分支名中的 `/` 在 worktree 路径中自动替换为 `-`（如 `feat/user-login` → 分支名 `feat/user-login`，路径 `.worktrees/sprint/feat-user-login`）
- `--force`: 强制在当前分支继续（即使已是保护分支），**要求用户显式确认**: 输出 ⚠️ 警告 `'[WARN] 使用 --force 在 {branch} 分支上直接运行 sprint。此操作绕过隔离保护，请确认风险。'` → 等待用户确认（"继续" / "取消"） → 确认后进入 Phase 0

**参数交互规则**:

| 参数组合 | 行为 |
|---------|------|
| `--no-isolate` 单独 | 跳过隔离，输出警告 → Phase 0 |
| `--force` 单独 | 跳过隔离，要求确认 → Phase 0 |
| `--no-isolate` + `--branch-name` | `--branch-name` 忽略，仅 `--no-isolate` 生效 |
| `--force` + `--branch-name` | `--branch-name` 忽略，仅 `--force` 生效 |
| `--no-isolate` + `--force` | 等效，输出 `--no-isolate` 警告 → Phase 0 |
| `--resume-from build` + `--no-isolate` | `--resume-from` 优先，直接跳过 Phase -1 |

**错误处理和回退**:
| 错误场景 | 回退行为 |
|---------|---------|
| `git worktree add` 失败（沙箱/权限问题） | 输出 `[ERROR] git worktree add 失败: {error}` → `[WARN] 无法创建 worktree 隔离，将在当前目录继续。请手动设置隔离分支。` → 在当前目录继续 |
| `.gitignore` 自动添加失败 | 输出 `[WARN] 无法自动添加 .gitignore，请手动将 .worktrees/ 添加到 .gitignore` → 继续 |
| 基线测试失败 | 输出 `[FAIL] 基线测试未通过:` + 失败详情 → 询问用户 `'基线测试失败，是否继续 sprint？(y/N)'` |

**sprint-state.json isolation 对象格式**:
```json
{
  "isolation": {
    "worktree_path": ".worktrees/sprint/sprint-2026-05-24-01",
    "branch": "sprint/2026-05-24-01",
    "created_from": "main",
    "created_from_commit": "abc123def..."
  }
}
```

> **清理提示**: Sprint 完成（Phase 6 SHIP）后，执行 `git worktree remove <worktree_path>` 清理 worktree 目录，同时保留 `.sprint-state/` 中的历史记录。

### Phase 0: THINK（需求探索与设计）
- `brainstorming` (superpowers) — **HARD-GATE**: 设计未批准 → 不可进入实现
- 输出: 结构化设计文档 → 直接作为 Phase 1 PLAN 的输入
- 替代原因: office-hours 的 YC 六问适合新产品方向验证，brainstorming 的"设计批准才可进入实现"机制更适合 sprint-flow 场景

### Phase 1: PLAN（共识评审）
- `autoplan` (gstack) — CEO → Design → Eng 自动流水线
- `delphi-review` — 多轮匿名评审直到共识
- `to-issues` — 将 APPROVED 的 PRD/spec 拆解为垂直切片 Issue（HITL/AFK + 依赖图 + effort 估算）
- **specification.yaml** — 自动生成（含 User Stories 段）

**条件分支逻辑**:
- IF autoplan AUTO_APPROVED + 无 taste_decisions → 跳过 delphi-review
- IF autoplan NEEDS_REVIEW OR taste_decisions > 0 → 调用 delphi-review
- delphi-review APPROVED → 生成 specification.yaml（含 user_stories[]） → **调用 /to-issues** 拆解为垂直切片 → slices-manifest.json → Phase 2 按 execution_order 执行

### Phase 1→2: GITHOOKS-GATE（质量门禁安装检查）

**执行时机**: Phase 1 完全通过、准备进入 Phase 2 BUILD 之前.

**必须执行**: 运行 `githooks/verify.sh` 检查当前项目的 hooks 是否安装。

**检查结果处理**:
- ✅ 全部存在 → 直接进入 Phase 2 BUILD
- ❌ 部分/全部缺失 → 运行 `githooks/install.sh` 安装（包括 `.git/hooks/pre-commit`、`.git/hooks/pre-push`、`githooks/adapter-common.sh`、`githooks/adapters/`）
  - 如果 githooks/ 目录不存在于项目根目录（即当前项目不是 xp-gate） → 从 xp-gate 仓库拉取 `githooks/` 目录结构
  - 安装完成后再次 `verify.sh` 确认

**核心原则**: 没有质量门禁的代码不可进入 BUILD 阶段。**GITHOOKS-GATE 失败 → 不可编码。**

### Phase 2: BUILD（ralph-loop 默认 + TDD + 盲评 + 验证）

**输入**: `slices-manifest.json`（由 Phase 1 `/to-issues` 生成），按 `execution_order` 逐个执行。

**默认模式**: `ralph-loop` — 逐 REQ/切片 迭代构建。每个切片（REQ）dispatch 独立 subagent，干净上下文，全量回归测试。Token 节约 40-67%。参见 `skills/ralph-loop/SKILL.md`。

**并行模式**: 通过 `--mode parallel` 启用 `dispatching-parallel-agents`。仅分发无依赖的 AFK 切片（通过 `dependency_graph` 判定）。HITL 切片需人工确认后才可分发。

**替代原 xp-consensus**：使用 superpowers 成熟 skill 组合，保留关键行为（freeze 隔离、熔断回退、成本监控）。

| 步骤 | Skill | 说明 |
|------|-------|------|
| -1 | **`hooks-install`** _(githooks/scripts)_ | `githooks/verify.sh` → 缺失则 `githooks/install.sh` |
| 0 | **`dispatching-parallel-agents`** _(superpowers)_ | 检测可并行任务，并行分发独立子任务 |
| 1 | `test-driven-development` (superpowers) | RED → GREEN → REFACTOR 铁律执行 |
| 2 | **`executing-plans`** _(superpowers)_ | 在隔离 session 中执行计划，有 review checkpoint |
| 3 | `freeze` (gstack) | 锁定业务代码，盲评 agent 只能访问测试 |
| 4 | `requesting-code-review` (superpowers) | 独立 agent 盲评业务代码（隔离状态） |
| 5 | `unfreeze` (gstack) | 解锁业务代码 |
| 6 | `verification-before-completion` (superpowers) | 运行测试 + lint，证据优先 |
| 7 | 成本监控（sprint-flow 编排层） | 超阈值 BLOCK + 用户决策 |

**关键行为保留**（原 xp-consensus 17 状态机中的真实边缘情况）：

| 原状态 | 新处理方案 |
|--------|-----------|
| `CIRCUIT_BREAKER_TRIGGERED` | sprint-flow 编排层监控成本，超阈值 BLOCK + 用户决策 |
| `ROLLBACK_TO_ROUND1` | verification-before-completion 失败 → 修复 max 3 次 → 仍失败 BLOCK |
| `GATE1_FAILED`/`GATE1_COMPLETE` | verification-before-completion 内置此区分 |
| `GATE2_RUNNING` | `cso` (gstack) — Phase 1-6 安全审计替代 |
| `SEALED_CODE_ISOLATION` | 保留 freeze skill 调用 |

**语言特定 TDD**：通过 `--lang` 参数选择：
- `springboot-tdd` / `django-tdd` / `golang-testing`

### Phase 3: REVIEW + TEST（验证）
- `delphi-review --mode code-walkthrough` — 多专家匿名代码走查（代替 cross-model-review）
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

### Phase 5: FEEDBACK CAPTURE（反馈捕获）
- `learn` (gstack) — 模式记录
- `retro` (gstack) — 工程回顾：提交历史、工作模式、代码质量趋势
- `systematic-debugging` (superpowers) — 根因调试（反馈中的 bug 做根因分析，Iron Law：无调查无修复）

### Phase 6: SHIP + DEPLOY（发布）
- **⚠️ GITHOOKS-GATE**: 再次验证 hooks 完整性（Phase 2 的 TDD 编码已触发提交，SHIP 阶段还会再次提交）
  - 运行 `githooks/verify.sh` → 缺失 → `githooks/install.sh` → 阻断直至修复
- **`finishing-a-development-branch`** (superpowers) — 结构化完成流：4 选项（merge / PR / discard / keep）
- `ship` (gstack) — 创建 PR（PR 路径时使用）
- `land-and-deploy` (gstack) — 合并部署
- `canary` (gstack) — 监控告警

---

## Output Format (MANDATORY)
Sprint state is persisted as JSON in `.sprint-state/sprint-state.json`:
```json
{
  "id": "sprint-2026-04-26-01",
  "phase": -1,
  "status": "running|paused|completed",
  "isolation": {
    "worktree_path": ".worktrees/sprint/sprint-2026-04-26-01",
    "branch": "sprint/2026-04-26-01",
    "created_from": "main",
    "created_from_commit": "abc123def..."
  },
  "outputs": {
    "pain_document": "docs/pain-document.md",
    "specification": "specification.yaml",
    "mvp": "mvp-v1/",
    "review_report": "review-report.md"
  },
  "metrics": {
    "tests_passed": 15,
    "tests_failed": 0,
    "coverage_pct": 85
  }
}
```
**Eval assertions check for:** `phase`, `status`, `isolation.branch`, `outputs.specification`, `metrics.coverage_pct`.

---

## 参数说明

### 默认用法（无参数）

```bash
/sprint-flow "开发访谈机器人，支持多轮对话"

# 自动执行 Think → Plan → Build → Review → Ship 全流程
# 关键节点暂停等待用户确认
```

### --stop-at（执行到某阶段后停止）

```bash
/sprint-flow "开发访谈机器人" --stop-at plan
# → Think → Plan → 输出 specification.yaml → 停止
# 适用场景：先评审方案，后续手动决定是否继续
```

### --resume-from（从某阶段继续）

```bash
/sprint-flow "继续 Sprint" --resume-from build --spec specification.yaml
# → 跳过 Think + Plan，直接从 Build 开始
# 适用场景：中断恢复，使用已有的 specification.yaml
```

### --phase（只执行单个阶段）

```bash
/sprint-flow "评审代码" --phase review-only
# → 只执行 Phase 3 的评审
# 适用场景：单独验证某个阶段
```

### --lang（指定项目语言）

```bash
/sprint-flow "开发用户认证模块" --lang springboot
# Phase 2 自动调用 springboot-tdd + springboot-verification

/sprint-flow "开发 REST API" --lang django
# Phase 2 自动调用 django-tdd + django-verification

/sprint-flow "开发并发任务调度器" --lang golang
# Phase 2 自动调用 golang-testing
```

### --type（指定项目类型）

```bash
/sprint-flow "开发用户登录页面" --type web-nextjs
/sprint-flow "开发 REST API" --type backend-django
# 默认: 从项目文件自动检测
```

 自动检测逻辑（按顺序检查）：
 
| 检测条件 | 类型 |
|---------|------|
| `package.json` + `next.config.js` | `web-nextjs` |
| `package.json` + `vite.config.ts` + `react` 依赖 | `web-react` |
| `package.json` + `vue` 依赖 | `web-vue` |
| `pubspec.yaml` + `flutter:` | `mobile-flutter` |
| `package.json` + `react-native` 依赖 or `ios/` + `android/` | `mobile-react-native` |
| `go.mod` | `backend-go` （可选 k6 负载测试）|
| `pom.xml` | `backend-springboot` （可选 gatling 负载测试）|
| `manage.py` 或 `pyproject.toml` (django) | `backend-django` （可选 locust 负载测试）|
| 无匹配 | `backend-cli` |

### 项目类型到 Skill 注入映射

| Phase | Backend (default) | Web Frontend | Mobile | Load/Performance Testing |
|-------|------------------|-------------|--------|--------------------------|
| Phase 0 (THINK) | `brainstorming` | (同) | (同) | (通用) |
| Phase 1 (PLAN) | `autoplan` + `delphi-review` | + `design-shotgun` | (同 web) | (同) |
| Phase 2 (BUILD) | TDD + blind-review | (同 backend) | + `vercel-react-native-skills` (RN) / `flutter-review` (Flutter) | (同) |
| Phase 3 (REVIEW) | `delphi-review --mode code-walkthrough` + `test-specification-alignment` + `k6` / `locust` / `gatling` | + `qa` + `design-review` + `benchmark` | Flutter: `flutter-test` / RN: `detox E2E` | k6/locust/gatling (补充 API 测试后的负载测试验证) |
| Phase 5 (FEEDBACK) | `learn` + `retro` | (同) | (同) | (同) |
| Phase 6 (SHIP) | `finishing-a-development-branch` + `ship` | (同) | + platform deploy (可选) | (同) |
| Browse | `localhost:3000` | 部署 URL + 表单/交互 | Flutter Web / RN Web 测试 | (专用负载测试) |

**Mobile 专属工具链**:
- **Flutter**: `flutter analyze`, `flutter test`, `flutter build`, `pub publish`
- **React Native**: `metro`, `detox`, `jest`, `react-native run-ios/android`

---

## 状态管理

### Sprint State

```yaml
Sprint State:
  id: sprint-YYYY-MM-DD-NN
  phase: [-1, 0-6]        # -1=ISOLATE, 0-6=各阶段
  status: [pending, running, paused, completed, failed]  # 统一状态
  pause_reason: [none, wait_isolation, wait_approved, wait_gate1, wait_uat, wait_ship, wait_user_confirm]
  isolation:               # Phase -1 隔离信息
    worktree_path: .worktrees/sprint/sprint-YYYY-MM-DD-NN
    branch: sprint/YYYY-MM-DD-NN
    created_from: main
    created_from_commit: abc123def...

存储位置: <project-root>/.sprint-state/
  ├─ sprint-state.yaml          # 当前 Sprint 状态
  ├─ sprint-state.json          # 当前 Sprint 状态 (JSON 格式，同上)
  └─ phase-outputs/
      ├─ pain-document.md       # Phase 0 输出
      ├─ specification.yaml     # Phase 1 输出
      ├─ mvp-v1/                # Phase 2 输出
      ├─ review-report.md       # Phase 3 输出
      ├─ emergent-issues.md     # Phase 4 输出
      ├─ feedback-log.md        # Phase 5 输出
      └─ sprint-summary.md      # Phase 6 输出
```

### Sprint 2 自动触发机制

```yaml
Sprint 结束时 (Phase 6 完成):
  IF emergent_issues_count == 0 → sprint_completed，结束流程
  IF emergent_issues_count > 0 → sprint_2_needed:
    ├─ IF emergent_issues 有 Critical → 自动启动 Sprint 2
    ├─ IF emergent_issues 仅 Major/Minor → 询问用户
    └─ Sprint 2 Pain Document 自动从 emergent-issues.md 转化
```

---

## 使用示例

### 示例 1：完整流程

```bash
/sprint-flow "开发访谈机器人，支持多轮对话"

# 输出：
# Phase 0: brainstorming 需求探索 → 设计文档 → ⚠️ HARD-GATE: 等待用户 APPROVED
# 用户 APPROVED → 自动进入 Phase 1
# Phase 1: autoplan 发现 2 个 taste_decisions → ⚠️ 暂停
# 用户确认决策后 → delphi-review → Round 1 REQUEST_CHANGES
# 修复 → Round 2 APPROVED → specification.yaml
# Phase 2: TDD + freeze + review → verification → MVP v1
# Phase 3: cross-model-review APPROVED → browse QA 通过
# Phase 4: ⚠️ 用户验收 → 发现 1 个 Major emergent issue
# Phase 5: learn → 记录 → Sprint 2 Pain Document
# Phase 6: ship → PR → 用户确认合并 → canary 监控
# → Sprint Summary → 发现 emergent issue → 提示是否开始 Sprint 2
```

### 示例 2：中断恢复

```bash
# 第一次：执行到 Plan 后停止
/sprint-flow "开发用户认证模块" --stop-at plan
# → 输出 specification.yaml

# 第二次：三天后继续
/sprint-flow "继续开发" --resume-from build --spec docs/specification.yaml
# → 跳过 Think + Plan，直接从 Build 开始
```

### 示例 3：语言特定

```bash
/sprint-flow "开发 REST API" --lang django
# Phase 2 自动调用 django-tdd + django-verification
# Gate 1 包含 Django 特定的验证（migrations, linting, coverage）
```

### 示例 4：使用 --mode parallel（旧有并行模式）

```bash
/sprint-flow "修改单行配置" --mode parallel
# 小改动可使用旧有并行模式，一次 dispatch 完成
# 注意：默认 ralph-loop 模式已覆盖绝大多数场景
```

### 示例 4b：仅验证隔离（--stop-at isolate）

```bash
/sprint-flow "开发用户登录" --stop-at isolate
# → 仅执行 Phase -1 ISOLATE
# → 检测 main 分支 → 创建 worktree → setup → .gitignore → baseline
# → 输出 worktree 路径 → 停止
# 适用场景：手动验证隔离是否正常创建，后续手动决定是否继续
```

### 示例 5：Worktree 隔离（默认行为）

```bash
/sprint-flow "开发用户登录"
# Phase -1 ISOLATE:
# → 检测当前在 main 分支（保护分支）→ 强制创建 worktree
# → mkdir -p .worktrees/sprint
# → 检测已有 NN 编号（.worktrees/sprint/ | grep -oE '[0-9]{2}$' | sort -n | tail -1）
# → git worktree add .worktrees/sprint/sprint-2026-05-24-01 -b sprint/2026-05-24-01
# → 在 worktree 目录下: npm install → 基线测试 → .sprint-state/ 记录
# → 进入 Phase 0 THINK...

# 跳过隔离（⚠️ 有污染风险）
/sprint-flow "开发用户登录" --no-isolate
# → [WARN] 未创建 worktree 隔离，在 main 分支上直接运行 sprint 有污染风险
# → 直接进入 Phase 0

# 强制跳过（需用户确认）
/sprint-flow "开发用户登录" --force
# → [WARN] 使用 --force 在 main 分支上直接运行 sprint → 等待用户确认 → 确认后进入 Phase 0

# 自定义分支名
/sprint-flow "开发用户登录" --branch-name feat/user-login
# → 分支名: feat/user-login（保留 /）
# → worktree 路径: .worktrees/sprint/feat-user-login（/ 替换为 -）

# 🧹 Sprint 完成后清理
git worktree remove .worktrees/sprint/sprint-2026-05-24-01
```

---

## 底层 Skills 保持独立

所有被调用的 Skills 保持独立可用：
- 用户可以直接调用 `delphi-review` 单独评审
- 用户可以直接调用 `test-driven-development` 单独执行 TDD
- sprint-flow 只是自动串联调用，不替代底层 Skills

---

## References

详细指令文件位于 `@references/`:
- `@references/phase-minus-1-isolate.md` — Phase -1 详细指令
- `@references/phase-0-think.md` — Phase 0 详细指令
- `@references/phase-1-plan.md` — Phase 1 详细指令
- `@references/phase-2-build.md` — Phase 2 详细指令
- `@references/phase-3-review.md` — Phase 3 详细指令
- `@references/phase-4-uat.md` — Phase 4 详细指令（人工）
- `@references/phase-5-feedback.md` — Phase 5 详细指令
- `@references/phase-6-ship.md` — Phase 6 详细指令

---

## Templates

模板文件位于 `@templates/`:
- `@templates/pain-document-template.md` — Pain Document 模板
- `@templates/emergent-issues-template.md` — Emergent Issues 检查清单
- `@templates/sprint-summary-template.md` — Sprint Summary 模板

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
