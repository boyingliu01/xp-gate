# Phase 7: LAND（合并 + 部署）

**完整指令**: @see SKILL.md `## Phase 7: LAND` section.

**摘要**: 自动合并 PR, 等待 CI, 执行部署, Canary Health Check, 失败自动回滚.

**关键链**: merge PR → wait CI(10min) → wait Deploy(10min) → Canary Health Check(5min) → auto-rollback on failure

**输出**: 部署状态 (success/failure/skipped), Canary 报告
