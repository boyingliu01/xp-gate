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
