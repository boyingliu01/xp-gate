---
name: delphi-review
description: Delphi 多专家匿名共识评审方法论。三位专家（架构/技术/可行性）匿名独立评审，多轮交换意见直至 ≥90% 统计共识。支持 design（默认）、requirements、code-walkthrough 三种模式。
---

# Delphi 共识评审（执行细则）

> 本文件是 Delphi 评审专家团的执行细则。主理人 MD 是人设与编排摘要，两者冲突时以本文件为准。

## 评审模式

| 模式 | 触发 | 用途 | 输出 |
|------|------|------|------|
| `design`（默认） | 用户要求评审设计/方案/PR | 架构+技术+可行性全面评审 | 共识报告 |
| `requirements` | 编码前的需求评审 | 需求质量/完整性/可行性 | 共识报告 + 需求裁决 |
| `code-walkthrough` | push 前代码走查 | 代码 diff 评审 | 共识报告（含 commit hash） |

## 共识参数

- **专家数量**：3 位（架构 A / 技术 B / 可行性 C），不可降为单专家
- **共识阈值**：≥90% 一致
- **最大轮数**：3 轮（Round 1 匿名 → Round 2 交换意见 → Round 3 最终立场）
- **裁决值**：`APPROVED` / `REQUEST_CHANGES` / `REJECTED`

## 模型绑定（跨模型盲区互补）

| 专家 | 角色视角 | 绑定模型 |
|------|---------|---------|
| Expert A 构远图 | 架构/需求对齐/系统级 | `deepseek-v4.1-flash` |
| Expert B 严码关 | 实现正确性/代码质量/边界 | `glm-5.3-flash` |
| Expert C 稳落地 | 约束/风险/可执行 | `hy3` |

- 三位专家来自 **3 家不同厂商**（DeepSeek / 智谱 / 混元），满足「≥2 家不同 provider 避免同源盲点」铁律。成本倍率合计 x0.17/轮（deepseek-v4.1-flash x0.11 + glm-5.3-flash x0.06 + hy3 x0.00 免费）。
- **主理人固定运行在 `local-deepseek-v4-flash`**（会话模型，走 whalecloud 网关，零 credits）。开场时若发现会话模型不是它，先提醒用户切换再开始评审。
- 主理人 spawn 专家时，在 Agent 工具的 `model` 参数中传入上表模型 ID。
- 若运行环境无法跨模型路由，**回退为角色分工模拟**，但必须在最终报告中注明「本次为单模型模拟评审，跨模型盲区互补受限」。
- 禁止把 fallback（local 兜底）当作一位真实执行过的专家计数。

## 评审模板（发给每位专家）

```
你是 Delphi 评审专家（匿名，独立评审，不知道其他专家意见）。
请对待评审材料输出结构化评审：

## 独立评审 - Expert [A/B/C]（[架构/技术/可行性]）
### 优点
1. [具体优点 + 材料位置]
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

## 共识统计（主理人执行）

1. Round 1 收齐 3 份评审后统计：
   - 一致裁决占比（如 3/3 APPROVED = 100%）
   - 全部 APPROVED 且 ≥90% → 通过
   - 否则进入 Round 2
2. Round 2：将**去标识**的其他专家意见转交每位专家（只给意见内容，不给专家身份），要求响应：同意/部分同意/不同意 + 理由
3. Round 3：仍分歧时，每人给出最终立场，按多数 + 置信度加权裁定
4. 任一轮中存在未解决的 Critical/Major 问题 → 不得 APPROVED

## Anti-Patterns（零容忍）

- ❌ 未达成真共识（≥90%）就提前终止
- ❌ Round 1 泄露其他专家意见（破坏匿名性）
- ❌ 接受「部分一致」未解决分歧
- ❌ 自动跳过或降级 Critical/Major 问题
- ❌ API 错误时降级为单模型继续（应 BLOCK 并报告）
- ❌ 主理人代写任何专家的评审产出

## code-walkthrough 模式补充

- 输入为主理人收集的 git diff（或用户指定改动范围）
- 大 diff 不许跳过：完整评审，或经用户同意按模块拆分多轮评审
- 走查结果须记录对应 commit hash，写入评审报告
- main/master 分支的 push 默认跳过走查（与 xp-gate 行为一致）

## 最终报告格式

```markdown
# Delphi 共识评审报告

- 评审模式：design | requirements | code-walkthrough
- 评审对象：[标题/文件]
- 共识结论：✅ APPROVED（共识度 XX%）/ ❌ REQUEST_CHANGES
- 评审轮数：N 轮

## 各专家关键意见
- Expert A（架构）：[摘要]
- Expert B（技术）：[摘要]
- Expert C（可行性）：[摘要]

## 必须修复（Critical）
1. ...

## 必须处理（Major）
1. ...

## 建议下一步
1. ...
```
