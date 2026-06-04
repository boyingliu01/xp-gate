---
name: sprint-flow
description: >
  Use when asked to "开发新功能", "实现 X", "start sprint", "一键开发", or "/sprint-flow" for end-to-end feature development.
maturity: beta
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

---

## Scope

**What this skill does**:
- Automates the full 7-phase development pipeline from requirement to production
- Integrates existing skills (brainstorming, autoplan, delphi-review, TDD, ship, etc.)
- Enforces quality gates and hard transitions between phases
- Captures emergent requirements and feedback for continuous improvement

**What this skill does NOT do**:
- Replace individual skills — users can still call `delphi-review`, `test-driven-development`, etc. directly
- Bypass quality gates or user confirmations at critical checkpoints
- Automatically merge to main without explicit user approval (Phase 6/7)
- Handle non-development tasks (bug reports, code review requests without implementation, questions)

**Applicable scenarios**:
- New feature development
- Module creation
- End-to-end implementation of user stories
- Sprint-level planning and execution

**Not applicable**:
- Single bug fixes (use `/investigate` or direct TDD)
- Code review requests (use `/review` or `delphi-review --mode code-walkthrough`)
- Architecture questions (use `/plan-eng-review`)
- Simple explanations or documentation requests

## Examples

### Example 1: Full feature sprint
User: `/sprint-flow "开发用户认证模块，支持登录、登出、权限检查"`
Expected behavior: create/verify isolated worktree, run estimate, produce design/spec, build with TDD, review, wait for manual acceptance, then prepare ship path.
Expected output: phase summaries, `specification.yaml`, verification evidence, and PR URL if the user chooses PR shipping.

### Example 2: Stop after planning
User: `/sprint-flow "开发 REST API" --stop-at plan`
Expected behavior: complete isolate/estimate/think/plan, produce specification and slices, then stop without implementation.
Expected output: phase-1 summary and clear next command to resume from build.

### Example 3: Should not trigger
User: "解释一下这个函数为什么报错"
Expected behavior: do not run sprint-flow; route to investigation/explanation instead.

# Sprint Flow Skill

## Scope

**In Scope:**
- Sprint 全流程编排（Phase -1 ISOLATE 到 Phase 8 CLEANUP）
- Git worktree 隔离与环境准备
- 自动规模评估与流程路由（轻量/标准/复杂）
- 多 Skill 串联调用（brainstorming, autoplan, delphi-review, TDD, ralph-loop 等）
- 关键节点暂停与用户决策
- 状态持久化（sprint-state.json）
- 多平台适配（Claude Code, OpenCode, Qoder）

**Out of Scope:**
- Does NOT handle internal Skill implementation (each Skill remains independent)
- Does NOT write business code
- Does NOT configure CI/CD pipelines (project's own responsibility)
- Does NOT deploy to production (only up to PR creation + merge)

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
Phase -1: ISOLATE → ⚠️ 检测保护分支(main/master/develop/trunk/mainline) → 强制创建 git worktree
            → 已在 worktree 中 → 跳过 → 项目 setup → .gitignore 校验 → sprint-state isolation 记录
Phase -0.5: AUTO-ESTIMATE → 自动评估需求规模 → ⚠️ 展示评估结果，用户确认
            → 轻量：跳过 brainstorming + delphi-review，直接 Phase 2 BUILD
            → 标准：正常流程 Phase 0-4
            → 复杂：完整流程 Phase 0-8 + 风险警告
Phase 0: THINK → brainstorming → ⚠️ HARD-GATE: 设计未批准 → 不可进入实现 → Design Document (AI编辑行为约束: 原则3 Surgical Changes, 验证循环要求: 原则4 Goal-Driven Execution - 见 AGENTS.md "## AI CODING DISCIPLINE (Karpathy Principles)")
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
Phase 6: SHIP → finishing-a-development-branch (4 选项) → ship (PR 路径)
            → PR 创建完成
Phase 7: ⚠️ LAND → land-and-deploy → merge PR + wait CI + canary health check
            → deploy verification + auto-rollback on failure
Phase 8: CLEANUP → git worktree remove + sprint-state.json update → status: merged
            → Sprint Summary → IF emergent issues → Sprint 2
```

---

## 暂停点设计（不是随时停，而是设计明确的暂停点）

| 暂停点位置 | 触发条件 | 用户操作 | 自动恢复条件 |
|-----------|---------|---------|-------------|
| **Phase -1** | ⚠️ **保护分支强制隔离 / --no-isolate 跳过** | 输出 ⚠️ 警告或自动创建 worktree | 自动创建或用户确认后继续 |
| **Phase -0.5** | **AUTO-ESTIMATE 结果展示** | 接受建议 / 修改流程 / 取消 | 用户确认后按路由继续 |
| **Phase 0** | ⚠️ **设计未 APPROVED (HARD-GATE)** | 根据反馈修改设计 | 设计 APPROVED 后继续 |
| Phase 1 | autoplan surfacing taste_decisions | 用户确认每个决策 | 确认后自动继续 |
| Phase 1 | delphi-review 未 APPROVED | 修复并重新评审 | APPROVED 后自动继续 |
| Phase 2 | 验证失败超过 max 3 | 用户决定修复或放弃 | 验证通过后自动继续 |
| Phase 2 | 成本超阈值 | 用户决定继续或暂停 | 用户确认后自动继续 |
| Phase 3 | browse 发现问题 | 回退 Phase 2（不暂停） | 验证通过后自动继续 |
| **Phase 4** | ⚠️ **必须人工验收** | 用户实际使用后确认 | 用户确认后继续 |
| **Phase 5** | ⚠️ **必须执行，不可跳过 (HARD-GATE)** | Phase 5 完成后进入 Phase 6 | `feedback-log.md` 生成后自动继续 |
| Phase 6 | finishing-a-development-branch | 用户选择 4 选项 (merge/PR/discard/keep) | 确认后自动继续 |
| Phase 6 | ship PR 创建（PR 路径）| 用户确认合并 | 合并后自动继续 |
| **Phase 7** | **land-and-deploy 完成/失败** | **用户确认合并结果 / 处理部署失败** | **确认/修复后继续** |
| **Phase 8** | **worktree 清理完成/失败** | **用户确认清理 / 手动处理残留** | **确认后结束流程** |

---

## Workflow Steps

| Step | Phase | Name | Key Actions | Output |
|------|-------|------|-------------|--------|
| 1 | **-1** | **ISOLATE** | Detect protected branch → Create git worktree → Setup project → Validate .gitignore → Record sprint state | Worktree path |
| 2 | **-0.5** | **AUTO-ESTIMATE** | Analyze code structure → Count references → Assess cross-module impact → Classify (lightweight/standard/complex) | Impact assessment + flow recommendation |
| 3 | **0** | **THINK** | brainstorming → Generate design doc + CONTEXT.md + ADR | Design document |
| 4 | **1** | **PLAN** | autoplan → delphi-review (if needed) → Generate specification.yaml + slices-manifest.json | specification.yaml |
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
- **Phase 0→1**: Design must be APPROVED by delphi-review (≥91% consensus)
- **Phase 1→2**: GITHOOKS-GATE (hooks must be installed) + DELPHI-GATE (spec must be APPROVED)
- **Phase 4→5**: User acceptance must be completed (mandatory manual step)
- **Phase 5→6**: feedback-log.md must exist (HARD-GATE)

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

### Phase -0.5: AUTO-ESTIMATE（自动化规模评估与流程路由）

**执行时机**: Phase -1 ISOLATE 完成后、Phase 0 THINK 之前。**自动执行**。

**目的**: 自动评估需求规模，匹配适度流程，避免小需求走重量级流程造成资源浪费。不依赖人/AI 主观判断，而是通过代码结构分析提供客观指标。

**详细指令**: 参见 `references/phase-minus-0-5-auto-estimate.md`

#### 快速参考

**步骤**:
1. **识别需求类型** — 删除/修改已存在代码 → 立即分析；新增功能 → brainstorming 后分析
2. **收集指标** — 引用计数 (`grep -rn`)、跨模块依赖 (目录分布)、循环依赖、Public API 暴露、测试文件数
3. **汇总评估** — 综合打分 → 轻量 / 标准 / 复杂
4. **输出结果** — 使用 `templates/auto-estimate-output-template.md` 标准格式
5. **用户确认** — 接受建议 / 修改流程 / 取消
6. **路由执行** — 按最终级别进入对应 Phase

**路由决策表**:

| 评估结果 | 路由 | 说明 |
|---------|------|------|
| **轻量** (引用 ≤3, 同模块，无循环依赖) | 跳过 Phase 0 brainstorming + Phase 1 delphi-review → 直接进入 Phase 2 BUILD | 小改动不需要完整流程 |
| **标准** (引用 4-10, 跨 1-2 模块) | 正常流程 Phase 0-4 | 标准 sprint |
| **复杂** (引用 >10 或 循环依赖 或 跨 3+ 模块) | 完整 Phase 0-8 + 风险警告 | 高风险需求 |

**输出模板**: `templates/auto-estimate-output-template.md`
**学习日志**: `templates/auto-estimate-learning-log.md`（记录用户 override，用于阈值优化）

**输出格式**:
```
+-------------------------------------------------------------+
| AUTO-ESTIMATE 评估结果                                        |
+-------------------------------------------------------------+
| 需求：{task_description}                                      |
| 类型：{change_type}                                          |
|                                                             |
| [{impact_level}] Impact: {impact_label}                      |
|                                                             |
| 引用：{ref_count} 处                                          |
| 跨模块：{cross_module_count} 个 ({module_list})               |
| 循环依赖：{circular_dep_status}                               |
| Public API：{public_api_count} 个                             |
|                                                             |
| 建议流程：{recommended_flow}                                  |
|                                                             |
| {risk_warning}                                               |
|                                                             |
| [接受建议]  [修改流程]  [取消]                                 |
+-------------------------------------------------------------+
```

**纠偏机制**:
- **接受建议**: 按推荐流程执行，记录 `user_decision: "accepted"`
- **修改流程**: 用户选择其他级别，记录 `override_reason` 到 `.sprint-state/auto-estimate-learning.json`
- **取消**: 停止本次 sprint

**⚠️ 轻量路由的特殊处理**:
- 轻量路由跳过 Phase 0 brainstorming 和 Phase 1 delphi-review
- 但仍然执行 Phase 1→2 的 GITHOOKS-GATE 检查
- Phase 2 BUILD 仍然执行完整 TDD + 盲评 + 验证

### Phase 0: THINK（需求探索与设计）
- **Subagent dispatch**: orchestrator 通过 `task(category="deep", load_skills=["brainstorming"])` 启动独立 session
- 输入: Phase -1 summary（worktree 路径）+ 用户原始需求
- 输出: 结构化设计文档 → 直接作为 Phase 1 PLAN 的输入
- **HARD-GATE**: 设计未批准 → 不可进入实现

### Phase 1: PLAN（共识评审）
- **Subagent dispatch**: orchestrator 通过 `task(category="deep", load_skills=["autoplan", "delphi-review", "to-issues"])` 启动独立 session
- 输入: phase-0-summary.md + 设计文档
- 输出: `specification.yaml`（含 user_stories[]）+ `slices-manifest.json`

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

### Phase 2: BUILD（DELPHI-GATE → ralph-loop 默认 + TDD + 盲评 + 验证）

**⚠️ DELPHI-GATE（BUILD 入口门禁）**:
Phase 2 第一步必须执行 DELPHI-GATE 检查。没有 delphi-review APPROVED → 不可编码。

检查步骤:
1. 读取 `.sprint-state/delphi-reviewed.json`
2. 验证文件存在 → 不存在 → 输出 `[BLOCKED] delphi-review not APPROVED. 必须先完成 Phase 1 的 delphi-review。` → 返回 Phase 1
3. 验证 `verdict` 字段 == `"APPROVED"` → 不等于 → 同上 BLOCK
4. ✅ 通过 → 进入 BUILD 编码

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

**Mock Minimization**（Phase 2 强制）：
- 默认使用 integration-first：real DB (sqlite-in-memory), real collaborators
- Mock 仅用于：external services, network calls, I/O boundaries
- Mock 密度 > 30% 时必须添加 `// @mock-justified: <reason>` 注解（理由最少 10 字符）
- Phase 3 Gate M 会在 push 时验证 mock 密度

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
- **Subagent dispatch**: orchestrator 通过 `task(category="quick", load_skills=["learn", "retro", "systematic-debugging"])` 启动独立 session
- 输入: phase-4-summary.md（验收结果）+ emergent-issues.md（如有）
- 输出: `feedback-log.md`
- **HARD-GATE**: Phase 5 不可跳过。Phase 4 完成后 → 必须进入 Phase 5 → 完成后才能进入 Phase 6。
- **`learn` (gstack)** — Sprint 级复盘（这是 /learn 在本项目中的主要调用时机）
  - ralph-loop 已在 BUILD Phase 内部实现 per-REQ learn（permanent/contextual 分类）
  - Phase 5 额外进行 Sprint 级复盘，总结全 Phase 经验
- **`retro` (gstack)** — 工程回顾：提交历史、工作模式、代码质量趋势
- **`systematic-debugging` (superpowers)** — 根因调试

### Phase 6: SHIP（发布准备）
- **Subagent dispatch**: orchestrator 通过 `task(category="quick", load_skills=["finishing-a-development-branch", "ship"])` 启动独立 session
- 输入: phase-5-summary.md + feedback-log.md
- 输出: PR URL
- **HARD-GATE**: Phase 5 未完成 → 不可进入 Phase 6。验证 `.sprint-state/phase-outputs/feedback-log.md` 存在。
- **⚠️ GITHOOKS-GATE**: 再次验证 hooks 完整性（Phase 2 的 TDD 编码已触发提交，SHIP 阶段还会再次提交）
  - 运行 `githooks/verify.sh` → 缺失 → `githooks/install.sh` → 阻断直至修复
- **`finishing-a-development-branch`** (superpowers) — 结构化完成流：4 选项（merge / PR / discard / keep）
- `ship` (gstack) — 创建 PR（PR 路径时使用）
- Phase 6 输出：PR URL（用于 Phase 7 输入）

### Phase 7:  LAND（合并 + 部署）
- **Subagent dispatch**: orchestrator 通过 `task(category="deep", load_skills=["land-and-deploy"])` 启动独立 session
- 输入: phase-6-summary.md + PR URL
- 输出: 部署状态 + Canary 报告
- 输入：Phase 6 输出的 PR URL
- 调用：`land-and-deploy` skill
- 流程：
  1. Merge PR（`gh pr merge --squash`）
  2. 等待 CI 完成（poll `gh pr checks` 直到 success 或 10min timeout）
  3. 等待 Deploy 完成（如已配置，10min timeout）
  4. **Canary Health Check**（如已配置部署平台）：
     - 健康检查端点：项目根路径 `/` 或自定义 `/.well-known/health`
     - SLA 指标：HTTP 200 响应 + 错误率 <1% + p99 响应 <2s
     - 超时策略：最长 5 分钟，每 10s polling 一次
     - 部署**失败**时的回滚：`git revert` 最后一次 merge commit + 输出 `[ERROR] Deploy failed, auto-rolled back merge`
- 条件跳过：无部署配置时，仅执行 merge + CI checks，跳过 deploy/canary
- 输出：部署状态 + Canary 报告（成功/失败/跳过）

### Phase 8: CLEANUP（安全清理 + 总结）

**执行时机**: Phase 7 LAND 成功后（或 Phase 6 Option 1 本地 Merge 后）

**动作**:
1. **检测 worktree 是否存在**: `[ -d <worktree_path> ]`
2. **安全清理**: 
   - **⚠️ 禁止使用通配符或递归 shell 删除命令** — 必须先列出 `isolation.worktree_path` 并确认只清理本 sprint worktree
   - 首选 git worktree 管理命令清理该精确路径；失败时重试最多 3 次，间隔 1s
   - 如果仍失败：输出 `[WARN] Worktree cleanup failed; list the target path and ask the user to clean it manually`
   - ** NEVER delete arbitrary directories** — 只删除本 sprint 创建的 `isolation.worktree_path`
3. **残留检测**: `[ -d <worktree_path> ]` → 如果仍有残留，输出警告 `[WARN] 检测到残留目录，请手动检查：<worktree_path>`
4. **更新 `.sprint-state/sprint-state.json`**:
   - `phase: 8`
   - `status: "merged"` 或 `"completed"`
5. **输出 Cleanup Report + Sprint Summary**

**条件跳过**: `--no-isolate` 路径（无 worktree 可清理）

**输出**: `[CLEANUP] Worktree removed:` + 残留检测（✅ clean / ⚠️ residual）

**IF emergent issues → Sprint 2**

---

## 编排层规则（Orchestration Rules）

### Agent Dispatch Rules

| Agent Type | 适用场景 | 不适用场景 | 超时处理 |
|-----------|---------|-----------|---------|
| `explore` (bare) | **窄搜索**：单个关键词/pattern，已知文件位置 | 多角度宽泛搜索，读取大文件，3+ search angles | >5min → cancel + 用 `deep` 重试 |
| `librarian` (bare) | **外部参考**：API 文档、OSS 示例 | 内部代码库宽泛探索 | >5min → cancel + 用 `deep` 重试 |
| `task(category="deep")` | **复杂研究**：多模块分析，架构决策 | 单文件 trivial fix | 无限制 |
| `task(category="unspecified-high")` | **高 effort 实现**：新模块、重构 | 单行修改 | 无限制 |

**关键规则**：

1. Bare `explore` agent 本质是 contextual grep，**不是研究 agent**。如果任务涉及：
   - 3+ 个独立搜索角度
   - 读取多个大文件（>200 行）
   - 需要跨层分析（如"查 ralph-loop + .sprint-state/ + token 阈值 + phase transition"）
   
   → **必须用 `task(category="deep", load_skills=[...])` 替代**

2. 如果 `explore` agent >5 分钟未返回 → cancel 并立即用 `task(category="deep")` 重试。不要等待。

3. **并行 explore 仍然是正确模式**。2-4 个窄搜索 explore agent 并行执行是高效且推荐的。问题在于给单一 explore agent 分配宽泛任务。

**issue #83 根因**：`bg_1abf2ed9` 被分配了 4 个独立搜索角度的宽泛任务（ralph-loop context + .sprint-state/ + token threshold + phase transition），bare explore agent 超时丢失 session。同批的 `bg_5ecf590d`（窄搜索 OpenCode compaction API）3m35s 正常完成。

### Phase Subagent Dispatch Matrix

| Phase | 名称 | Subagent? | Category | load_skills | 执行者 |
|-------|------|:---------:|----------|-------------|--------|
| -1 | ISOLATE | ❌ | Bash（直接执行） | 无 | orchestrator |
| -0.5 | AUTO-ESTIMATE | ❌ | Bash（直接执行） | 无 | orchestrator |
| 0 | THINK | ✅ | `deep` | `["brainstorming"]` | subagent |
| 1 | PLAN | ✅ | `deep` | `["autoplan", "delphi-review", "to-issues"]` | subagent |
| 2 | BUILD | ✅(已有) | ralph-loop | `["test-driven-development"]` | subagent |
| 3 | REVIEW | ✅ | `deep` | `["delphi-review", "test-specification-alignment"]` | subagent |
| 4 | USER ACCEPT | ❌ | **强制人工** | 无 | 用户 |
| 5 | FEEDBACK | ✅ | `quick` | `["learn", "retro", "systematic-debugging"]` | subagent |
| 6 | SHIP | ✅ | `quick` | `["finishing-a-development-branch", "ship"]` | subagent |
| 7 | LAND | ✅ | `deep` | `["land-and-deploy"]` | subagent |
| 8 | CLEANUP | ❌ | Bash（直接执行） | 无 | orchestrator |

**上下文隔离原则**：
- 每个 Subagent 在**独立 session** 中启动，不继承 orchestrator 的对话历史
- orchestrator session 仅接收 subagent 的最终结果摘要（~13,000 tokens/sprint）
- 现代模型百万 token 上下文 + 缓存命中 → 单 sprint 不会触发 overflow

### CONTEXT INHERITANCE

每个 Phase subagent 启动时，上下文仅通过以下路径继承：

| Phase | 加载来源 | 内容 |
|-------|---------|------|
| Phase -1 | 无前置（Bash 操作） | 用户原始需求 + 当前分支状态 |
| Phase 0 | phase--1-summary（仅路径） | 隔离环境信息（worktree 路径） |
| Phase 1 | phase-0-summary.md + design-doc | 设计决策 + 结构化规格 |
| Phase 2 | phase-1-summary.md + specification.yaml | 评审结论 + REQ 列表 |
| Phase 3 | phase-2-summary.md + MVP 代码 | 构建结果 |
| Phase 4 | — | **人工验收**。Phase 4 不产生 subagent summary，但用户验收结果记录在 `.sprint-state/phase-outputs/emergent-issues.md`（如有 emergent issues）。Phase 5 加载此文件。 |
| Phase 5 | phase-4-summary.md + emergent-issues.md | 验收结论 |
| Phase 6 | phase-5-summary.md + feedback-log.md | 复盘结论 |
| Phase 7 | phase-6-summary.md + PR URL | 发布准备 |
| Phase 8 | phase-7-summary（Bash 操作） | 部署结果 |

**隔离原则**：每个 Phase subagent 在干净上下文中启动。
输入仅限上表对应的摘要文件和一级产出物。
不包含前一 Phase 的完整对话、中间文件、失败尝试。

**特殊场景**：
- `--resume-from <phase>`：跳过前置 Phase，直接从指定 Phase 启动。此时要求该 Phase 的前置摘要文件已存在。例如 `--resume-from build` 要求 `phase-1-summary.md` 和 `specification.yaml` 已存在。orchestrator 仍执行 Phase Transition Gate 验证。
- `--no-isolate`：跳过 Phase -1 ISOLATE，直接在当前分支执行。Phase 0 无 `phase--1-summary` 可用，上下文继承来源为用户原始需求 + 当前 git 状态。所有后续 Phase 的 worktree enforcement 不适用（无 worktree），但仍需保持代码隔离。
- `next_phase_context` 中的 `{path}` 等变量占位符在实际写入时被替换为具体值。示例中的 `{path}` 应替换为实际 worktree 路径（如 `.worktrees/sprint/sprint-2026-06-01-01`）。

### PHASE TRANSITION RULES

每个 Phase subagent 完成后，必须按顺序执行以下步骤：

1. **写入 Phase 摘要**：创建 `.sprint-state/phase-outputs/phase-{N}-summary.md`
   - 格式：YAML frontmatter + Markdown body（body ≤ 50 行）
   - 大小限制：≤ 40,000 字符（≈ 10,000 tokens）

2. **更新 sprint-state.json**：
   - `phase`: 当前阶段编号
   - `outputs`: 新增当前阶段输出文件路径

3. **等待用户确认 checkpoint**（如适用）

### Phase Summary 格式（YAML Frontmatter Schema）

每个 `phase-N-summary.md` 必须包含以下 YAML frontmatter：

```markdown
---
phase: -1
phase_name: ISOLATE
status: completed
outputs:
  - path: ".worktrees/sprint/sprint-YYYY-MM-DD-NN"
    type: directory
decisions:
  - title: "Worktree isolation enabled"
    rationale: "Prevent main branch pollution"
unresolved_issues: []
next_phase_context: "Worktree created at {path}. All subsequent edits MUST use this workdir."
---

## Phase Summary
{简明摘要，不超过 50 行}
```

**必填字段**: `phase`, `phase_name`, `status`, `outputs`, `decisions`, `next_phase_context`
**可选字段**: `unresolved_issues`

### Phase Transition Gate

Orchestrator dispatch 下一 Phase 前必须执行验证：

```bash
SUMMARY=".sprint-state/phase-outputs/phase-${N}-summary.md"
[ -f "$SUMMARY" ] || { echo "[BLOCK] phase-${N}-summary 不存在"; exit 1; }
FRONTMARKERS=$(grep -c "^---" "$SUMMARY" 2>/dev/null || echo 0)
[ "$FRONTMARKERS" -ge 2 ] || { echo "[BLOCK] YAML frontmatter 格式不完整"; exit 1; }
grep -q "^phase:" "$SUMMARY" || { echo "[BLOCK] 缺少 phase 字段"; exit 1; }
grep -q "^phase_name:" "$SUMMARY" || { echo "[BLOCK] 缺少 phase_name 字段"; exit 1; }
grep -q "^status:" "$SUMMARY" || { echo "[BLOCK] 缺少 status 字段"; exit 1; }
grep -q "^decisions:" "$SUMMARY" || { echo "[BLOCK] 缺少 decisions 字段"; exit 1; }
grep -q "^outputs:" "$SUMMARY" || { echo "[BLOCK] 缺少 outputs 字段"; exit 1; }
grep -q "^next_phase_context:" "$SUMMARY" || { echo "[BLOCK] 缺少 next_phase_context"; exit 1; }
CHARS=$(wc -c < "$SUMMARY" | tr -d ' ')
[ "$CHARS" -le 40000 ] || { echo "[BLOCK] 摘要超出大小限制 (${CHARS}/40000 chars)"; exit 1; }
```

**由 orchestrator 强制执行**，不依赖 subagent 自觉遵守。
验证失败 → BLOCK，不可 dispatch 下一 Phase。

### WORKTREE ENFORCEMENT（Issue #84）

Phase -1 执行完毕后，**所有后续操作（Phase 0 到 Phase 8）的文件编辑、命令执行 MUST 在 worktree 目录下执行**：

- **工作目录**：所有 Bash 命令必须通过 `workdir` 参数或 `&&` 链式命令在 worktree 路径下执行
- **文件写入**：所有 `write`、`edit` 工具的 `filePath` 必须位于 `isolation.worktree_path` 下
- **验证步骤**：Phase 0 开始前，输出 `[WORKTREE] 后续所有操作将在 {worktree_path} 中进行`
- **例外**：`.gitignore` 校验（Phase -1 表步 4）和 `git worktree remove`（Phase 8 清理）在仓库根目录执行
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
  "auto_estimate": {
    "change_type": "删除已存在代码|修改已存在代码|新增功能|Bug修复",
    "metrics": {
      "ref_count": 12,
      "cross_module_count": 3,
      "modules": ["auth", "user", "admin"],
      "circular_dep": true,
      "public_api_count": 5,
      "test_file_count": 4
    },
    "estimated_level": "轻量|标准|复杂",
    "recommended_flow": "轻量流程 (Phase 2-3)|标准流程 (Phase 0-4)|完整 Sprint Flow (Phase 0-8)",
    "risk_warnings": ["循环依赖: user ↔ plane"],
    "user_decision": "accepted|overridden|cancelled",
    "override_reason": null
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
| Phase 7 (LAND) | `land-and-deploy` + canary | (同) | (同) | (同) |
| Phase 8 (CLEANUP) | worktree remove + state update | (同) | (同) | (同) |
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
# → 在 worktree 目录下：npm install → 基线测试 → .sprint-state/ 记录
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
# → 分支名：feat/user-login（保留 /）
# → worktree 路径：.worktrees/sprint/feat-user-login（/ 替换为 -）

# Sprint 完成后安全清理：先列出本 sprint 的 isolation.worktree_path
# 仅清理 sprint-state 中记录的精确 worktree 路径
# 禁止使用通配符或递归 shell 删除命令
# 如果自动清理失败，输出目标路径并要求用户手动处理
```

---

## 底层 Skills 保持独立

所有被调用的 Skills 保持独立可用：
- 用户可以直接调用 `delphi-review` 单独评审
- 用户可以直接调用 `test-driven-development` 单独执行 TDD
- sprint-flow 只是自动串联调用，不替代底层 Skills

---

## Anti-Patterns

| 错误 | 正确 |
|------|------|
| 把普通问答、解释、代码检索请求路由到 sprint-flow | 仅在用户明确要求开发/实现/一键开发完整需求时触发 sprint-flow |
| 跳过 Phase -1 隔离，直接在 main/master/develop 上改代码 | 默认创建 worktree；除非用户显式使用 `--no-isolate` 或 `--force` 并确认风险 |
| 未完成 Phase -0.5 AUTO-ESTIMATE 就套用完整重流程 | 先评估轻量/标准/复杂，再按推荐流程或用户确认后的流程执行 |
| Plan 阶段跳过 Delphi 评审直接 Build | 标准/复杂需求必须经过 autoplan + delphi-review；未 APPROVED 禁止编码 |
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

### Machine-Readable Outputs

**Phase Summary** (all automated Phases must output):
```markdown
---
phase: <N>
phase_name: <NAME>
status: completed|paused|failed
outputs:
  - path: "path/to/output"
    type: file|directory
decisions:
  - title: "Decision title"
    rationale: "Rationale for decision"
unresolved_issues: []
next_phase_context: "Context needed by next phase"
---

## Phase Summary
Concise summary, <= 50 lines.
```

**Sprint State JSON** (all Phases must maintain):
```json
{
  "id": "sprint-YYYY-MM-DD-NN",
  "phase": <N>,
  "status": "running|paused|completed|failed",
  "isolation": {
    "worktree_path": ".worktrees/sprint/sprint-YYYY-MM-DD-NN",
    "branch": "sprint/YYYY-MM-DD-NN"
  },
  "outputs": {},
  "metrics": {}
}
```

### Final User-Facing Output

When ending or pausing, output:
- Current Phase and status
- Generated file paths
- Passed/failed validation commands
- Next user decision required (if applicable)
- PR URL (Phase 6 success) or cleanup report (Phase 8 success)

## Security Notes

- Sprint Flow 会执行 git 操作（worktree、branch、commit、PR、merge），在受保护分支上默认必须隔离。
- 不得使用 `--no-verify` 绕过 quality gates；hook 失败必须修复根因。
- 不得自动推送、创建 PR、merge 或 deploy，除非用户请求的流程明确进入 Ship/Land 阶段并已通过前置 gate。
- 不得修改、打印或提交 `.delphi-config.json`、API keys、tokens、cookies、SSH keys 等敏感信息。
- Phase 7 deploy/canary 失败时必须报告失败并按配置回滚；不可静默忽略部署失败。
- Phase 4 用户验收不可由模型代替；人工验收是发布安全边界。
- worktree 清理只允许删除本 sprint 创建的 `isolation.worktree_path`，不得删除任意用户目录。

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

## Anti-Patterns

| ❌ 错误 | ✅ 正确 |
|---|---|
| 在保护分支 (main/master) 上直接执行 sprint | Phase -1 自动创建 worktree 隔离 |
| 跳过 Phase 4 用户验收（"赶时间"） | Phase 4 是 HARD-GATE，必须人工验收 |
| Phase 2 不安装 Git Hooks 就开始编码 | GITHOOKS-GATE 检查必须先于 BUILD |
| 单个 subagent 处理所有 REQ | ralph-loop 逐 REQ 迭代，每个 REQ 独立上下文 |
| 验证失败仍 commit | 验证不通过的代码不 commit |
| 跳过 Phase 5 FEEDBACK 直接 SHIP | Phase 5 是 HARD-GATE，不可跳过 |
| --force 在生产分支上运行不确认 | --force 必须等待用户显式确认风险 |
| Phase 6 SHIP 后不清理 worktree | Phase 8 CLEANUP 必须执行 git worktree remove |

---

## Output Format (MANDATORY)

Sprint-flow orchestrator MUST output phase transition status as valid JSON:

```json
{
  "skill_name": "sprint-flow",
  "sprint_id": "sprint-YYYY-MM-DD-NN",
  "current_phase": 2,
  "phase_name": "BUILD",
  "status": "running|paused|completed|failed",
  "isolation": {
    "worktree_path": ".worktrees/sprint/sprint-YYYY-MM-DD-NN",
    "branch": "sprint/YYYY-MM-DD-NN"
  },
  "outputs": {
    "specification": "specification.yaml",
    "mvp": "mvp-v1/"
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

## 研究证据

| 证据 | 来源 | 应用 |
|------|------|------|
| One-shot = 单次迭代执行 | Boris Cherny interview | Phase 2 设计 |
| 80% session 从 Plan Mode 开始 | Boris skill | Phase 1 设计 |
| Verification improves 2-3x | Boris #1 tip | Phase 3 设计 |
| Emergent requirements 无法消除 | Mike Cohn, Rafael Santos | Phase 4 人工设计 |
| 78% failures invisible | arXiv research | Phase 4 必要性证明 |
| Think → Plan → Build → Ship | gstack ETHOS | 整体流程设计 |

