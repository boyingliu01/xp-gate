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
| 0 | `dispatching-parallel-agents` | superpowers | 检测可并行任务 |
| 1 | `test-driven-development` | superpowers | RED → GREEN → REFACTOR |
| 2 | `executing-plans` | superpowers | 隔离 session，review checkpoint |
| 3 | `freeze` | gstack | 盲评隔离 |
| 4 | `requesting-code-review` | superpowers | 独立 agent 评审 |
| 5 | `unfreeze` | gstack | 解锁 |
| 6 | `verification-before-completion` | superpowers | 测试 + lint |
| 7 | 成本监控 | sprint-flow 编排层 | 超阈值 BLOCK |

### GITHOOKS-GATE (Phase 1→2 闸门)

- 执行时机: Phase 1 完全通过、准备进入 Phase 2 BUILD 前
- `githooks/verify.sh` 全部存在 → 直接进入 BUILD
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
| `test-specification-alignment` | 默认 | 测试与 Spec 对齐验证 |
| `browse` | gstack | 浏览器自动化测试 |
| `k6` / `locust` / `gatling` | 可选 | 后端负载测试 |

---

## Phase 5: FEEDBACK 工具链

| Skill | 说明 |
|-------|------|
| `learn` | gstack，模式记录 |
| `retro` | gstack，工程回顾 |
| `systematic-debugging` | superpowers，根因调试 |

---

## Phase 6: SHIP 工具链

| Skill | 说明 |
|-------|------|
| `finishing-a-development-branch` | 4 选项: merge / PR / discard / keep |
| `ship` | gstack，创建 PR |
| `land-and-deploy` | 合并部署 |
| `canary` | 监控告警 |

---

## 项目类型 → Skill 注入映射

| Phase | Backend (default) | Web Frontend | Mobile |
|-------|------------------|-------------|--------|
| Phase 0 (THINK) | `brainstorming` | (同) | (同) |
| Phase 1 (PLAN) | `autoplan` + `delphi-review` | + `design-shotgun` | (同 web) |
| Phase 2 (BUILD) | TDD + blind-review | (同 backend) | + `vercel-react-native-skills` / `flutter-review` |
| Phase 3 (REVIEW) | `delphi-review --mode code-walkthrough` | + `qa` + `design-review` + `benchmark` | `flutter-test` / `detox E2E` |
| Phase 5 (FEEDBACK) | `learn` + `retro` | (同) | (同) |
| Phase 6 (SHIP) | `finishing-a-development-branch` + `ship` | (同) | + platform deploy |

---

## AHE 分类

| 字段 | 值 |
|------|---|
| 组件类型 | Tool Description |
| 修改频率预期 | 高（Phase 2 BUILD 工具链频繁调整） |
| 消融实验假设 | 增删 phase→skill 映射 → Sprint pass rate 变化 ±20%+ |
| 参考证据 | AHE 论文: Tool 组件单独修改带来 +3.3% 总增益 |
