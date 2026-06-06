# Phase 4: USER ACCEPTANCE（⚠️ 人工验收）

## 目标

用户实际使用 MVP，发现 Emergent 问题。这是 AI 无法预测的环节。

---

## ⚠️ 关键说明

**这是 Emergent Requirements 发现环节。**

- AI 无法预测用户看到产品后才发现的问题
- 78% 的软件失败是用户使用时发现的，不是开发阶段发现的
- 必须由用户实际使用验收

---

## 调用 Skills

**无** — 必须人工

---

## 执行步骤

### Step 1: 提示用户开始验收

```
⚠️ Phase 4: USER ACCEPTANCE

MVP 已通过自动化验证，现在需要您实际使用验收。

请按照以下步骤：
1. 启动应用（或访问部署地址）
2. 使用 Emergent Issues 检查清单进行验收
3. 记录发现的问题
4. 完成后确认是否继续

验收完成后，请回复：
- "验收通过" → 进入 Phase 5
- "发现问题" → 填写 emergent-issues.md
```

---

### Step 2: 用户实际使用 MVP

用户按照 Emergent Issues 检查清单验收：

使用模板：`@templates/emergent-issues-template.md`

检查维度：
1. **核心功能体验** (Core Functionality UX)
2. **多轮交互体验** (Multi-turn Interaction UX)
3. **视觉/交互体验** (Visual/Interaction UX)
4. **用户认知负担** (Cognitive Load)
5. **意外发现** (Unexpected Observations)

---

### Step 3: 记录 Emergent Issues

用户填写 `emergent-issues.md`：

```markdown
# Emergent Issues - [需求名称]

## 验收日期
YYYY-MM-DD

## 发现的问题

### Critical
| 问题描述 | 影响范围 | 发现场景 |
|---------|---------|---------|

### Major
| 问题描述 | 影响范围 | 发现场景 |
|---------|---------|---------|

### Minor
| 问题描述 | 影响范围 | 发现场景 |
|---------|---------|---------|

## 验收结论
- [ ] ✅ 验收通过，进入 Phase 5
- [ ] ⚠️ 发现问题需 Sprint 2 迭代
```

---

### Step 4: 保存 Emergent Issues

保存到 `<project-root>/.sprint-state/phase-outputs/emergent-issues.md`

---

## 暂停点

**⚠️ 必须等待用户验收完成**

- 用户确认验收结果后才能继续
- 如果发现重大问题 → Sprint 2 回到 Phase 0

---

## Sprint 2 触发逻辑

```
Sprint 结束时 (Phase 6 完成):
  IF emergent_issues_count == 0 → sprint_completed，结束流程
  
  IF emergent_issues_count > 0:
    ├─ IF emergent_issues 有 Critical → 自动启动 Sprint 2
    ├─ IF emergent_issues 仅 Major/Minor → 询问用户
    └─ Sprint 2 Pain Document 从 emergent-issues.md 转化
```

---

## 输出

- Emergent Issues List (`emergent-issues.md`)
- 进入 Phase 5 自动执行（如果用户确认验收）