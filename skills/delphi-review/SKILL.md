---
name: delphi-review
description: "Delphi共识评审：多轮匿名评审直到专家达成一致意见。支持2位或3位专家。MANDATORY before any implementation, design, or architecture decisions. Invoke when user submits requirements, design docs, code PRs, or requests review."
---

# Delphi Consensus Review

## 核心原则

**Delphi 方法只有一个目的：得到所有专家一致认可的可行方案。**

### 四大核心特性（来自 RAND 方法论）

1. **匿名性 (Anonymity)** - Round 1 专家互不知道对方意见
2. **迭代数据收集 (Iterative)** - 多轮直到共识，不是固定轮数
3. **参与者反馈 (Controlled Feedback)** - 每轮看到其他专家意见
4. **统计共识 (Statistical Group Response)** - >=91% 一致才算共识

### 与其他评审方法的区别

| 方法 | 目的 | 流程 |
|------|------|------|
| Code Review | 发现问题 | 一次评审，发现问题即可 |
| **Delphi** | **达成共识** | **多轮迭代，直到所有专家 APPROVED** |

---

## ⚠️ 最重要：评审未完成直到 APPROVED

### 核心原则

**问题发现越早，修复成本越低。** 

评审的目的是得到**可行方案**，不是"完成评审"。如果方案不可行，评审就失败了。

```
❌ WRONG: Round 1 → Round 2 → Round 3 → 生成报告 → "评审完成"
   问题：如果结果是 REQUEST_CHANGES，方案不可行
   成本：问题泄露到后续阶段，修复成本指数增长

✅ CORRECT: Round 1 → Round 2 → Round 3 → REQUEST_CHANGES
            → 修复方案 → 重新评审 → ... → APPROVED → "评审完成"
   结果：得到可行方案
   成本：前期投入确保后期顺利
```

**Delphi 的终点不是"完成评审"，而是"得到可行方案"。**

### 质量优先原则

| 原则 | 说明 |
|------|------|
| **Token 消耗是投资** | 相比后期修复成本，评审的 token 消耗微不足道 |
| **多轮迭代不是浪费** | 确保方案可行，避免返工 |
| **发现问题要立即修复** | 不要记录问题然后继续，要修复后重新评审 |
| **APPROVED 才是终点** | 任何其他状态都需要继续工作 |

### 门禁固化

这些原则已固化到 Terminal State Checklist 中，**不可跳过**：

- 最终裁决必须是 APPROVED
- 所有 Critical Issues 必须已修复验证
- 所有 Major Concerns 必须已处理
- 问题共识必须 >= 91%

**如果任何条件未满足，评审不可声明完成。**

---

## 参数配置

### 专家数量

| 配置 | 专家数 | 适用场景 |
|------|--------|---------|
| `experts: 2` | 2位 (默认) | 代码变更、小型设计 |
| `experts: 3` | 3位 | 架构决策、需求文档、关键设计 |

### 模型分配

| 专家角色 | 2专家模式 | 3专家模式 |
|---------|----------|----------|
| Expert A | Qwen3.5-Plus | Qwen3.5-Plus |
| Expert B | MiniMax M2.5 | Kimi K2.5 |
| Expert C | - | MiniMax M2.5 |

> **模型选择理由**:
> - **Expert A (Qwen3.5-Plus)**: 阿里旗舰模型，推理能力强，适合架构和需求评审
> - **Expert B (MiniMax M2.5/Kimi K2.5)**: 不同视角，避免同源偏见

### 共识阈值

| 阈值 | 说明 |
|------|------|
| **>=91%** | 问题共识比例（推荐） |
| 100% | 完全一致（更严格） |

---

## 完整流程

```
┌─────────────────────────────────────────────────────────────┐
│                   Delphi Review Flow                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Phase 0: 准备                                       │    │
│  │ • 验证文档可读                                      │    │
│  │ • 确定专家数量 (2 或 3)                             │    │
│  │ • 分配模型角色                                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Round 1: 匿名独立评审 (Anonymous)                    │    │
│  │                                                      │    │
│  │ Expert A ──→ 评审 A (不知道 B/C 意见)               │    │
│  │ Expert B ──→ 评审 B (不知道 A/C 意见)               │    │
│  │ Expert C ──→ 评审 C (不知道 A/B 意见) [如3专家]     │    │
│  │                                                      │    │
│  │ 输出: 优点 + 问题清单(Critical/Major/Minor) + 裁决   │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 共识检查                                             │    │
│  │ • 裁决是否一致？                                     │    │
│  │ • 问题共识比例 >=91%？                               │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│              ┌───────────┴───────────┐                       │
│              │                       │                       │
│          一致 + >=91%          不一致 或 <91%               │
│              │                       │                       │
│              │                       ▼                       │
│              │            ┌─────────────────────┐            │
│              │            │ Round 2: 交换意见    │            │
│              │            │                      │            │
│              │            │ 每位专家看到其他专家 │            │
│              │            │ 的评审，响应关切    │            │
│              │            └──────────┬──────────┘            │
│              │                       │                       │
│              │                       ▼                       │
│              │            ┌─────────────────────┐            │
│              │            │ 共识检查             │            │
│              │            └──────────┬──────────┘            │
│              │                       │                       │
│              │           ┌───────────┴───────────┐           │
│              │           │                       │           │
│              │       一致 + >=91%          仍分歧             │
│              │           │                       │           │
│              │           │                       ▼           │
│              │           │            ┌─────────────────────┐ │
│              │           │            │ Round 3: 最终立场    │ │
│              │           │            │ (3专家时多数投票)    │ │
│              │           │            └──────────┬──────────┘ │
│              │           │                       │           │
│              │           │                       ▼           │
│              │           │            ┌─────────────────────┐ │
│              │           │            │ 共识检查             │ │
│              │           │            └──────────┬──────────┘ │
│              │           │                       │           │
│              ▼           ▼                       ▼           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 裁决检查                                             │    │
│  │ 最终裁决是 APPROVED 吗？                             │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│              ┌───────────┴───────────┐                       │
│              │                       │                       │
│          APPROVED           REQUEST_CHANGES / REJECTED       │
│              │                       │                       │
│              ▼                       ▼                       │
│         ┌────────┐           ┌─────────────────┐            │
│         │ ✅完成 │           │ 修复方案        │            │
│         └────────┘           └────────┬────────┘            │
│                                        │                     │
│                                        ▼                     │
│                              ┌─────────────────┐              │
│                              │ 重新评审        │              │
│                              │ (回到 Round 2) │              │
│                              └────────┬────────┘              │
│                                        │                     │
│                                        ▼                     │
│                              ┌─────────────────┐              │
│                              │ 继续迭代        │              │
│                              │ 直到 APPROVED   │              │
│                              └─────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

---

## Round 1: 匿名独立评审

### 为什么必须匿名？

```
如果 Expert A 知道 Expert B 的意见：
  • 可能产生 anchoring bias（锚定偏差）
  • 倾向于同意"权威"专家
  • 不敢提出相反观点
  • 独立思考被削弱
```

### 执行方式

**Expert A** 收到：
- 原始文档
- 评审模板
- 指令："独立评审，不知道其他专家意见"

**Expert B** 收到：
- 原始文档（相同）
- 评审模板（相同）
- 指令："独立评审，不知道其他专家意见"

**Expert C** (如果是3专家模式) 收到：
- 原始文档（相同）
- 评审模板（相同）
- 指令："独立评审，不知道其他专家意见"

### 输出格式

```markdown
## 独立评审 - Expert [A/B/C]

### 优点
1. [具体优点 + 文档位置]
2. [具体优点 + 文档位置]

### 问题清单

#### Critical Issues (必须修复才能批准)
1. [问题] - 位置: [行号/章节] - 修复建议: [...]
2. ...

#### Major Concerns (必须处理)
1. [问题] - 位置: [...] - 建议: [...]
2. ...

#### Minor Concerns (需要说明)
1. [问题] - 位置: [...]
2. ...

### 裁决
[APPROVED / REQUEST_CHANGES / REJECTED]

### 置信度
[X/10]

### 关键理由
1. [裁决的主要理由]
2. [次要理由]
```

---

## Round 2: 交换意见

### 执行方式

**Expert A** 收到：
- 原始文档
- Expert B 的评审（匿名，显示为"Expert B"）
- Expert C 的评审（如果是3专家模式）
- 指令："响应其他专家的关切，是否调整你的立场？"

**Expert B** 收到：
- 原始文档
- Expert A 的评审
- Expert C 的评审（如果是3专家模式）
- 指令："响应其他专家的关切，是否调整你的立场？"

**Expert C** (如果是3专家模式) 收到：
- 原始文档
- Expert A 的评审
- Expert B 的评审
- 指令："响应其他专家的关切，是否调整你的立场？"

### 输出格式

```markdown
## Round 2 Response - Expert [A/B/C]

### 响应其他专家关切

**Expert [X] 提到: [问题]**
- 我的立场: [同意/部分同意/不同意]
- 理由: [...]
- 如果同意: 我会将此问题加入我的问题清单

**Expert [Y] 提到: [问题]**
- 我的立场: [...]
- 理由: [...]

### 更新后问题清单

#### Critical Issues
[保留原有 + 新增同意的问题]

#### Major Concerns
[保留原有 + 新增同意的问题]

#### Minor Concerns
[保留原有 + 新增同意的问题]

### 更新后裁决
[APPROVED / REQUEST_CHANGES / REJECTED]

### 更新后置信度
[X/10]

### 立场变化说明
[是否变化，为什么]
```

---

## Round 3: 最终立场 (如需要)

### 触发条件

- Round 2 后仍无共识
- 2专家模式：裁决不一致
- 3专家模式：无 >=2/3 多数

### 执行方式

所有专家提交最终绑定立场：

```markdown
## Round 3 Final Position - Expert [A/B/C]

### 最终裁决
[APPROVED / REQUEST_CHANGES / REJECTED]

### 最终置信度
[X/10]

### 关键理由
1. [主要理由]
2. [次要理由]

### 与其他专家的差异
[我与其他专家的主要分歧点]
```

### 3专家模式的多数投票

如果 Round 3 后仍无完全一致：
- 2/3 或 3/3 同意 → 多数裁决生效
- 记录少数派意见
- 继续后续流程

---

## 修复与重新评审

### 如果最终裁决是 REQUEST_CHANGES 或 REJECTED

**必须执行**:

1. **修复方案**
   - 针对所有 Critical Issues 修复
   - 针对所有 Major Concerns 处理
   - 记录修复决策

2. **重新评审**
   - 回到 Round 2 (不是 Round 1)
   - 所有专家参与
   - 验证修复是否正确

3. **迭代**
   - 如果仍 REQUEST_CHANGES → 继续修复 → 重新评审
   - 直到 APPROVED

### 修复报告格式

```markdown
## 修复报告

### Critical Issues 修复

| Issue | 修复方案 | 文档位置 |
|-------|---------|---------|
| [问题1] | [修复内容] | [行号/章节] |
| [问题2] | [修复内容] | [行号/章节] |

### Major Concerns 处理

| Concern | 处理方案 | 位置 |
|---------|---------|------|
| [关切1] | [处理内容] | [...] |

### Minor Concerns 说明

| Concern | 说明 |
|---------|------|
| [关切1] | [为什么这样处理] |

### 请求重新评审
请各位专家验证修复是否正确。
```

---

## 终止条件

### 评审循环限制

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `max_review_rounds` | 5 | 最大评审轮数 |
| `timeout` | 60min | 单次评审超时 |
| `consensus_threshold` | 91% | 问题共识阈值 |

### 超过限制

如果超过 `max_review_rounds` 仍未 APPROVED:
1. 生成"未达成共识报告"
2. 列出剩余分歧点
3. **报告给人，由人决策**

---

## Terminal State Checklist

<MANDATORY-CHECKLIST>

### ⚠️ 门禁强制执行说明

**以下检查项是强制的门禁，不是"建议"或"提示"。**

**系统实现要求**：
- 在声明"评审完成"前，必须自动验证所有检查项
- 如果任何检查项失败，必须 BLOCK 并提示用户
- 不能跳过检查项，不能"信任"人工确认

---

### 你只能在以下条件全部满足后声明"Delphi review complete":

**Pre-requisites:**
- [ ] Phase 0 完成：文档验证，专家分配
- [ ] Round 1 完成：所有专家匿名独立评审
- [ ] Round 2 完成：所有专家交换意见
- [ ] Round 3+ (如需)：最终立场/多数投票

**CRITICAL - 共识验证:**
- [ ] 问题共识比例 >=91%
- [ ] 所有 Critical Issues 已解决
- [ ] 所有 Major Concerns 已处理

**CRITICAL - 裁决检查:**
- [ ] 最终裁决是 **APPROVED** 或 **APPROVED_WITH_MINOR**
- [ ] 如果 REQUEST_CHANGES → 已修复 → 已重新评审 → APPROVED

**Final Requirements:**
- [ ] 共识报告生成并保存
- [ ] 用户已确认报告

**IF 裁决是 REQUEST_CHANGES 或 REJECTED:**
- **CANNOT claim complete**
- **MUST 修复并重新评审**
- **CANNOT 记录问题然后继续**

**IF 任何条件未满足:**
- **CANNOT claim complete**
- **MUST BLOCK 并通知用户**

**门禁代码示例**:
```typescript
function validateTerminalState(reviewResult: DelphiResult): TerminalState {
  const checks = {
    phase0Complete: reviewResult.phase0 !== null,
    round1Complete: reviewResult.round1.verdicts.length > 0,
    round2Complete: reviewResult.round2.verdicts.length > 0,
    consensusThreshold: reviewResult.consensusRatio >= 0.91,
    criticalIssuesResolved: reviewResult.criticalIssues.every(i => i.resolved),
    majorConcernsHandled: reviewResult.majorConcerns.every(c => c.handled),
    verdictApproved: reviewResult.finalVerdict === 'APPROVED',
    reportSaved: reviewResult.reportPath !== null,
    userConfirmed: reviewResult.userConfirmation === true,
  };

  const allPassed = Object.values(checks).every(v => v);

  if (!allPassed) {
    return {
      status: 'BLOCKED',
      failedChecks: Object.entries(checks)
        .filter(([_, v]) => !v)
        .map(([k]) => k),
      message: '评审未完成，必须满足所有条件才能继续',
    };
  }

  return { status: 'APPROVED', message: '评审完成' };
}
```

</MANDATORY-CHECKLIST>

---

## Anti-Patterns

### ❌ 错误：声称完成但未 APPROVED

```
Round 1 → Round 2 → Round 3
→ 专家说 REQUEST_CHANGES
→ 生成报告说"评审完成"
→ 没有修复
→ 没有重新评审

❌ 这是错的！
```

### ✅ 正确：迭代直到 APPROVED

```
Round 1 → Round 2 → Round 3
→ 专家说 REQUEST_CHANGES
→ 修复方案
→ 重新评审 (Round 2)
→ 如果仍 REQUEST_CHANGES → 继续修复 → 重新评审
→ 直到 APPROVED
→ 生成最终共识报告
```

### ❌ 错误：只处理"关键"问题

```
Expert A: "Critical 1, Major 2, Minor 3"
Expert B: "Critical 1, Major 4"
→ 只处理 Critical 1

❌ 这是错的！零容忍原则要求处理所有问题。
```

### ✅ 正确：零容忍

```
→ 处理 Critical 1
→ 处理 Major 2, 4
→ 说明 Minor 3
→ 所有问题都有对应处理
```

---

## 示例工作流

### 场景：需求文档评审

```
User: "评审这个需求文档: [文档]"

→ 配置: experts=3 (需求文档重要)

→ Round 1: GLM-5, Kimi, MiniMax 独立评审
   - GLM-5: REQUEST_CHANGES (2 Critical, 3 Major)
   - Kimi: REQUEST_CHANGES (1 Critical, 2 Major)
   - MiniMax: APPROVED (0 Critical, 1 Major)

→ 共识检查: 1/3 APPROVED, 问题共识 60%
→ 状态: 需要继续

→ Round 2: 交换意见
   - GLM-5 看到 Kimi 和 MiniMax 的评审
   - Kimi 看到 GLM-5 和 MiniMax 的评审
   - MiniMax 看到 GLM-5 和 Kimi 的评审
   
→ Round 2 结果:
   - GLM-5: REQUEST_CHANGES (维持)
   - Kimi: REQUEST_CHANGES (维持)
   - MiniMax: REQUEST_CHANGES (调整为同意 Critical 1)

→ 共识检查: 0/3 APPROVED, 问题共识 85%
→ 状态: 仍未 APPROVED

→ Round 3: 最终立场
   - 所有专家维持 REQUEST_CHANGES

→ 裁决: REQUEST_CHANGES

→ 修复方案: 针对所有 Critical Issues 修复

→ 重新评审 (Round 2 起步)
   - GLM-5: APPROVED
   - Kimi: APPROVED
   - MiniMax: APPROVED

→ 共识: 100% APPROVED

→ ✅ Delphi Complete
```

---

## Red Flags

| 借口 | 现实 |
|------|------|
| "这只是小变更" | 所有变更都需要评审 |
| "用户很急" | 跳过评审会导致更多返工 |
| "我可以自己评审" | 自我评审违背独立原则 |
| "一个专家够了" | 一个专家会错过问题 |
| "评审是官僚主义" | 评审是投资，不是开销 |
| "Round 1 就够了" | 不够，必须多轮直到共识 |
| "专家几乎一致" | "几乎" = 不一致，继续 |
| "生成报告就完成了" | APPROVED 才算完成 |
| "只处理关键问题" | 零容忍，处理所有问题 |
| "2/3 同意就是共识" | 还要检查问题是否一致 |
| "流程太长" | 得到可行方案比快更重要 |

---

## 成功标准

**Delphi 评审完成的唯一标准：**

1. ✅ 所有专家裁决 APPROVED
2. ✅ 问题共识 >=91%
3. ✅ 所有 Critical Issues 已修复验证
4. ✅ 所有 Major Concerns 已处理
5. ✅ 共识报告已生成
6. ✅ 用户已确认

**缺少任何一项 = 未完成**