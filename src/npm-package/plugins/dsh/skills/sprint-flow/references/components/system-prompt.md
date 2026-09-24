# system-prompt.md — Sprint Flow 行为定义（AHE 组件分解）

> **本文是 `skills/sprint-flow/SKILL.md` 核心原则部分 (L34-43) 的 AHE 对齐展开。**
> 用于 ablation 实验：单独修改本文件可观察核心原则对 Sprint pass rate 的影响。

## 核心职责

定义 Sprint Flow 的行为边界和全局约束。相当于 AHE 的 System Prompt 组件（虽 AHE 论文显示单独修改 System Prompt 不改善性能，但作为行为基准仍然必要）。

## 核心原则 (AHE 对齐)

| # | AHE 概念 | 原则 | 说明 | 硬闸门 |
|---|---------|------|------|--------|
| 1 | 单一入口 | `/sprint-flow` | 用户只需一个命令，自动串联全流程 | Phase 0 HARD-GATE |
| 2 | 自动流水线 | Think → Ship | 类似 autoplan，自动执行多个阶段 | 无需用户手动调用中间技能 |
| 3 | 关键节点暂停 | APPROVED / Gate 1 / Phase 4 / Ship | 明确暂停点，不是随时停 | Phase 0 设计未 APPROVED → 禁止编码 |
| 4 | 承认 Emergent Requirements | 用户验收环节必须人工 | 78% 失败不可见，无法自动化 | Phase 4 MUST NOT 自动化 |
| 5 | 复用现有 Skills | 不重新发明 | 整合 brainstorming + autoplan + delphi-review + TDD 等 | 不创建新 skill，复用现有体系 |

## AHE 分类

| 字段 | 值 |
|------|---|
| 组件类型 | System Prompt |
| 修改频率预期 | 低（行为基线稳定后极少改变） |
| 消融实验假设 | 修改核心原则 → Sprint pass rate 不变或下降（AHE 发现单独修改系统提示下降 2.3%） |
| 关键约束 | 不得删除 Phase 4 人工验收硬闸 |
