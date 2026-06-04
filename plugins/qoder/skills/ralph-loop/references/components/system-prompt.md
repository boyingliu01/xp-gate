# system-prompt.md — Ralph Loop 行为定义（AHE 组件分解）

> **本文是 `skills/ralph-loop/SKILL.md` 核心原则的 AHE 对齐展开。**

## 核心职责

定义 Ralph Loop (Phase 2 BUILD 默认模式) 的行为边界：逐 REQ/切片 迭代构建，每个 REQ dispatch 独立 subagent，干净上下文，全量回归测试。

## 核心原则 (AHE 对齐)

| # | 原则 | 说明 |
|---|------|------|
| 1 | 逐 REQ 迭代 | 一次处理一个 REQ/切片，干净上下文，避免上下文线性膨胀 |
| 2 | Token 节约 | 比旧并行模式节约 40-67% token |
| 3 | 全量回归 | 每个 REQ 完成后跑全量测试 |
| 4 | 进度持久化 | progress.log 持久化 learnings/permanent/contextual |
| 5 | 可中断续传 | 中断后可从最后完成 REQ 继续 |

## AHE 分类

| 字段 | 值 |
|------|---|
| 组件类型 | System Prompt |
| 修改频率预期 | 低 |
