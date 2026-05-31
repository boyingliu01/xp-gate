# skill-invocations.md — Phase→Skill 调用链与参数路由（AHE 组件分解）

> **本文是 `skills/sprint-flow/SKILL.md` 中各 Phase 调用 Skills (L88-103, L155-167) 的 AHE 对齐展开。**
> 用于 ablation 实验：验证 phase→skill 映射完整性对 Sprint 成功率的影响。

## 组件职责

提供完整的 Phase→Skill 映射表，包括技能来源、参数路由规则、条件分支逻辑。确保每次 Skill 调用具有足够的上下文信息。

---

## 完整 Phase→Skill 映射矩阵

### Phase 0: THINK

| Skill | 来源 | 触发条件 | 输出 |
|-------|------|---------|------|
| `brainstorming` | superpowers | 无条件（首个 Skill） | 结构化设计文档 |
| **硬闸门** | — | 设计未批准 → 停止 | 禁止进入 Plan |

### Phase 1: PLAN

| Skill | 来源 | 触发条件 | 条件分支 |
|-------|------|---------|---------|
| `autoplan` | gstack | 进入 Phase 1 自动调用 | 输出 AUTO_APPROVED 或 NEEDS_REVIEW |
| `delphi-review` | xp-gate | autoplan NEEDS_REVIEW OR taste_decisions > 0 | 跳过如果 AUTO_APPROVED + 无 taste_decisions |
| `to-issues` | xp-gate | delphi-review APPROVED 后 | 拆解为垂直切片 → slices-manifest.json |

### Phase 2: BUILD

| 步骤 | Skill | 来源 | 参数注入 |
|------|-------|------|---------|
| -1 | `hooks-install` | githooks | 无 |
| 0 | `dispatching-parallel-agents` | superpowers | 仅分发 AFK 切片（dependency_graph 判定） |
| 1 | `test-driven-development` | superpowers | `--lang` 注入对应 TDD skill |
| 2 | `executing-plans` | superpowers | 隔离 session，review checkpoint |
| 3 | `freeze` | gstack | 锁定业务代码 |
| 4 | `requesting-code-review` | superpowers | 盲评 agent |
| 5 | `unfreeze` | gstack | 解锁 |
| 6 | `verification-before-completion` | superpowers | 运行测试 + lint |
| 7 | 成本监控 | sprint-flow 编排层 | token 阈值 |

### Phase 3: REVIEW

| Skill | 模式 | 触发条件 |
|-------|------|---------|
| `delphi-review` | `--mode code-walkthrough` | 强制调用 |
| `test-specification-alignment` | 默认 | 强制调用 |
| `browse` | gstack | 强制调用 |
| `k6`/`locust`/`gatling` | 性能测试 | `--with-performance` 或 `--type backend-*` |

### Phase 4: USER ACCEPTANCE

| Skill | 说明 |
|-------|------|
| **无 Skill** | 必须人工验收 |

### Phase 5: FEEDBACK

| Skill | 来源 | 说明 |
|-------|------|------|
| `learn` | gstack | 模式记录 |
| `retro` | gstack | 工程回顾 |
| `systematic-debugging` | superpowers | 根因调试 |

### Phase 6: SHIP

| Skill | 说明 |
|-------|------|
| `finishing-a-development-branch` | 4 选项 |
| `ship` | 创建 PR（可选） |
| `land-and-deploy` | 合并部署 |
| `canary` | 监控告警 |

---

## 参数路由规则

### `--lang` 路由

| 值 | Phase 2 注入 | Phase 3 注入 |
|---|-------------|-------------|
| `springboot` | `springboot-tdd` | springboot-verification |
| `django` | `django-tdd` | django-verification |
| `golang` | `golang-testing` | golang-verification |

### `--type` 路由

| 值 | 检测依据 | 额外 Skill |
|---|---------|-----------|
| `web-nextjs` | `next.config.js` / `app/` | `design-shotgun` |
| `backend-go` | `go.mod` | `k6` |
| `backend-springboot` | `pom.xml` | `gatling` |
| `backend-django` | `manage.py` | `locust` |

---

## AHE 分类

| 字段 | 值 |
|------|---|
| 组件类型 | Skill Invocation Chain |
| 修改频率预期 | 中（新 skill 注册时更新） |
| 消融实验假设 | 调用链中断 → Sprint 执行失败率 ↑ |
