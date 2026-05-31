# middleware.md — Sprint Flow 状态机与暂停点逻辑（AHE 组件分解）

> **本文是 `skills/sprint-flow/SKILL.md` 中完整流程 (L46-68) 和暂停点表 (L72-84) 的 AHE 对齐展开。**
> 用于 ablation 实验：AHE 论文显示 Middleware 组件贡献占 37%，单独修改可显著影响性能。

## 组件职责

定义 Sprint Flow 的状态机转换逻辑、暂停点（pause-point）触发条件和自动恢复规则。是 phase 间的"胶水层"，负责在特定节点暂停等待用户决策。

---

## 完整状态机（7 Phase 流转）

```
Phase 0: THINK → brainstorming → HARD-GATE: 设计未 APPROVED → 不可编码
Phase 1: PLAN  → autoplan → delphi-review → spec.yaml
Phase 2: BUILD → GITHOOKS-GATE → ralph-loop/TDD → verification → MVP v1
Phase 3: REVIEW → code-walkthrough → test-alignment → browse QA
Phase 4: USER ACCEPTANCE → ⚠️ 必须人工 → Emergent Issues List
Phase 5: FEEDBACK → learn + retro + systematic-debugging
Phase 6: SHIP → finishing-a-development-branch → canary → Sprint Summary
```

## 暂停点矩阵

| Phase | 暂停点标识 | 触发条件 | 用户操作 | 自动恢复条件 |
|-------|-----------|---------|---------|-------------|
| Phase 0 | **HARD-GATE** | 设计未 APPROVED | 修改设计文档 | 设计 APPROVED 后继续 |
| Phase 1 | taste_decisions | autoplan 发现未决议事项 | 用户确认每个决策 | 确认后自动继续 |
| Phase 1 | delphi-review | 未 APPROVED（REQUEST_CHANGES） | 修复并重新评审 | APPROVED 后自动继续 |
| **Phase 2** | **DELPHI-GATE** | delphi-reviewed.json 不存在或 verdict != APPROVED | 返回 Phase 1 完成 delphi-review | APPROVED 后继续 |
| Phase 2 | 验证失败 | 超过 max 3 次失败 | 用户决定修复或放弃 | 验证通过后自动继续 |
| Phase 2 | 成本超阈值 | token 成本 > 阈值 | 用户决定继续或暂停 | 用户确认后自动继续 |
| Phase 3 | browse 发现问题 | QA 失败 | 回退 Phase 2 | 验证通过后自动继续 |
| **Phase 4** | **必须人工验收** | 进入 Phase 4 | 用户实际使用后确认 | **无法自动恢复** |
| **Phase 5** | **FEEDBACK 硬门禁** | Phase 4 完成后进入 | 执行 learn + retro → 生成 feedback-log.md | feedback-log.md 存在后继续 |
| **Phase 6** | **Phase 5 门禁验证** | Phase 5 未完成 | 验证 feedback-log.md → 不存在 → 返回 Phase 5 | feedback-log.md 存在后继续 |
| Phase 6 | finishing-a-branch | 分支收尾 | 用户 4 选 1 | 确认后自动继续 |
| Phase 6 | ship PR | PR 路径需要合并 | 用户确认合并 | 合并后自动继续 |

## 状态转换规则

| 当前状态 | 下一状态 | 条件 |
|---------|---------|------|
| Phase N 完成 | Phase N+1 | 无阻塞条件 |
| Phase 0 HARD-GATE 未通过 | Phase 0 (重试) | 设计未 APPROVED |
| Phase 2 DELPHI-GATE 未通过 | Phase 1 (回退) | delphi-review not APPROVED |
| Phase 4 人工验收未完成 | Phase 4 (等待) | **永远不可自动跳过** |
| Phase 4 确认完成 | Phase 5 | **必须执行，不可跳过** |
| Phase 5 未完成 (feedback-log.md 不存在) | Phase 5 (等待) | **永远不可自动跳过** |
| Phase 2 验证失败 > 3 次 | BLOCK (用户决策) | 熔断机制 |
| Phase 2 成本超限 | BLOCK (用户决策) | 熔断机制 |

## 熔断机制 (Circuit Breaker)

| 原 xp-consensus 状态 | 新处理方案 |
|---------------------|-----------|
| `CIRCUIT_BREAKER_TRIGGERED` | sprint-flow 编排层监控成本，超阈值 BLOCK + 用户决策 |
| `ROLLBACK_TO_ROUND1` | verification-before-completion 失败 → 修复 max 3 次 → 仍失败 BLOCK |
| `GATE1_FAILED`/`GATE1_COMPLETE` | verification-before-completion 内置此区分 |
| `GATE2_RUNNING` | `cso` (gstack) — Phase 1-6 安全审计 |

---

## AHE 分类

| 字段 | 值 |
|------|---|
| 组件类型 | Middleware |
| 修改频率预期 | 高（状态机调整频繁） |
| 消融实验假设 | 修改暂停点逻辑 → Sprint 执行时间变化 ±15% |
| 参考证据 | AHE 论文: Middleware 组件单独修改带来 +2.2% 总增益 |
