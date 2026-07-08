# Phase 5/6: SHIP（发布 — 发布准备 + 合并部署）

**执行时机**: Phase 4/6 VERIFY 完成后、Phase 6/6 CLOSE 之前。
**对应旧模型**: Phase 5 SHIP + Phase 6 LAND

**摘要**: 结构化分支完成决策, 创建 PR, 合并部署, 监控. 生成 Sprint Summary.

---

## Part A: SHIP（发布准备）

**完整指令**: @see SKILL.md Phase 5/6 SHIP section.

**Orchestrator 直接执行**: `finishing-a-development-branch` 和 `ship` 均为交互式 skill（4 选项菜单 + PR 确认），**必须由 orchestrator 直接调用**。

**关键链**: PHASE4-GATE → verification → finishing-a-development-branch(4选项) → ship

**HARD-GATE**: Phase 4/6 VERIFY 未完成 → BLOCK。验证 `feedback-log.md` 存在。

**GITHOOKS-GATE**: 验证 hooks 完整性，缺失则 `githooks/install.sh`

**VERSION-GATE**: bump PATCH/MINOR/MAJOR → `sync-version.sh` → CHANGELOG.md → `git diff VERSION` 验证

**输出**: PR URL

---

## Part B: LAND（合并 + 部署）

**Orchestrator 直接执行**: `land-and-deploy` 包含 merge 确认和 rollback 决策，**必须由 orchestrator 直接调用** `skill(name="land-and-deploy")`

**输入**: PR URL → 输出: 部署状态 + Canary 报告

**流程**: Merge PR → 等待 CI (10min) → 等待 Deploy (10min) → Canary Health Check (5min)

**回滚**: `git revert` 最后一次 merge commit

**条件跳过**: 无部署配置时仅 merge + CI

**输出**: 部署状态 (success/failure/skipped), Canary 报告
