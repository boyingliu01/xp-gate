# Phase 2/6 DESIGN — Summary

**Sprint**: sprint-20261013-81（门禁可信度缺陷批次 A）
**Date**: 2026-10-13

## 设计文档

`docs/plans/2026-10-13-sprint-a-gate-integrity-design.md`（v2，含 R1 逐条响应）

## R2 Delphi 评审结果

| 项 | 值 |
|---|---|
| 轮次 | **2 轮**（阈值内，≤5） |
| 轮次 1 | 1/3 APPROVED（architecture）；technical/feasibility REQUEST_CHANGES（2+3 critical） |
| 轮次 2 | **3/3 APPROVED**（architecture 9 / technical 9 / feasibility 8），consensus 1.0 |
| 模型 | `s-glm-5.3-flash` / `g-qwen3.8-flash` / `g-deepseek-flash`（whalecloud profile，三席互异） |
| 最终 verdict | **APPROVED** |

R1 critical 及 v2 处置：MC-01/FC-01（#514 原子五步+回滚）、MC-02/FC-07（#523 弃抽取表达式改 mock-PATH）、FC-02/MC-03（#447 opt-in --use-config + 反空转）、FC-03（#465 影响面清单）、FC-04（执行顺序+Parking）、FC-05/MIN-02（#524 审计收敛）、FC-06（#532 parity 接 pre-push+CI）、FC-08（#527 迁移说明）、MC-04/FC-10（#469 reg query fail-closed）、MC-05（#527 性能上限）、MC-07（S2 优先级维持）、FC-09（伪红清单内联）、FC-13（发布回滚）。

R2 非阻塞跟进：mktemp 唯一性、@archlinter/cli 版本钉死、#527 doctor 迁移提示、CI 显式 parity job、#514 前 freeze hooks、单一事实源 ADR。

## 阶段中的范围修正（实测发现）

**#507 五子项全部已落地**，零代码工作量，带证据关闭：
- S1（wc-java-lint 主引擎）/S3（SKIP-aware 评分）/S5（GATE 9 Java 分派 + sub-state 聚合）→ v0.21.0 CHANGELOG
- S2（CCN 三级覆盖）→ `githooks/gate-3.sh` `resolve_ccn_threshold` + `githooks/__tests__/issue-507-ccn-threshold.test.bats`
- S4（G4 Java 覆盖显式化）→ `githooks/gate-4.sh` `java_coverage_note()` + `docs/java-principles-coverage.md`
- issue 正文「已在本机验证的补丁（供上游采纳）」表述过期——补丁已被 #507 sprint 采纳。

→ Sprint A 代码项 9 → 8。

## GITHOOKS-GATE

✅ 本机全局 hooks 已装且可执行（2026-10-13 封版提交 12 门禁全过验证）。注意：机器副本存在已知漂移（#514 的本机现场），按设计文档 §2.3 在 BUILD 最后一步处理。

## DELPHI-GATE

✅ 3/3 APPROVED（consensus 1.0 ≥ 90%），三模型可执行且互异，外部通道有 `resolved_model` 网关回显作执行证明。

## decisions

- **DR-001**：#507 零代码关闭（带证据）。
- **DR-002**：#523 测试法改为 mock-PATH + 解析函数单测。
- **DR-003**：#447 保留 opt-in `--use-config`，默认内置规则 + 反空转验证。
- **DR-004**：#465 `active_profile` → whalecloud，default 定义保留。
- **DR-005**：#514 机器侧操作放 BUILD 最后，cp 源为仓库 canonical（R2 MI-01 纠错）。
- **DR-006**：执行顺序 #524 → #532 → #523 → #527 → #447 → #465 → #469 → #514。

## next_phase_context

- BUILD 按 DR-006 顺序逐 issue TDD，每 issue 一个 commit。
- 镜像纪律：不得手工编辑 `src/npm-package/**` 字节镜像，用 `node scripts/sync-package-content.js --fix` 同步。
- DoD：本机钩子 12 门禁 + 目标测试单跑；沙箱伪红以 CI 为判据（设计文档 §4）。
- 含 .yml 的提交：PATH 前缀 PyYAML shim。

## status

`completed`
