# Phase 5: FEEDBACK CAPTURE（反馈捕获）

## 目标

记录 Emergent 发现，工程回顾（团队级），持续改进。为 Sprint 2 准备 Pain Document。

---

## 调用 Skills

- `learn` (gstack) — 模式记录（个人级）
- `retro` (gstack) _(新增)_ — 周工程回顾：提交历史、工作模式、代码质量趋势（团队级）
- `systematic-debugging` (superpowers) _(可选)_ — 根因调试：反馈中的 bug 做根因分析

---

## 执行步骤

### Step 1: 调用 learn skill

```
skill(name="learn", user_message="[Emergent Issues 内容 + Sprint 总结]")
```

learn 执行：
- 记录本次 Sprint 的 emergent 发现
- 转化为 CLAUDE.md 规则
- 更新 institutional memory

### Step 2: 工程回顾 — 调用 retro（新增 — ISSUE32）

```
skill(name="retro")
```

retro 执行：
- **提交历史分析**: 本次 Sprint 的 commits、工作模式
- **代码质量趋势**: 结合 Phase 3 的 benchmark 数据，展示质量变化
- **团队贡献分解**: 每人贡献比例 + praise + growth areas
- **改进建议**: 下次 Sprint 的改进点

输出: Retro 报告（周级工程回顾）

### Step 3: 根因调试（可选 — ISSUE32）

**IF Phase 4 发现 bug 或 Phase 3 验证失败**:
```
skill(name="systematic-debugging", user_message="[具体 bug 描述]")
```

systematic-debugging 执行 4 阶段：
1. Investigate（根因调查）
2. Analyze（分析）
3. Hypothesize（假设验证）
4. Implement（修复）

**Iron Law**: 无调查 → 不修复

### Step 4: 转化 Emergent Issues 为 Sprint 2 Pain Document

如果有 emergent issues，转化为新需求：
```markdown
# Sprint 2 Pain Document

## 来源
基于 Sprint 1 的 Emergent Issues

## Critical Issues (自动进入 Sprint 2)
| Issue | Sprint 1 描述 | Sprint 2 目标 |
|-------|--------------|--------------|

## Major Issues (询问用户是否纳入)
| Issue | Sprint 1 描述 | Sprint 2 目标 |
|-------|--------------|--------------|

## Minor Issues (可选纳入)
| Issue | Sprint 1 描述 | Sprint 2 目标 |
|-------|--------------|--------------|
```

### Step 5: 保存 Feedback Log 和 Sprint 2 Pain Document

保存到：
- `<project-root>/.sprint-state/phase-outputs/feedback-log.md`
- `<project-root>/.sprint-state/phase-outputs/sprint2-pain.md` (如有 emergent issues)

---

## 暂停点

**无** — Phase 5 完成后自动进入 Phase 6

---

## 输出

- Feedback Log (`feedback-log.md`)
- Retro Report（retro 输出）
- Sprint 2 Pain Document (`sprint2-pain.md`) — 如果有 emergent issues
- 进入 Phase 6 自动执行
