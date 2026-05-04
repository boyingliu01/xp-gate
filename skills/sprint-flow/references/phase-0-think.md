# Phase 0: THINK（需求探索与设计）

## 目标

使用 brainstorming skill 进行结构化需求探索，输出经用户批准的设计文档。

**关键变更（ISSUE30）**: 从 `office-hours` 切换到 `brainstorming`，原因:
- brainstorming 有 **HARD-GATE**（设计未批准 → 不可进入实现），防止 "觉得已经理解了就直接开始写代码"
- brainstorming 输出结构化设计文档，可直接作为 Phase 1 PLAN 的输入
- office-hours 的 YC 六问适合新产品方向验证，brainstorming 更适合"具体功能实现前设计"的场景

---

## 调用 Skills

- `brainstorming` (superpowers) — **HARD-GATE**: 设计未批准 → 不可进入实现
- 可选补充：`office-hours` (gstack) — 当用户需求非常模糊、需要先验证产品方向时

---

## HARD-GATE 机制

```
DO NOT enter Phase 1 (PLAN) or do any implementation
until the brainstorming design has been APPROVED by the user.
```

这是 sprint-flow 的关键安全门。brainstorming skill 内部会执行：

1. **Explore project context** — 检查文件、文档、最近 commits
2. **Ask clarifying questions** — 一次一个，理解目的/约束/成功标准
3. **Propose approaches** — 2-3 个方案，含 trade-offs 和建议
4. **Present design** — 分节展示，每节获得用户批准
5. **Write design doc** — 保存到 `docs/plans/YYYY-MM-DD-<topic>-design.md`
6. **Transition to implementation** — brainstorming 自动调用 writing-plans

**sprint-flow 编排层行为**:
- 收到 brainstorming APPROVED 设计文档后，自动进入 Phase 1
- 如果 brainstorming 未完成（用户未 APPROVED），BLOCK 并等待

---

## 执行步骤

### Step 1: 调用 brainstorming skill

```
skill(name="brainstorming", user_message="[需求描述]")
```

brainstorming 内部流程:

```
Explore project context → Ask clarifying questions → Propose 2-3 approaches
→ Present design sections → User approves design? → YES → Write design doc
→ Invoke writing-plans skill
```

**注意**: brainstorming 内部会自动调用 `writing-plans` 创建实现计划，该计划直接作为 Phase 1 的输入。

### Step 2: 等待 HARD-GATE APPROVED

```
⚠️ HARD-GATE: 设计未 APPROVED → 不可进入 Phase 1

等待用户审批 brainstorming 输出的设计文档。
```

sprint-flow 编排层检查:
- [ ] 设计文档已保存 (`docs/plans/YYYY-MM-DD-<topic>-design.md`)
- [ ] 用户已 APPROVED
- [ ] 无未解决的 blocking questions

如果任一条件不满足 → **BLOCK**，等待用户确认。

### Step 3: 保存设计文档路径

```
设计文档路径写入 sprint-state，供 Phase 1 使用。
```

保存到 `<project-root>/.sprint-state/phase-outputs/design-doc.md`（内容为设计文档路径引用，或直接复制设计文档）。

---

## 可选补充: office-hours（方向验证）

当用户输入非常模糊时（如 "我想做一个 AI 工具" 而不是 "开发用户登录功能"），可以先调用 `office-hours` 验证产品方向，再进入 brainstorming 详细设计：

```
skill(name="office-hours", user_message="[模糊需求描述]")
// → Pain Document → 再进入 brainstorming 详细设计
```

**使用场景**:
- 用户描述的是一个新产品/新功能方向，而非具体功能
- 需要先验证"是否值得做"再进入"怎么做"

**如果不满足以上条件**: 直接跳过 office-hours，只使用 brainstorming。

---

## 暂停点

| 暂停点 | 触发条件 | 用户操作 | 自动恢复条件 |
|--------|---------|---------|-------------|
| **HARD-GATE** | brainstorming 设计未 APPROVED | 用户审批设计文档 | 设计 APPROVED 后自动进入 Phase 1 |

---

## 输出

- Design Document (`docs/plans/YYYY-MM-DD-<topic>-design.md`)
- Implementation Plan（brainstorming 内部 writing-plans 输出）
- 进入 Phase 1 自动执行（使用设计文档作为输入）
