# memory.md — Sprint State JSON Schema 与长期记忆（AHE 组件分解）

> **本文是 `skills/sprint-flow/SKILL.md` 中状态管理 JSON (L190-334) 的 AHE 对齐展开。**
> 用于 ablation 实验：AHE 论文显示 Memory 组件单独恢复全局增幅的 95%+。

## 组件职责

定义 Sprint 状态持久化 Schema、Phase 输出合同、长期记忆（learnings）结构。是 AHE 中最关键组件（记忆单独恢复 95%+ 全局增益）。

---

## Sprint State Schema（`.sprint-state/sprint-state.json`）

```json
{
  "id": "sprint-YYYY-MM-DD-NN",
  "phase": 0,
  "status": "running|paused|completed",
  "outputs": {
    "pain_document": "docs/pain-document.md",
    "specification": "specification.yaml",
    "mvp": "mvp-v1/",
    "review_report": "review-report.md"
  },
  "metrics": {
    "tests_passed": 15,
    "tests_failed": 0,
    "coverage_pct": 85
  }
}
```

### 状态枚举

| 字段 | 允许值 | 说明 |
|------|-------|------|
| `phase` | 0-6 | 当前执行阶段 |
| `status` | `pending` / `running` / `paused` / `completed` / `failed` | 统一状态 |
| `pause_reason` | `none` / `wait_approved` / `wait_gate1` / `wait_uat` / `wait_ship` / `wait_user_confirm` | 暂停原因 |

---

## Phase Output 合同

| Phase | 输出文件 | 存储路径 | 必需字段 |
|-------|---------|---------|---------|
| Phase 0 | `pain-document.md` | `phase-outputs/pain-document.md` | 结构化设计文档 |
| Phase 1 | `specification.yaml` | `phase-outputs/specification.yaml` | user_stories[], requirements[], acceptance_criteria[] |
| Phase 2 | `mvp-v1/` | `phase-outputs/mvp-v1/` | 功能代码 + 测试 |
| Phase 3 | `review-report.md` | `phase-outputs/review-report.md` | delphi-review 共识报告 |
| Phase 4 | `emergent-issues.md` | `phase-outputs/emergent-issues.md` | 用户发现的 emergent requirements |
| Phase 5 | `feedback-log.md` | `phase-outputs/feedback-log.md` | 改进建议 + 调试记录 |
| Phase 6 | `sprint-summary.md` | `phase-outputs/sprint-summary.md` | 发布记录 + Sprint 2 触发判断 |

---

## Sprint 2 自动触发规则

```
Phase 6 完成后:
  IF emergent_issues_count == 0 → sprint_completed，结束
  IF emergent_issues_count > 0 → sprint_2_needed:
    ├─ IF 有 Critical → 自动启动 Sprint 2
    ├─ IF 仅有 Major/Minor → 询问用户
    └─ Sprint 2 Pain Document ← emergent-issues.md 转化
```

---

## Learnings Schema（长期记忆）

ralph-loop 内部分类:
- `permanent`: 跨 REQ 持久化（通用约束、模式）
- `contextual`: 当前 REQ 生命周期内有效

gstack/learn 调用分类: permanent / contextual 通过 progress.log 持久化。

---

## AHE 分类

| 字段 | 值 |
|------|---|
| 组件类型 | Long-Term Memory |
| 修改频率预期 | 低（Schema 稳定） |
| 消融实验假设 | 移除 memory → Sprint pass rate 下降 5-10% |
| 参考证据 | AHE 论文: Memory 单独恢复 95%+ 全局增幅（事实性 > 策略性） |
