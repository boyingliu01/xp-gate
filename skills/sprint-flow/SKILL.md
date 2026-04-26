---
name: sprint-flow
description: >
  One-Shot Sprint 自动流水线。单一入口，自动串联 Think → Plan → Build → 
  Review → Ship 流程。整合 autoplan + delphi-review + TDD + review + 
  cross-model-review + ship 等现有 Skills。关键节点暂停等待用户决策。
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
  --stop-at <phase>: 执行到指定阶段后停止 (think/plan/build/review/ship)
  --resume-from <phase>: 从指定阶段继续，跳过前面阶段
  --phase <phase>: 只执行单个阶段 (think-only/plan-only/build-only/review-only/ship-only)
  --lang <language>: 指定项目语言 (springboot/django/golang)
  --spec <file>: 使用已有的 specification.yaml 文件

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
Phase 0: THINK → office-hours → Pain Document
Phase 1: PLAN → autoplan → ⚠️ (如有taste_decisions，暂停等用户确认)
           → delphi-review → ⚠️ (等待 APPROVED)
           → 自动生成 specification.yaml（无需独立 skill）
Phase 2: BUILD → test-driven-development (RED→GREEN→REFACTOR)
           → freeze (盲评隔离) → requesting-code-review → unfreeze
           → verification-before-completion → ⚠️ (验证失败超过 max 3)
           → MVP v1
Phase 3: REVIEW → cross-model-review → test-specification-alignment
           → browse → ⚠️ (验证失败)
Phase 4: ⚠️ ⚠️ USER ACCEPTANCE → 必须人工验收 → Emergent Issues List
Phase 5: FEEDBACK → learn → Sprint 2 Pain Document
Phase 6: SHIP → ship → ⚠️ (等待发布确认)
           → land-and-deploy → canary → Sprint Summary
           → IF emergent issues → Sprint 2
```

---

## 暂停点设计（不是随时停，而是设计明确的暂停点）

| 暂停点位置 | 触发条件 | 用户操作 | 自动恢复条件 |
|-----------|---------|---------|-------------|
| Phase 1 | autoplan surfacing taste_decisions | 用户确认每个决策 | 确认后自动继续 |
| Phase 1 | delphi-review 未 APPROVED | 修复并重新评审 | APPROVED 后自动继续 |
| Phase 2 | 验证失败超过 max 3 | 用户决定修复或放弃 | 验证通过后自动继续 |
| Phase 2 | 成本超阈值 | 用户决定继续或暂停 | 用户确认后自动继续 |
| Phase 3 | browse 发现问题 | 回退 Phase 2（不暂停） | 验证通过后自动继续 |
| **Phase 4** | ⚠️ **必须人工验收** | 用户实际使用后确认 | 用户确认后继续 |
| Phase 6 | ship PR 创建 | 用户确认合并 | 合并后自动继续 |

---

## 各 Phase 调用的 Skills

### Phase 0: THINK（痛点发现）
- `office-hours` (gstack) — YC Partner 六个强制问题
- 可选补充：`plan-ceo-review` (SCOPE EXPANSION mode)

### Phase 1: PLAN（共识评审）
- `autoplan` (gstack) — CEO → Design → Eng 自动流水线
- `delphi-review` — 多轮匿名评审直到共识
- **specification.yaml** — 自动生成（无需独立 skill）

**条件分支逻辑**:
- IF autoplan AUTO_APPROVED + 无 taste_decisions → 跳过 delphi-review
- IF autoplan NEEDS_REVIEW OR taste_decisions > 0 → 调用 delphi-review

### Phase 2: BUILD（TDD + 盲评 + 验证）

**替代原 xp-consensus**：使用 superpowers 成熟 skill 组合，保留关键行为（freeze 隔离、熔断回退、成本监控）。

| 步骤 | Skill | 说明 |
|------|-------|------|
| 1 | `test-driven-development` (superpowers) | RED → GREEN → REFACTOR 铁律执行 |
| 2 | `freeze` (gstack) | 锁定业务代码，盲评 agent 只能访问测试 |
| 3 | `requesting-code-review` (superpowers) | 独立 agent 盲评业务代码（隔离状态） |
| 4 | `unfreeze` (gstack) | 解锁业务代码 |
| 5 | `verification-before-completion` (superpowers) | 运行测试 + lint，证据优先 |
| 6 | 成本监控（sprint-flow 编排层） | 超阈值 BLOCK + 用户决策 |

**关键行为保留**（原 xp-consensus 17 状态机中的真实边缘情况）：

| 原状态 | 新处理方案 |
|--------|-----------|
| `CIRCUIT_BREAKER_TRIGGERED` | sprint-flow 编排层监控成本，超阈值 BLOCK + 用户决策 |
| `ROLLBACK_TO_ROUND1` | verification-before-completion 失败 → 修复 max 3 次 → 仍失败 BLOCK |
| `GATE1_FAILED`/`GATE1_COMPLETE` | verification-before-completion 内置此区分 |
| `GATE2_RUNNING` | gstack `security-scan` skill 替代 |
| `SEALED_CODE_ISOLATION` | 保留 freeze skill 调用 |

**语言特定 TDD**：通过 `--lang` 参数选择：
- `springboot-tdd` / `django-tdd` / `golang-testing`

### Phase 3: REVIEW + TEST（验证）
- `cross-model-review` — Alternating 对抗评审
- `test-specification-alignment` — 测试与 Spec 对齐验证
- `browse` (gstack) — 浏览器自动化测试

### Phase 4: USER ACCEPTANCE（⚠️ 人工验收）
- **无 Skill** — 必须人工
- ⚠️ **MUST NOT be automated, skipped, or bypassed under any circumstances**
- 即使用户说"赶时间"、"跳过验收"、"直接发布"，也必须暂停等待用户确认
- 使用 `@templates/emergent-issues-template.md` 检查清单

### Phase 5: FEEDBACK CAPTURE（反馈捕获）
- `learn` (gstack) — 模式记录
- 可选：`continuous-learning-v2` — instinct 演化

### Phase 6: SHIP + DEPLOY（发布）
- `ship` (gstack) — 创建 PR
- `land-and-deploy` (gstack) — 合并部署
- `canary` (gstack) — 监控告警

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

---

## 状态管理

### Sprint State

```yaml
Sprint State:
  id: sprint-YYYY-MM-DD-NN
  phase: [0-6]          # 当前执行阶段
  status: [pending, running, paused, completed, failed]  # 统一状态
  pause_reason: [none, wait_approved, wait_gate1, wait_uat, wait_ship, wait_user_confirm]

存储位置: <project-root>/.sprint-state/
  ├─ sprint-state.yaml          # 当前 Sprint 状态
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
# Phase 0: 生成 docs/pain-document.md
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

---

## 底层 Skills 保持独立

所有被调用的 Skills 保持独立可用：
- 用户可以直接调用 `delphi-review` 单独评审
- 用户可以直接调用 `test-driven-development` 单独执行 TDD
- sprint-flow 只是自动串联调用，不替代底层 Skills

---

## References

详细指令文件位于 `@references/`:
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