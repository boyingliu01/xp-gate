# Phase 5: FEEDBACK CAPTURE（反馈捕获）

## 目标

记录 Emergent 发现，更新 CLAUDE.md。为 Sprint 2 准备 Pain Document。

---

## 调用 Skills

- `learn` (gstack) — 模式记录
- 可选：`continuous-learning-v2` — instinct 演化

---

## 执行步骤

### Step 1: 调用 learn skill

```bash
skill(name="learn", user_message="[Emergent Issues 内容 + Sprint 总结]")
```

learn 执行：
- 记录本次 Sprint 的 emergent 发现
- 转化为 CLAUDE.md 规则
- 更新 institutional memory

---

### Step 2: 可选 - 调用 continuous-learning-v2

```bash
skill(name="continuous-learning-v2", user_message="[Emergent Issues 内容]")
```

执行：
- 创建 instinct (原子学习单元)
- confidence scoring
- 演化为 skill/command/agent

---

### Step 3: 转化 Emergent Issues 为 Sprint 2 Pain Document

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

---

### Step 4: 保存 Feedback Log 和 Sprint 2 Pain Document

保存到：
- `<project-root>/.sprint-state/phase-outputs/feedback-log.md`
- `<project-root>/.sprint-state/phase-outputs/sprint2-pain.md` (如有 emergent issues)

---

## 暂停点

**无** — Phase 5 完成后自动进入 Phase 6

---

## 输出

- Feedback Log (`feedback-log.md`)
- Sprint 2 Pain Document (`sprint2-pain.md`) — 如果有 emergent issues
- 进入 Phase 6 自动执行