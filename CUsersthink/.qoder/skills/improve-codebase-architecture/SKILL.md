---
name: improve-codebase-architecture
description: Find deepening opportunities in a codebase, informed by domain language in CONTEXT.md and decisions in ADRs. Use when user wants to improve architecture, find refactoring opportunities, consolidate tightly-coupled modules, or make a codebase more AI-navigable. Run periodically (weekly or after surges of development).
---

# Improve Codebase Architecture

周期性架构健康检查：发现 **shallow module → deep module** 的深度化机会。目标是提升可测试性、AI 可导航性、模块边界清晰度。

与 XP-Gate 质量门禁的分工：
| 机制 | 时机 | 作用 |
|------|------|------|
| **6 道门禁** | 每次 commit | 被动拦截明显问题（函数过长、重复代码等） |
| **improve-codebase-architecture** | 每周/开发潮后 | 主动深度化改进（seam 识别、模块合并、接口提炼） |

---

## 术语（与 XP-Gate Principles 一致）

| 术语 | 定义 |
|------|------|
| **Module** | 任何有接口和实现的东西（函数、类、包、slice） |
| **Interface** | 调用者使用前必须知道的一切：类型、不变量、错误模式、顺序、配置 |
| **Implementation** | 接口背后的代码 |
| **Depth** | 接口的杠杆率：大量行为隐藏在简单接口后。**Deep = 高杠杆**。**Shallow = 接口几乎与实现一样复杂** |
| **Seam** | 接口所在位置；可以在不修改实现的情况下改变行为的地方 |
| **Adapter** | 在 seam 处满足接口的具体实现 |
| **Locality** | 深度带来的可维护性收益：变更、bug、知识集中在一处 |

---

## 核心判断工具

### Deletion Test
想象删除某个模块：
- 如果复杂性消失 → 它是 pass-through，不值得保留
- 如果复杂性在 N 个调用方中重新出现 → **它真正提供了价值**
- **"Yes, concentrates" = 你想发现的信号**

### The Interface Is the Test Surface
接口就是测试的边界。如果测试需要深入实现细节，说明接口太浅。

### One Adapter = Hypothetical Seam. Two Adapters = Real Seam.
只有一个实现满足接口 → 可能过度抽象。两个以上 → 真正的可替换边界。

---

## 流程

### 1. 探索

先读项目的 `CONTEXT.md`（领域语言）和 `docs/adr/`（架构决策）。

然后有机地走查代码库（不要遵循死板启发式），注意你在哪里感受到摩擦：

- 理解一个概念是否需要在多个小文件间跳来跳去？
- 模块是否 **shallow** — 接口几乎与实现一样复杂？
- 纯函数是否仅仅为了可测试性而被提取，但真正的 bug 隐藏在调用方式中？（缺乏 **locality**）
- 紧密耦合的模块是否在其 seams 之处泄漏？
- 哪些部分难以通过当前接口进行测试？

对任何怀疑 shallow 的模块执行 **Deletion Test**：删除它会让复杂性集中还是分散？"是的，会集中"就是你要的信号。

### 2. 呈现候选项

以编号列表呈现深度化机会。每项包含：

- **Files** — 涉及哪些文件/模块
- **Problem** — 当前架构为何造成摩擦（使用 CONTEXT.md 中的领域术语）
- **Solution** — 自然语言描述会怎样改变
- **Benefits** — 用 locality 和 leverage 解释收益，以及测试会怎样改善

**使用 CONTEXT.md 领域术语。如果与 ADR 冲突**，仅在摩擦值得重新讨论 ADR 时才标注：
> *"Contradicts ADR-0007 — 但值得重新打开，因为…"*

不要列出 ADR 禁止的每个理论重构。

**此时不要提出接口设计**。先问用户："你想探索哪个候选项？"

### 3. 用户选择候选项

仅当用户明确选择某个候选项时，才进入步骤 4。

### 4. Grilling 循环（设计树遍历）

用户选中某个候选项后，进入 grilling 对话：
- 遍历约束、依赖、深度化模块的形状
- seam 背后放什么、什么不放在 seam 背后
- 哪些测试能在深度化后存活/新增

**对话中的副作用**（决策固化时立即执行）：
- 命名不在 CONTEXT.md 中的新概念 → **新增到 CONTEXT.md**
- 模糊术语在对话中变清晰 → **更新 CONTEXT.md**
- 用户拒绝候选项且有有理由 → **提议记录为 ADR**（避免未来重复建议）
- 需要探索替代接口 → **按接口设计原则引导**

### 5. 输出（可选）

如果用户在 grilling 后决定执行重构：
- 生成重构计划（含文件列表、步骤顺序、风险点）
- 调用 test-driven-development skill 执行重构（保持行为不变）

---

## 与 XP-Gate 集成

### 触发时机
```
Phase 5 (FEEDBACK) 后推荐调用：
  → learn + retro + **improve-codebase-architecture**
  → 发现架构摩擦 → 记录到 retro → 下一 Sprint 纳入 backlog

或作为独立周期性任务：
  → /improve-codebase-architecture  → 每周/开发潮后
```

### 与 ralph-loop 的关系
架构改进本身可以作为一个独立的 REQ 通过 ralph-loop 执行：
- REQ: "深度化 Order 模块（从 N 个散文件合并为 deep module）"
- 通过 test-driven-development 保证行为不变

### 与质量门禁的关系
架构改进后，质量门禁的 violation 数量应减少：
- God class → 拆分为 deep modules → SOLID-001 (SRP) 告警消失
- Deep nesting → 封装为简单接口 → CC-002 告警消失
- Code duplication → 提取公共 deep module → Gate 2 (Dup Code) 改善

---

## Anti-Patterns

| ❌ 错误 | ✅ 正确 |
|---------|---------|
| 仅在文件层面重构（拆分大文件） | 在概念边界处重构（deep module 封装行为） |
| 为了测试而提取纯函数 | 为了 locality 和组织行为边界而重构 |
| 过度设计接口（只有一个 adapter） | 发现真实 seam（≥2 adapters 或需要可测试性）后再抽象 |
| 忽视现有 ADR 提出重构 | 尊重 ADR，仅在摩擦值得重新讨论时标注冲突 |
| 一次性重构整个模块 | 逐个候选项执行，使用 TDD 保证行为不变 |
| 与 ADR 冲突但不记录决策 | 记录为 ADR，避免未来重复建议 |

---

## 使用示例

```
/improve-codebase-architecture

→ Explore: 读取 CONTEXT.md, 走查代码库
→ 发现 3 个浅模块候选项
→ 呈现: #1 Order 模块过浅 / #2 Auth 适配器泄漏 / #3 支付领域缺乏 locality
→ 用户选中 #1
→ Grilling: 讨论 Order 的 seam 应该在哪
→ 更新 CONTEXT.md: 新增 "Order Intake" 术语
→ 提议 ADR: "Order 状态机封装" → 用户同意 → 创建 docs/adr/000X.md
→ 输出: 重构计划 → TDD 执行
```
