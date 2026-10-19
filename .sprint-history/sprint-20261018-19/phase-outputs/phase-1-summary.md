# Phase 1/6 PREP Summary — sprint-20261018-quality

## Sprint 目标
仓库质量自清与门禁提速（用户拍板：pre-commit 增量越快越好，pre-push 全量可慢）。

## AUTO-ESTIMATE
- 规模分类：**complex**（横跨 githooks / CI workflow / npm-package lib / tests 四个面；含阈值策略与 blocking 转换等用户决策点；生产热点重构 ~15 个函数）
- 依据：改动文件预估 25-40；新增工具 1（ccn-report.cjs）；行为变更 3（Gate3 ratchet、CI blocking、docs-only 短路）；重构函数 ~15。

## 工作区
- worktree: `.worktrees/sprint-20261018-quality`
- branch: `sprint/2026-10-18-01`（base main @ 4038379f）
- 旧 sprint-20261015-96 状态为空壳（无 phases 记录），已按 --force 归档到 .sprint-history/；其 phase-1 summary 已改名让位

## 范围（源自 #404 分析 + 性能审计实测）
- A. ccn-report.cjs：逐文件 lizard（绕批量膨胀 bug）、production/test 分桶、per-gate p50/p95 耗时榜
- B. audit duration_anomaly 记账修复（now_ms 单位错乱，383 条污染样本）
- C. 生产热点外科手术：test-alignment.ts / doctor.js / gate-m.ts / arch.js / phase-transition.js / uninstall.js（CCN>10 → <10，单函数 ≤30）
- D. Gate 3 `.ccn-baseline.json` ratchet（changed file 不得高于基线）
- E. CI quality-gates 全量扫描去 head -50 截断 + 转 blocking（配 ratchet）
- F. 提速：tsx 冷启动、docs-only 提交重 gate 短路（SKIP+reason）、file-hygiene 增量化（典型提交 46s → <15s，docs-only <5s）

## 决策点预登记
- DR-001 规模确认（本文件）
- DR-002 Phase1 重构范围（生产 only vs 含测试）— 待 DESIGN grill
- DR-003 docs-only 短路的 gate 名单 — 待 DESIGN grill

status: completed
outputs: [.sprint-state/sprint-state.json, .worktrees/sprint-20261018-quality]
decisions: [DR-001 complex 分类确认]
next_phase_context: 六切片 A-F；性能基线数据在 .xp-gate/audit.jsonl；真实 CCN 热点清单在 .delphi-work/ccn-real.csv（批量口径，DESIGN 需逐文件复核）
