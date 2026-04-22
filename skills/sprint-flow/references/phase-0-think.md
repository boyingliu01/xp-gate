# Phase 0: THINK（痛点发现）

## 目标

发现真实痛点，不是"我想做什么"。使用 YC Partner 六个强制问题验证需求真实性。

---

## 调用 Skills

- `office-hours` (gstack) — YC Partner 六个强制问题
- 可选补充：`plan-ceo-review` (SCOPE EXPANSION mode)

---

## 执行步骤

### Step 1: 调用 office-hours skill

```bash
skill(name="office-hours", user_message="[需求描述]")
```

office-hours 会执行六个强制问题：

1. **需求现实是什么？** (Demand Reality)
   - 真实用户是否真的需要这个？
   - 现在有什么替代方案？
   - 为什么他们还没有用替代方案？

2. **当前状态是什么？** (Status Quo)
   - 用户现在怎么解决这个问题？
   - 他们的现状有多糟糕？

3. **绝望的具体性是什么？** (Desperate Specificity)
   - 能否描述一个具体的用户场景？
   - 这个场景有多绝望？

4. **最窄的切入点是什么？** (Narrowest Wedge)
   - 最小的可行切入点是什么？
   - 不要"大而全"，要"小而精"

5. **你观察到了什么？** (Observation)
   - 你自己是否观察到这个问题？
   - 数据或访谈支持吗？

6. **未来适配如何？** (Future-fit)
   - 这个需求在未来 3-5 年是否仍然存在？
   - 是否会被技术变化淘汰？

### Step 2: 生成 Pain Document

基于 office-hours 的输出，生成 Pain Document：

```markdown
# Pain Document - [需求名称]

## 生成日期
YYYY-MM-DD

## 需求现实
[来自 office-hours 的回答]

## 当前状态
[...]

## 绝望的具体性
[...]

## 最窄切入点
[...]

## 观察证据
[...]

## 未来适配
[...]

## Pain Statement (一句话痛点)
[用一句话描述为什么这是真实痛点]

## Proposed Solution (建议方案)
[基于六个问题推导出的初步方案]
```

### Step 3: 保存 Pain Document

保存到 `<project-root>/.sprint-state/phase-outputs/pain-document.md`

---

## 暂停点

**无** — Phase 0 完成后自动进入 Phase 1

---

## 可选补充

如果用户想要更激进的需求探索，可以调用：

```bash
skill(name="plan-ceo-review", user_message="SCOPE EXPANSION: [需求描述]")
```

plan-ceo-review 会在 office-hours 基础上进一步挑战需求边界，提出可能的扩张方向。

---

## 输出

- Pain Document (`docs/pain-document.md` 或 `.sprint-state/phase-outputs/pain-document.md`)
- 进入 Phase 1 自动执行