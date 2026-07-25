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
| `grill-with-docs` | Matt Pocock (内置) | CONTEXT.md 不存在时（首个 Skill） | 访谈记录 + CONTEXT.md + ADR |
| `delphi-review --mode requirements` | xp-gate | R1 需求评审（轻量 2 专家 1 轮） | requirements-reviewed.json |
| 原生设计文档生成 | sprint-flow 编排层 | R1 APPROVED 后 | docs/plans/YYYY-MM-DD-<topic>-design.md |
| **硬闸门** | — | 设计未批准 → 停止 | 禁止进入 Plan |

### Phase 1: PLAN

| Skill | 来源 | 触发条件 | 条件分支 |
|-------|------|---------|---------|
| `batch-grill-me` | Matt Pocock (内置) | 标准路径（change_type != "修改已存在代码"） | 批量前置决策 |
| `delphi-review` | xp-gate | R2 设计评审；lightweight 路径使用 2 专家 1 轮 | 必须产生 `.sprint-state/delphi-reviewed.json` 且 verdict=APPROVED |
| `to-issues` | xp-gate | delphi-review APPROVED 后 | 拆解为垂直切片 → slices-manifest.json |

### Phase 2: BUILD

| 步骤 | Skill | 来源 | 参数注入 |
|------|-------|------|---------|
| -1 | `hooks-install` | githooks | 无 |
| 0 | BUILD-ENTRY-CONTRACT | xp-gate CLI | slices-manifest.json schema + slice↔REQ 校验 |
| 1 | `test-driven-development` | xp-gate (内置) | `--lang` 注入对应 TDD skill |
| 2 | ralph-loop / parallel dispatch | sprint-flow 编排层 | 隔离 session，review checkpoint |
| 3 | blind-review (read-only subagent) | sprint-flow 编排层 | tools: [Read, Grep, Glob] |
| 4 | verification-before-completion | sprint-flow 编排层 | 运行测试 + lint |
| 5 | 成本监控 | sprint-flow 编排层 | token 阈值 |
| 6 | learnings.md 写入 | sprint-flow 编排层 | 原生文件写入 |

### Phase 3: REVIEW

| Skill | 模式 | 触发条件 |
|-------|------|---------|
| `delphi-review` | `--mode code-walkthrough` | 强制调用 |
| `test-specification-alignment` | 默认 | 强制调用（#367 程序化 HARD-GATE） |
| `xp-gate check --all` | 全量门禁 | 强制调用 |
| 浏览器验证 | Layer 4 可选链 | gstack browse > browser-use MCP > SKIP |
| `k6`/`locust`/`gatling` | 性能测试 | `--with-performance` 或 `--type backend-*` |

### Phase 4: USER ACCEPTANCE

| Skill | 说明 |
|-------|------|
| **无 Skill** | 必须人工验收 |

### Phase 5: FEEDBACK

| Skill | 来源 | 说明 |
|-------|------|------|
| learnings.md 写入 | 原生 | 模式记录（替代原 gstack learn） |
| `xp-gate retro` | 原生 CLI | 工程回顾（含 #369 返工率区块） |
| systematic-debugging | Layer 4 可选 | 根因调试（如已安装；否则"无根因不修复"文本纪律） |

### Phase 6: SHIP

| Skill | 说明 |
|-------|------|
| 分支完成决策（原生 4 选项） | merge / PR / keep / discard |
| native ship 步骤 | test → VERSION-GATE → commit → push → gh pr create |
| native land 步骤 | merge 确认 → wait CI → canary → fail git revert |

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
