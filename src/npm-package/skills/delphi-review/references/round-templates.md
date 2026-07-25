# Delphi Round Templates

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

## Round 3: 最终立场（如需要）

触发条件：Round 2 后仍无共识。所有专家提交最终绑定立场。3 专家模式下若仍无完全一致，2/3 或 3/3 多数裁决生效，记录少数派意见。

### 输出格式

```markdown
## Round 3 Final Position - Expert [A/B/C]
### 最终裁决: [APPROVED / REQUEST_CHANGES / REJECTED]
### 最终置信度: [X/10]
### 关键理由 + 与其他专家的差异
```

## 修复报告格式

```markdown
## 修复报告
### Critical Issues 修复 | ### Major Concerns 处理 | ### Minor Concerns 说明
### 请求重新评审
```

---

## Requirements Mode: Round 1（匿名独立需求评审）

### 执行方式

2 位专家（architecture + feasibility）独立收到：需求陈述 + CONTEXT.md + grill session 摘要 + "独立评审需求完整性，不知道其他专家意见"。

### 输出格式

```markdown
## Requirements Review - Expert [A(architecture)/B(feasibility)]

### 需求摘要
[被评审需求的简短概括]

### 评审焦点
- 需求完整性: [评估]
- 需求→AC 映射: [评估]
- 场景覆盖: [评估]
- AC 可测试性: [评估]
- 用户画像清晰度: [评估]
- 范围边界: [评估]

### 缺口清单 (Gaps)
#### Critical Gaps (必须解决才能进入设计)
1. [缺口描述] - 影响: [...] - 补充建议: [...]
#### Minor Gaps (建议补充但不阻塞)
1. [...]

### 裁决: [APPROVED / GAPS_FOUND]
### 置信度: [X/10]
### 关键理由
1. [...]
```

## Requirements Mode: Round 2（带上下文的补充评审，如需要）

### 触发条件

Round 1 裁决为 GAPS_FOUND，grill-with-docs 补充访谈后重新评审。

### 执行方式

2 位专家收到：更新后的需求陈述 + CONTEXT.md + **Round 1 gaps 列表** + "评估 Round 1 缺口是否已修复，是否有新缺口"。

### 输出格式

```markdown
## Requirements Review Round 2 - Expert [A(architecture)/B(feasibility)]

### Round 1 缺口修复验证
| Round 1 Gap | 状态 | 说明 |
|-------------|------|------|
| [gap 描述] | ✅ 已修复 / ❌ 仍存在 | [验证说明] |

### 新发现缺口（如有）
1. [新缺口描述]

### 裁决: [APPROVED / GAPS_FOUND]
### 置信度: [X/10]
### 立场变化说明
[与 Round 1 相比的立场变化]
```

> ⚠️ Round 2 后仍 GAPS_FOUND → `escalation_needed: true`，升级给用户决策。禁止 Round 3。
