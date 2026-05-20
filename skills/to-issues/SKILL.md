---
name: to-issues
description: Break a plan, spec, or PRD into independently-grabbable issues using tracer-bullet vertical slices. Use when user wants to convert a plan into issues, create implementation tickets, or break down work into vertical slices. Integrates with XGate sprint-flow Phase 1.
---

# To Issues — Vertical Slice Breakdown

将 PRD / specification.yaml / 设计文档拆解为 **独立的垂直切片 Issue**，每个切片是贯穿所有层的 **tracer bullet**，而非水平分层切片。

核心理念：每个 Issue 交付一条**狭窄但完整**的端到端路径（schema → API → UI → tests），完成后即可独立演示并通过质量门禁。

---

## 术语（强制一致使用）

| 术语 | 定义 |
|------|------|
| **Vertical Slice** | 贯穿所有层（数据、API、UI、测试）的薄路径，交付端到端行为 |
| **Tracer Bullet** | 第一条完整的垂直切片，优先拆解以快速暴露 unknown unknowns |
| **HITL** | Human-In-The-Loop — 需要人工决策（架构选择、设计评审）才能继续 |
| **AFK** | Away-From-Keyboard — 可完全由 agent 自主实现并合并 |
| **Blocking** | 依赖关系：此切片必须在哪些切片完成后才能开始 |
| **Deep Module** | 封装大量功能于简单接口背后的模块（XGate Principles 概念） |

---

## 输入

- PRD 文件路径，或
- `specification.yaml`，或
- 最近对话中的设计文档（项目配置的 spec 路径，默认 `docs/superpowers/specs/*.md`）

## 输出（Machine-Readable）

### 1. 文本输出

- 一组垂直切片 Issue（GitHub Issue / 本地 `.issues/*.md` / 用户指定的 issue tracker 格式）
- 依赖关系图（拓扑排序后的执行顺序）

### 2. JSON Output Contract（供 ralph-loop / sprint-flow 下游消费）

写入 `.sprint-state/slices-manifest.json`：

```json
{
  "version": 1,
  "source": "specification.yaml 或 spec 文件路径",
  "slices": [
    {
      "id": "slice-N",
      "title": "一句话描述端到端行为",
      "type": "HITL | AFK",
      "blocked_by": ["slice-M"] | [],
      "parent_story": "User Story 编号",
      "what_it_delivers": "端到端行为描述",
      "acceptance_criteria": ["标准1", "标准2", "标准3"],
      "effort": "S | M | L",
      "loc_budget": 200,
      "file_budget": 20,
      "status": "pending"
    }
  ],
  "execution_order": ["slice-1", "slice-2", "slice-3"],
  "dependency_graph": {
    "slice-1": [],
    "slice-2": ["slice-1"],
    "slice-3": ["slice-1"]
  }
}
```

---

## 流程

### 1. 收集上下文

从当前对话或输入的 PRD/spec 中提取：
- 需求列表 / User Stories
- 系统模块 / 架构设计
- 技术约束（语言、框架、数据库）

如果输入中包含 CONTEXT.md 或 ADRs，读取并尊重其中的领域术语和架构决策。

**PRD 完整性检查（降级规则）**：
```
IF PRD 缺少关键内容：
  - 缺少数据模型 / schema 定义 → 标注所有数据相关切片为 HITL
  - 缺少 API 契约 → 标注所有 API 相关切片为 HITL
  - 缺少 UI 设计 / 交互说明 → 标注所有 UI 相关切片为 HITL
  - 缺少验收标准 → 标注整体验证切片为 HITL
```

### 2. 探索代码库

**Brownfield 项目（已存在代码）— 必须执行**：
- 读取 AGENTS.md CODE MAP + 目录结构
- 检查已有模块边界、路由定义、DB 模式
- 确认测试覆盖现状

**Greenfield 项目（新项目）— 可选**：
- 若为全新项目，跳过此步骤
- 建议采用 schema-first 切片顺序（先 DB schema → 再 API → 再 UI）

### 3. 起草垂直切片

将需求拆解为 **tracer bullet** 切片。规则：

- 每个切片交付**一条狭窄但完整**的端到端路径
- **优先 unknown unknowns**：优先拆解能快速暴露不确定因素的切片
- **切片必须可独立演示并完整通过 6 道质量门禁**（Code Quality + Dup Code + Complexity + Principles + Tests + Architecture）
- **标注依赖**：明确哪些切片阻塞哪些切片
- **识别 Deep Module 机会**：拆解时主动提出可封装为 deep module 的模块边界

**范围控制（硬上限）**：
| 约束 | 阈值 | 超限处理 |
|------|------|---------|
| 切片总数 | ≤15 / 功能模块 | 超过 → 按 epic 分组，组内拓扑排序 |
| 单切片变更量 | ≤200 LOC 或 ≤20 文件 | 超过 → 拆分为子切片 |
| 单切片工作量 | ≤4h 开发时间 | 超过 → 拆分为子切片 |

### 4. HITL / AFK 分类

**判定规则**（满足任一条件即为对应类型）：

```
HITL 条件：
  - 涉及架构决策（数据库选型、API 风格、auth 方案）
  - 涉及 UI/UX 设计选择（布局、交互、品牌色）
  - 涉及第三方服务集成选型（支付、短信、OAuth provider）
  - PRD 降级规则触发（见步骤 1）

AFK 条件（必须同时满足全部）：
  - 纯实现、遵循项目中已有模式（如已有 adapter 的 CRUD）
  - 接口契约已在 spec/PRD 中明确定义
  - 无新增外部依赖（第三方 API、新库引入）
  - 测试策略可复用已有测试适配器

否则 → HITL（保守默认）
```

**HITL → AFK 状态机**：
```
HITL (创建) → 人工确认 (ADRs / 设计决策产出) → 标记为 AFK-ready → AFK (agent 执行)
                                                                   ↓
                                         AFK 执行遇到未预见依赖 → 回退 HITL → BLOCKED
```

### 5. 依赖验证

在发布前执行以下检查：

```
1. 构建依赖图 (DAG)
2. 检测循环依赖 (A→B→C→A) → 报错并要求重新拆分
3. 拓扑排序 → 生成 execution_order
4. 检查每个切片的 blocked_by 引用是否存在
5. 验证第一个切片（tracer bullet）无阻塞
```

**跨切面关注点处理**：
Auth、logging、error handling、i18n 等贯穿所有切层的关注点：
- **首选**：在第一条 tracer bullet（通常是 slice-1）中内置这些横切关注点的基础设施
- **次选**：作为独立的前置 AFK 切片（如 "slice-0: 基础设施骨架"）
- 不要将这些关注点分散到每个切片中 — 会导致重复实现和不一致

### 6. 向用户确认

以编号列表呈现拆解结果。每个切片包含：

```
### Slice N: [简短标题]
- **Type**: HITL / AFK
- **Effort**: S(~1h) / M(~2h) / L(~4h)
- **Blocked by**: Slice M / None
- **Parent Story**: User Story 编号
- **LOC Budget**: ~N 行
- **What it delivers**: 一句话描述端到端行为
- **Acceptance Criteria**: 1-3 条可验证行为
```

询问用户：
1. 粒度是否合适？（太粗 / 太细 / 正好）
2. 依赖关系是否正确？
3. 是否有切片应该合并或拆分？
4. HITL/AFK 标注是否准确？

**最多 2 轮迭代**。超过 2 轮未决则强制收敛：
- 第一轮：完整列表展示
- 后续轮次：仅展示变更部分（Diff 视图：新增 / 合并 / 拆分项对比）

### 7. 发布切片

用户批准后，生成切片 Issue 并写入 `slices-manifest.json`。

**GitHub Issue 格式**:
```markdown
## Parent
[父 issue 编号或 PRD 链接]

## Slice ID
slice-N

## What to build
[端到端行为描述，非逐层实现描述]

## Acceptance criteria
- [ ] 标准 1（端到端行为可验证）
- [ ] 标准 2
- [ ] 标准 3

## Technical Notes
[可选：接口设计、schema 变更、架构决策]

## Blocked by
[#N - 阻塞 issue 编号 / None — 可以立即开始]

## Type / Effort
[HITL | AFK] / [S | M | L]

## Gate-Compliant DoD ⚠️
此切片完成后必须通过全部 6 道质量门禁：
- [ ] Gate 1: Code Quality (lint 无错误)
- [ ] Gate 2: Dup Code (≤5% 相似度)
- [ ] Gate 3: Complexity (≤5 警告)
- [ ] Gate 4: Principles (Clean Code + SOLID 零错误)
- [ ] Gate 5: Tests (全部通过 + ≥80% 覆盖率)
- [ ] Gate 6: Architecture (无新增警告 + 童子军规则)
```

**按拓扑排序顺序发布**：先发布无阻塞的切片，再发布被阻塞的切片。

---

## 与 XGate Sprint Flow 集成

完整 7 阶段流程中 to-issues 的位置及切片在各阶段的生命周期：

```
Phase 0: THINK    → brainstorming → 设计文档 → APPROVED
Phase 1: PLAN     → autoplan → delphi-review → specification.yaml
                  → **/to-issues** → slices-manifest.json + Issue 列表
Phase 2: BUILD    → 按 execution_order 逐个切片执行
                  → 每个切片 = 一个 REQ（ralph-loop 模式）
                  → 或通过 dispatching-parallel-agents 并行（无依赖的 AFK 切片）
Phase 3: REVIEW   → **整体 review**（全部切片完成后统一 code-walkthrough）
                  → browse / QA 验证端到端行为
Phase 4: USER ACC → 人工验收（全部切片集成后的完整功能）
Phase 5: FEEDBACK → learn + retro（按切片统计通过率/返工率）
Phase 6: SHIP     → 全部切片合并后一次性 merge（或按 epic 分批 merge）
```

**切片与 REQ 的映射**（ralph-loop 模式）：
```
每个切片 → 生成一个 REQ 实例：
  REQ-N:
    - source_slice: slice-N
    - input: slices-manifest.json 中对应切片的 acceptance_criteria
    - constraints: LOC_budget, file_budget, type (HITL/AFK)
    - output: 通过 6 gates 的增量 diff
    - verification: test-specification-alignment + gate verification
```

---

## Anti-Patterns

| ❌ 错误 | ✅ 正确 |
|---------|---------|
| 按技术层拆分（"先做 DB"、"再做 API"、"最后做 UI"） | 按端到端行为拆分（"用户可以通过邮箱注册"） |
| 伪装成垂直切片的水平拆分（标题是用户故事，执行时仍分层） | 每个切片的 acceptance criteria 必须包含全层验证 |
| 切片完成后无法独立演示 | 每个切片必须可验证 + 通过 6 道质量门禁 |
| 一个切片包含过多用户故事（>2 个） | 一个切片聚焦 1-2 个用户故事 |
| 忽略或随意标注依赖关系 | 拓扑排序验证 + 循环检测 |
| HITL 切片被当作 AFK 执行 | 人工输出 ADR/决策后 → 标记 AFK-ready → 执行 |
| 切片标题模糊（"实现功能X"） | 切片标题描述行为（"用户可通过邮箱注册账号"） |
| 切片超出 200 LOC / 20 文件 / 4h 预算 | 拆分为子切片 |
