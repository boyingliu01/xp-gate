# Sprint Summary Template

## 使用说明

此模板用于 Phase 6 (SHIP) 结束时生成 Sprint 总结。

---

# Sprint Summary - [需求名称]

## Sprint 元信息

```yaml
Sprint ID: sprint-YYYY-MM-DD-NN
开始日期: YYYY-MM-DD
结束日期: YYYY-MM-DD
总耗时: [X hours/days]
MVP 版本: v1.0
最终状态: [completed/needs-sprint-2]
```

---

## 阶段执行统计

| Phase | 耗时 | 状态 | 暂停次数 | 备注 |
|-------|------|------|---------|------|
| Phase 0: THINK | [X min] | ✅ 完成 | 0 | [备注] |
| Phase 1: PLAN | [X min] | ✅ 完成 | [N] | [备注] |
| Phase 2: BUILD | [X min] | ✅ 完成 | [N] | [备注] |
| Phase 3: REVIEW | [X min] | ✅ 完成 | [N] | [备注] |
| Phase 4: UAT | [X min] | ✅ 完成 | 1 (必须) | [备注] |
| Phase 5: FEEDBACK | [X min] | ✅ 完成 | 0 | [备注] |
| Phase 6: SHIP | [X min] | ✅ 完成 | [N] | [备注] |

---

## Skills 调用统计

| Skill | 调用次数 | 结果 | 备注 |
|-------|---------|------|------|
| office-hours | 1 | ✅ | Pain Document 生成 |
| autoplan | 1 | ✅/⚠️ | [taste_decisions 数量] |
| delphi-review | [N] rounds | ✅ APPROVED | [Round 数量] |
| specification-generator | 1 | ✅ | specification.yaml |
| BUILD (TDD + review) | 1 | ✅ APPROVED | [Gate 1 失败次数] |
| test-driven-development | [N] | ✅ | [BUILD (TDD + review) 内部调用] |
| cross-model-review | [N] rounds | ✅ APPROVED | [Round 数量] |
| test-specification-alignment | 1 | ✅ | [覆盖率] |
| browse | 1 | ✅ | [QA 通过] |
| learn | 1 | ✅ | [记录数量] |
| ship | 1 | ✅ | [PR URL] |
| land-and-deploy | 1 | ✅ | [部署 URL] |
| canary | 1 | ✅ | [监控正常] |

---

## Emergent 发现统计

| 类别 | 数量 | 处理状态 | 备注 |
|------|------|---------|------|
| Critical | [N] | [自动 Sprint 2] | [描述] |
| Major | [N] | [询问用户] | [描述] |
| Minor | [N] | [可选纳入 Sprint 2] | [描述] |

---

## 交付物清单

| 交付物 | 路径 | 状态 |
|-------|------|------|
| Pain Document | `.sprint-state/phase-outputs/pain-document.md` | ✅ |
| Specification | `.sprint-state/phase-outputs/specification.yaml` | ✅ |
| MVP v1 | `.sprint-state/phase-outputs/mvp-v1/` | ✅ |
| Review Report | `.sprint-state/phase-outputs/review-report.md` | ✅ |
| Emergent Issues | `.sprint-state/phase-outputs/emergent-issues.md` | ✅/⚠️ |
| Feedback Log | `.sprint-state/phase-outputs/feedback-log.md` | ✅ |
| Sprint Summary | `.sprint-state/phase-outputs/sprint-summary.md` | ✅ |

---

## 关键决策记录

| 决策点 | 选项 | 选择 | 理由 |
|-------|------|------|------|
| [决策1] | [A/B] | [选择] | [理由] |
| [决策2] | [A/B] | [选择] | [理由] |

---

## Sprint 2 建议（如有 emergent issues）

```yaml
Sprint 2 触发: [auto/user-confirm/none]
Sprint 2 Pain Document: sprint2-pain.md

Critical Issues (自动纳入):
  - [Issue 1]
  - [Issue 2]

Major Issues (建议纳入):
  - [Issue 1]

Minor Issues (可选纳入):
  - [Issue 1]
```

---

## 下一步行动

根据 Sprint 状态：
- ✅ Sprint 完成 → 结束流程
- ⚠️ 有 emergent issues → 提示用户是否开始 Sprint 2
- ❌ Sprint 失败 → 记录失败原因，结束流程

---

**Sprint 结束时间**: YYYY-MM-DD HH:MM:SS
**报告生成人**: sprint-flow skill