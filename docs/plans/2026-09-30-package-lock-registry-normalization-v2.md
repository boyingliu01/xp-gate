# Corrigendum — 2026-09-30 package-lock registry normalization (v2)

> 本文件是对 `2026-09-30-package-lock-registry-normalization.md`（Delphi APPROVED 后不可回改）的事实修正。
> 只列错误与更正，不重述原方案。合并载体：PR #441（squash `10462ee`）。

## C1. §6 把 `security-audit.yml` 列进了"CI 侧 `npm ci` 安装路径回归门槛"

**原表述**：§6 将 `security-audit.yml:29` 与 `quality-gates.yml`、`mutation-test.yml`、`cross-platform-ci.yml` 并列为 `npm ci` 回归门槛。

**事实**：`security-audit.yml` 的触发器只有 `workflow_dispatch` + 每周 `cron: '0 8 * * 1'`（`.github/workflows/security-audit.yml:3-17`），**不是 PR/push 触发的工作流**，因此它永远不能作为 PR 的绿证据来源。它确实执行 `npm ci`（`:29`），原句在"安装路径消费者"意义上为真，但在"回归门槛"意义上为假——定时任务近期还在红（2026-09-28 scheduled run failure）。

**更正**：本变更的 CI 绿证据来源**只有两个**：`quality-gates`（`npm ci` 安装 + Gate Checks，PR run 36668955237 与 main run 36678708272 均 success）与 `cross-platform-ci`（Node 18/20/22 + 三 OS Install+Init，PR run 36668955224 与 main run 36678708316 均 success）。`mutation-test.yml` 的 45 分钟超时取消（45m16s，与 main 近六次 45m19s–45m33s 同签名）维持"不计入绿证据"的原判。

## C2. 顺带记录（非 v1 错误，PR #441 body Follow-up 4 已登记）

合并后实测发现 `githooks/pre-push:126` 的 `SOURCE_EXTENSIONS` 不含 `.cjs`/`.mjs`，本次含 `scripts/normalize-lock-registry.cjs` 的 9 文件推送被 Gate MW 判为 `Documentation-only push` 整体跳过走查——与 §5 已记录的 Gate 5c `.cjs` 盲区（`githooks/pre-commit:1737`、`:1793` `CODE_EXTENSIONS` 同样缺 `.cjs`）同族。修复是独立的 gate 改动，不落入本变更范围。

## 证据时间戳

- PR #441 merged: 2026-09-30T06:31:55Z，squash commit `10462ee4d86008b4b2f89d15accef9e708a85663`。
- main 本地复验：`node scripts/normalize-lock-registry.cjs` → `0 resolved source(s) rewritten`；`npx vitest run scripts/__tests__/package-lock-registry.test.cjs` → 31/31 passed。
