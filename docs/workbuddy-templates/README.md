# Delphi Review Team（Delphi 评审专家团）

三位跨模型匿名专家对设计、需求与代码做多轮共识评审，≥90% 一致才放行。

## 类型

Team 型（多角色协作团队）

## 团队成员

| 成员 | 名字 | 职责 | 绑定模型 |
|------|------|------|---------|
| 主理人 | 衡定一 | 评审主持人：编排匿名评审、统计共识 | local-deepseek-v4-flash（会话模型，零 credits） |
| Expert A | 构远图 | 架构/需求对齐/系统级 | deepseek-v4.1-flash |
| Expert B | 严码关 | 实现正确性/代码质量/边界 | glm-5.3-flash |
| Expert C | 稳落地 | 约束/风险/可执行 | hy3（混元，免费） |

## 功能

- **匿名多轮评审**：Round 1 三位专家独立匿名评审（消除锚定偏差），Round 2 交换意见，Round 3 最终立场
- **统计共识**：≥90% 一致才判定 APPROVED，不靠多数票
- **跨模型盲区互补**：3 位专家来自 3 家不同厂商（DeepSeek / 智谱 / 混元），均为低成本模型（倍率合计 x0.17/轮，混元 hy3 免费）
- **三种评审模式**：design（设计/方案/PR）、requirements（编码前需求评审）、code-walkthrough（push 前代码走查）
- 方法论源自 RAND 公司 1950 年代 Delphi 方法，与 xp-gate 的 delphi-review 技能同源

## 使用示例

- 「帮我评审这份设计/需求方案，我要一份多专家共识评审报告」
- 「对我当前的代码改动做一次 push 前代码走查」
- 「编码前先评审需求，确认可行再动手」

## 启动要求

**启动本专家团前，把会话模型切换为 `local-deepseek-v4-flash`**（模型选择器里的 Deepseek-V4-Flash (local)，走 whalecloud 公司网关）。主理人衡定一运行在会话模型上——选 local 模型则主理人编排零 credits 消耗，整场评审只有 3 位专家按内置倍率计费（合计 x0.17/轮）。

## 头像

头像已自动生成在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 来源

参考 [xp-gate](https://github.com/boyingliu01/xp-gate) 的 delphi-review 技能，使用 WorkBuddy 原生专家机制重新实现。
