# tool-descriptions.md — Sprint Flow 各 Phase 调用的 Skill 完整描述（AHE 组件分解）

> **本文是 `skills/sprint-flow/SKILL.md` 中 Phase 2-6 Skill 调用 (L120-298) 的 AHE 对齐展开。**
> 用于 ablation 实验：AHE 论文显示 Tool 组件贡献占 48%，单独修改可显著影响性能。

## 组件职责

完整描述 sprint-flow 在每个 Phase 中调用的 Skill，包括参数路由、`--lang`/`--type` 注入、条件分支逻辑。是 ablation 实验中**最可能产生显著增益**的组件。

---

## Phase 2: BUILD 工具链（核心贡献区 — 48%）

### 默认模式: ralph-loop

| 步骤 | Skill | 来源 | 说明 |
|------|-------|------|------|
| -1 | `hooks-install` | githooks | `githooks/verify.sh` → 缺失则 `githooks/install.sh` |
| 0 | BUILD-ENTRY-CONTRACT | xp-gate CLI | slices-manifest.json schema + slice↔REQ 校验 |
| 1 | `test-driven-development` | xp-gate (内置) | RED → GREEN → REFACTOR |
| 2 | ralph-loop / parallel dispatch | sprint-flow 编排层 | 隔离 session，review checkpoint |
| 3 | blind-review (read-only subagent) | sprint-flow 编排层 | tools: [Read, Grep, Glob]，只读盲评 |
| 4 | verification-before-completion | sprint-flow 编排层 | 测试 + lint |
| 5 | 成本监控 | sprint-flow 编排层 | 超阈值 BLOCK |
| 6 | learnings.md 写入 | sprint-flow 编排层 | 原生模式记录 |

### GITHOOKS-GATE (Phase 1→2 闸门)

- 执行时机: Phase 1 完全通过、准备进入 Phase 2 BUILD 前
- `githooks/verify.sh` 全部存在 → 进入 BUILD 入口（仍必须先执行 DELPHI-GATE）
- 缺失 → `githooks/install.sh` 安装（hooks + adapter 基础设施）
- **核心原则**: 没有质量门禁的代码不可进入 BUILD。**失败 → 不可编码。**

### 语言特定 TDD

通过 `--lang` 参数注入:
- `springboot-tdd` → springboot-verification
- `django-tdd` → django-verification
- `golang-testing` → golang-verification

---

## Phase 3: REVIEW + TEST 工具链

| Skill | 模式 | 说明 |
|-------|------|------|
| `delphi-review` | `--mode code-walkthrough` | 多专家匿名代码走查 |
| `test-specification-alignment` | 默认 | 测试与 Spec 对齐验证（#367 程序化 HARD-GATE） |
| `xp-gate check --all` | 全量门禁 | Gate 0–9 含安全审计 |
| 浏览器验证 | Layer 4 可选链 | gstack browse > browser-use MCP > SKIP |
| `k6` / `locust` / `gatling` | 可选 | 后端负载测试 |

---

## Phase 5: FEEDBACK 工具链

| Skill | 说明 |
|-------|------|
| learnings.md 写入 | 原生模式记录（替代原 gstack learn） |
| `xp-gate retro` | 原生工程回顾（含 #369 返工率区块） |
| systematic-debugging | Layer 4 可选，根因调试（如已安装） |

---

## Phase 6: SHIP 工具链

| Skill | 说明 |
|-------|------|
| 分支完成决策（原生 4 选项） | merge / PR / keep / discard |
| native ship 步骤 | test → VERSION-GATE → commit → push → gh pr create |
| native land 步骤 | merge 确认 → wait CI → canary → fail git revert |

---

## 项目类型 → Skill 注入映射

| Phase | Backend (default) | Web Frontend | Mobile |
|-------|------------------|-------------|--------|
| Phase 0 (THINK) | `grill-with-docs` + R1 `delphi-review --mode requirements` | (同) | (同) |
| Phase 1 (PLAN) | `batch-grill-me` + R2 `delphi-review` | + OPTIONAL `design-shotgun` | (同 web) |
| Phase 2 (BUILD) | TDD + blind-review (read-only subagent) | (同 backend) | + `vercel-react-native-skills` / `flutter-review` |
| Phase 3 (REVIEW) | `delphi-review --mode code-walkthrough` + `xp-gate check --all` | + `xp-gate ui-review` + OPTIONAL qa/design-review/benchmark | `flutter-test` / `detox E2E` |
| Phase 5 (FEEDBACK) | learnings.md + `xp-gate retro` | (同) | (同) |
| Phase 6 (SHIP) | 原生 4 选项 + native ship + native land | (同) | + platform deploy |

---

## AHE 分类

| 字段 | 值 |
|------|---|
| 组件类型 | Tool Description |
| 修改频率预期 | 高（Phase 2 BUILD 工具链频繁调整） |
| 消融实验假设 | 增删 phase→skill 映射 → Sprint pass rate 变化 ±20%+ |
| 参考证据 | AHE 论文: Tool 组件单独修改带来 +3.3% 总增益 |
