---
name: delphi-review
description: "Delphi consensus review: multi-round anonymous expert review until unanimous APPROVAL. Supports design/code-walkthrough modes. 2-3 experts from different providers. MANDATORY before implementation, design, or architecture decisions. Trigger: 'review this design', '评审这个需求', 'design review', '多专家评审', 'consensus review', 'code walkthrough', 'push review', or any request for multi-expert review of requirements, design docs, architecture, or PRs."
---

# Delphi Consensus Review

## 核心原则

**Delphi 方法只有一个目的：得到所有专家一致认可的可行方案。**

### 四大核心特性（RAND 方法论）

1. **匿名性** — Round 1 专家互不知道对方意见
2. **迭代** — 多轮直到共识，不是固定轮数
3. **受控反馈** — 每轮看到其他专家意见
4. **统计共识** — >=91% 一致才算共识

### 质量优先

| 原则 | 说明 |
|------|------|
| Token 是投资 | 相比后期修复成本，评审消耗微不足道 |
| APPROVED 才是终点 | REQUEST_CHANGES 必须修复并重新评审 |
| 零容忍 | Critical/Major 问题全部必须处理，不可跳过或降级 |

详见：Anti-Patterns 章节。

---

## 评审模式

| 模式 | 触发 | 用途 | 输出 |
|------|------|------|------|
| `design`（默认） | `/delphi-review` | 需求/设计/架构/PR 评审 | 共识报告 + specification.yaml |
| `code-walkthrough` | `/delphi-review --mode code-walkthrough` | git push 前代码走查 | `.code-walkthrough-result.json` |

**Code Walkthrough 模式**的完整规范已移至 `references/code-walkthrough.md`。当用户使用 `--mode code-walkthrough` 时，读取该文件并执行其中定义的全部流程。

---

## 参数配置

### 专家数量与角色

| 配置 | 专家 | 适用场景 |
|------|------|---------|
| 2 专家（默认） | A(架构) + B(实现) | 代码变更、小型设计 |
| 3 专家 | A(架构) + B(实现) + C(可行性仲裁) | 架构决策、需求文档 |

> ⚠️ 至少选择 **两家不同 provider** 的模型，避免同源盲点。模型映射见 `INSTALL.md`。

### 共识阈值

| 阈值 | 说明 |
|------|------|
| **>=91%** | 推荐默认 |
| 100% | 完全一致（更严格） |

---

## 完整流程

```
Phase 0: 准备 → Round 1: 匿名独立评审 → 共识检查
    │
    ├─ 一致 + >=91% + APPROVED → ✅ 完成
    │
    └─ 不一致 或 <91% 或 REQUEST_CHANGES
          │
          ▼
       Round 2: 交换意见 → 共识检查
          │
          ├─ 一致 + >=91% + APPROVED → ✅ 完成
          │
          └─ 仍分歧 或 REQUEST_CHANGES
                │
                ▼
             Round 3: 最终立场 → 共识检查
                │
                ├─ APPROVED → ✅ 完成
                │
                └─ REQUEST_CHANGES → 修复方案 → 回到 Round 2 重新评审
```

---

## Round 1: 匿名独立评审

### 为什么必须匿名

匿名防止 anchoring bias（锚定偏差）—— 知道其他专家意见后倾向于同意"权威"，不敢提出相反观点。

### 执行方式

每位专家独立收到：原始文档 + 评审模板 + "独立评审，不知道其他专家意见"。

### 输出格式

```markdown
## 独立评审 - Expert [A/B/C]
### 优点
1. [具体优点 + 文档位置]
### 问题清单
#### Critical Issues (必须修复才能批准)
1. [问题] - 位置: [...] - 修复建议: [...]
#### Major Concerns (必须处理)
1. [...]
#### Minor Concerns (需要说明)
1. [...]
### 裁决: [APPROVED / REQUEST_CHANGES / REJECTED]
### 置信度: [X/10]
### 关键理由
1. [...]
```

---

## Round 2: 交换意见

### 执行方式

每位专家看到：原始文档 + 其他专家的评审 + "响应其他专家的关切，是否调整立场？"

### 输出格式

```markdown
## Round 2 Response - Expert [A/B/C]
### 响应其他专家关切
**Expert [X] 提到: [问题]**
- 我的立场: [同意/部分同意/不同意] - 理由: [...]
### 更新后问题清单 / 裁决 / 置信度 / 立场变化说明
```

---

## Round 3: 最终立场（如需要）

触发条件：Round 2 后仍无共识。所有专家提交最终绑定立场。3 专家模式下若仍无完全一致，2/3 或 3/3 多数裁决生效，记录少数派意见。

### 输出格式

```markdown
## Round 3 Final Position - Expert [A/B/C]
### 最终裁决: [APPROVED / REQUEST_CHANGES / REJECTED]
### 最终置信度: [X/10]
### 关键理由 + 与其他专家的差异
```

---

## 修复与重新评审

如果最终裁决是 REQUEST_CHANGES 或 REJECTED：
1. 修复所有 Critical Issues + 处理所有 Major Concerns
2. 重新评审（从 Round 2 起步，不是 Round 1）
3. 迭代直到 APPROVED

修复报告格式：
```markdown
## 修复报告
### Critical Issues 修复 | ### Major Concerns 处理 | ### Minor Concerns 说明
### 请求重新评审
```

---

## 终止条件

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `max_review_rounds` | 5 | 超过后生成"未达成共识报告"，交人决策 |
| `timeout` | 60min | 单次评审超时 |

---

## Output Format (MANDATORY)
Every review round output MUST follow this exact JSON structure:

```json
{
  "expert_id": "A|B|C",
  "round": 1,
  "mode": "design|code-walkthrough",
  "verdict": "APPROVED|REQUEST_CHANGES|REJECTED",
  "confidence": 9,
  "critical_issues": ["..."],
  "major_concerns": ["..."],
  "minor_concerns": ["..."],
  "consensus_report": {
    "agreed_items": ["..."],
    "disagreed_items": ["..."],
    "final_verdict": "APPROVED|REQUEST_CHANGES"
  }
}
```

**Anti-patterns mapping to assertions:**
- `Round 1 → 生成报告 → "评审完成"` → Output MUST NOT have `verdict: APPROVED` if `critical_issues` exist.
- `只处理 Critical，忽略 Major` → Output MUST include `major_concerns` array, even if empty.
- `用户说"时间紧急"就跳过` → Output MUST include `round` field, proving multi-round process.

---

## Terminal State Checklist

<MANDATORY-CHECKLIST>

### 你只能在以下条件全部满足后声明"Delphi review complete":

**Pre-requisites:**
- [ ] Phase 0 完成（文档验证 + 专家分配）
- [ ] Round 1 完成（所有专家匿名独立评审）
- [ ] Round 2+ 完成（交换意见 / 最终立场）

**CRITICAL — 共识验证:**
- [ ] 问题共识比例 >=91%
- [ ] 所有 Critical Issues 已解决
- [ ] 所有 Major Concerns 已处理

**CRITICAL — 裁决检查:**
- [ ] 最终裁决是 **APPROVED** 或 **APPROVED_WITH_MINOR**
- [ ] 如果 REQUEST_CHANGES → 已修复 → 已重新评审 → APPROVED

**Final Requirements:**
- [ ] 共识报告生成并保存
- [ ] 用户已确认报告

**IF 裁决是 REQUEST_CHANGES 或 REJECTED → CANNOT claim complete, MUST 修复并重新评审**
**IF 任何条件未满足 → CANNOT claim complete, MUST BLOCK 并通知用户**

### ⭐ APPROVED 后必做

**Design mode**: 自动生成 specification.yaml（从设计文档提取需求）。specification.yaml 是 test-specification-alignment 的输入，没有它 test-spec 会进入不推荐的 legacy mode。

**Code-walkthrough mode**: 写入 `.code-walkthrough-result.json`（commit hash 匹配 HEAD，expires = timestamp + 1小时）。详见 `references/code-walkthrough.md`。

</MANDATORY-CHECKLIST>

---

## Anti-Patterns

| ❌ 错误 | ✅ 正确 |
|---------|---------|
| Round 1 → 生成报告 → "评审完成"（未 APPROVED） | 迭代直到 APPROVED，修复后重新评审 |
| 只处理 Critical，忽略 Major | 零容忍：Critical/Major 全部必须处理，不可跳过或降级 |
| 单专家自评 | 至少 2 位不同 provider 的专家 |
| 用户说"时间紧急"就跳过 | 评审是投资不是开销，跳过后期返工成本更高 |
| "专家几乎一致"就通过 | "几乎" = 不一致，继续到 >=91% |

**Code-walkthrough 专属 Anti-Patterns**: 详见 `references/code-walkthrough.md`。

---

## Red Flags

| 借口 | 现实 |
|------|------|
| "这只是小变更" | 所有变更都需要评审 |
| "Round 1 就够了" | 不够，必须多轮直到共识 |
| "生成报告就完成了" | APPROVED 才算完成 |
| "2/3 同意就是共识" | 还要检查问题共识比例 >=91% |

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
