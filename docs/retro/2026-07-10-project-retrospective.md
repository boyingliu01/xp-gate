# XP-Gate 项目复盘报告

> **复盘日期**: 2026-07-10
> **项目周期**: 2026-04-07 ~ 2026-07-10 (约 3 个月)
> **最终版本**: v0.14.6.1
> **总提交数**: 498 commits
> **总发布数**: 27 releases

---

## 一、项目概述

XP-Gate 是一个确定性 Git 质量门禁 + AI 多专家评审（Delphi）+ Sprint Flow 全流程编排工具。项目从零开始，经过约 3 个月的密集开发，完成了包括 12 道质量门禁、13 种语言适配器、6 阶段 Sprint Flow 流水线、3 平台插件系统（Claude Code / OpenCode / Qoder）、npm 零安装分发等核心功能。

---

## 二、项目历程回顾

### 2.1 阶段划分

| 阶段 | 时间 | 版本范围 | 主题 | Commit 数 | 关键事件 |
|------|------|---------|------|-----------|----------|
| **孵化期** | 4/7 - 4/25 | 初始 → v0.0.5 | 概念验证，Git Hooks 基础设施 | ~50 | 建立 9 道质量门禁、TDD 原则引擎、Delphi 评审基础 |
| **基础建设期** | 4/26 - 5/29 | v0.0.6 → v0.5.1 | skill-cert 验证、插件系统、npm 分发 | ~120 | 跨平台插件（Claude/OpenCode/Qoder）、npm 零安装包、Sprint Flow 编排 |
| **功能爆发期** | 5/30 - 6/17 | v0.5.2 → v0.9.5 | Sprint Flow 成熟化、Gate 增强 | ~160 | 11→6 Phase 重构、TDD 强制执行、Gate 5a/5b、Gate M2/M3 策略 |
| **稳定完善期** | 6/18 - 7/10 | v0.9.6 → v0.14.6 | 质量打磨、CI 修复、多语言变异测试 | ~168 | Gate M 多语言、TUI 面板、session-rename、skill-cert 优化 |

### 2.2 关键里程碑

| 日期 | 里程碑 | 意义 |
|------|--------|------|
| 2026-04-07 | 首次提交 | 项目启动 |
| 2026-04-26 | skill-cert 通过 Phase 3 | 技能评价体系建立 |
| 2026-05-29 | 跨平台插件系统完成 | Claude Code / OpenCode / Qoder 三平台覆盖 |
| 2026-06-17 | Sprint Flow 重构为 6 Phase | 从 11 Phase 精简，降低认知负荷 |
| 2026-06-30 | Gate M 多语言变异测试 | 从 TS only 扩展到 Go/Java/Kotlin |
| 2026-07-09 | skill-cert 优化 Sprint Flow/Delphi | 质量闭环——用自身工具检验自身 |

### 2.3 按迭代的会话对应

| 迭代 | 会话数 | 主要产出 |
|------|--------|---------|
| 迭代 0（规划）| 1 次主会话 (868 msg) | open issues 分析、TUI 面板调研、迭代规划 |
| 迭代 1（skill-cert）| 1 次主会话 (300 msg) | delphi-review SKILL.md 优化、PR 合并 |
| 迭代 2（Gate M 多语言）| 1 次主会话 (579 msg) | Delphi 设计评审 + Go/Java/Kotlin 变异测试 |
| 迭代 3（next-sprint）| 1 次主会话 (429 msg) | next-sprint 命令封装、全局安装 |
| 迭代 4（next-sprint）| 1 次主会话 (115 msg) | xp-gate next-sprint 命令开发 |
| 迭代 5（TUI 面板）| 2 次主会话 (367+8 msg) | OpenCode TUI 面板多次尝试（未完全解决）|
| 迭代 6（6-phase）| 2 次主会话 (483+7 msg) | Sprint Flow 11→6 Phase 重构 + next-sprint |
| 迭代 7（4 issues）| 2 次主会话 (679+2 msg) | 变异测试、TDD 纪律、Gate 5 覆盖率 |
| 迭代 8（Session 恢复）| 1 次主会话 (98 msg) | VPN 中断后切换模型继续任务 |
| 迭代 9（11 issues）| 3 次主会话 (523+2+3 msg) | 批量处理遗留 issues、CI 修复、仪表盘 |
| 迭代 10（skill-cert）| 1 次主会话 (322 msg) | sprint-flow + delphi-review 结构性问题修复 |
| 复盘 | 1 次主会话 (2 msg) | 当前会话：重命名 + 复盘报告 |

---

## 三、数据统计

### 3.1 代码量

| 指标 | 数值 |
|------|------|
| 总 Commits | 498 |
| 总 Releases | 27 |
| 语言适配器 | 13 种（含 IaC）|
| 第三方适配器插件 | 5 个 |
| CI 工作流 | 5 个 |
| OpenCode 会话（主）| 21 个 |
| OpenCode 会话（含子代理）| 1500+ 个 |

### 3.2 开发节奏

```
高峰期（6/18: 27 commits/day） — Sprint Flow 重构 + Windows 兼容
次高峰（6/7: 25 commits/day）— 多 Issue 修复 + CI
稳定期（6/17-6/30: 15-20 commits/day）— 功能爆发期
```

---

## 四、经验总结

### 4.1 做得好的（Keep Doing）

#### 1. AI 驱动开发流程落地
- **全流程 AI 参与**：从需求分析（brainstorming）→ 设计评审（Delphi）→ 编码（ralph-loop + TDD）→ 验证（code-walkthrough）→ 发布（ship），形成完整闭环
- **自身工具的 dogfooding**：用 XP-Gate 开发 XP-Gate，用 skill-cert 评测 XP-Gate 的技能，形成质量正反馈
- **500 commits / 3 个月**：在单人开发的情况下，AI 辅助使产出速度远超传统模式

#### 2. 确定性门禁 + AI 共识评审的架构设计
- **Gate 0-11 纯代码逻辑**：不依赖 AI，保证提交质量的确定性
- **Delphi 评审**：3 个国产模型多轮匿名共识（≥90%），弥补单人视角盲区
- **互补关系**：确定性门禁保证下限，AI 评审提升上限

#### 3. 持续重构与精简
- **Sprint Flow 11→6 Phase**：大幅降低认知负荷
- **SKILL.md 瘦身**：76KB→28KB（-64%），提升 agent 解析效率
- **skill-cert 持续优化**：用评测数据驱动技能改进

#### 4. 多平台分发策略
- npm 包（git hooks）+ IDE 插件（AI 对话内工具）互补
- Claude Code / OpenCode / Qoder 三平台覆盖

### 4.2 可以改进的（Lessons Learned）

#### 1. 模型服务稳定性
- **问题**：迭代 7 和迭代 8 中，模型服务（whalecloud/LOCAL/Qwen3.5-122B）频繁出现负载过高、超时
- **影响**：被迫中断会话、切换模型供应商，浪费大量 token 和上下文
- **改进**：
  - 关键任务使用付费 API（如阿里百炼）而非自建服务
  - 利用 session 恢复机制（context-save / context-restore）
  - 提前准备备用模型供应商

#### 2. TUI 面板问题反复尝试
- **问题**：迭代 0 到迭代 5，TUI 面板（OpenCode sidebar 展示 Sprint 进度）问题反复尝试多次，最终仍未完全解决
- **根因**：
  - OpenCode TUI API 文档不全，缺乏官方示例
  - 对 TUI 渲染机制的理解不够深入
  - 每次尝试后发现问题，但未做充分的根本原因分析
- **改进**：
  - 遇到 2 次失败后应启动 Oracle 根因分析
  - 考虑降级方案（如 chat 消息内嵌状态）而非死磕 sidebar
  - 对平台底层 API 不明确的功能，先做技术预研

#### 3. Session 历史管理
- **问题**：1500+ 个会话（含子代理），大量未命名会话（仅显示 Session ID）
- **影响**：回溯困难，不知道哪个会话做了什么
- **改进**：
  - 本次复盘已批量重命名 21 个主会话
  - 后续 Sprint 结束时自动调用 `session-rename` 工具
  - 在 sprint-flow Phase 5 SHIP 中加入 session 命名步骤

#### 4. 迭代规划过于集中
- **问题**：迭代 9 一次性处理 11 个 open issues，会话长达 523 messages
- **影响**：上下文膨胀、调试困难、回滚风险高
- **改进**：坚持"小迭代、快交付"原则，单迭代 ≤5 issues

#### 5. "issues 累积"问题
- **问题**：项目过程中多次出现 open issues 累积到需要"批量处理"的状态
- **根因**：缺乏定期 issue grooming 习惯
- **改进**：
  - 每周五固定 issue triage
  - 使用 `xp-gate next-sprint` 命令自动化 issue 分析

### 4.3 教训清单（Action Items）

| # | 类别 | 问题 | 改进措施 | 优先级 |
|---|------|------|---------|--------|
| 1 | 基础设施 | 模型服务不稳定导致会话中断 | 关键任务使用付费 API 备用 | P0 |
| 2 | 技术选型 | TUI 面板投入过多时间未解决 | 先做技术预研、设止损时间 | P1 |
| 3 | 流程 | Session 未命名导致回溯困难 | 集成 session-rename 到 sprint-flow | P1 |
| 4 | 流程 | 单迭代 issue 过多 | 限制 ≤5 issues/迭代 | P1 |
| 5 | 流程 | Open issues 累积问题 | 每周五 issue triage | P2 |
| 6 | 基础设施 | 子代理会话污染数据库 | 定期清理 + 子代理会话自动标记 | P2 |

---

## 五、技术架构评价

### 5.1 架构亮点

```
确定性门禁 (Gate 0-11)
    ↕ 互补
AI 共识评审 (Delphi ≥90%)
    ↕ 编排
全流程流水线 (Sprint Flow 6 Phase)
    ↕ 分发
多平台插件 (Claude Code / OpenCode / Qoder)
```

- **分层清晰**：门禁层、评审层、编排层、分发层各司其职
- **渐进增强**：可以只用门禁（Git Hooks），也可以逐步启用 Delphi 和 Sprint Flow
- **零安装分发**：npm 包零依赖，IDE 插件自动更新

### 5.2 技术债务

| 债务 | 严重程度 | 说明 |
|------|---------|------|
| adapters 重复 | 中 | `githooks/adapters/` 和 `src/npm-package/adapters/` 双重维护 |
| TUI 面板未完成 | 中 | OpenCode sidebar 进度展示未完全实现 |
| 子代理会话膨胀 | 低 | 1500+ 个子代理会话占用数据库空间 |

---

## 六、下一个项目建议

### 6.1 流程层面
1. **从 Day 1 引入 session 命名机制**：每个开发会话自动命名，方便回溯
2. **设定技术预研止损时间**：对不确定的技术（如平台 API），设 2 小时上限，超时降级
3. **小迭代交付**：单迭代目标 ≤5 issues，单个会话目标 ≤200 messages
4. **定期 issue triage**：每周固定时间清理 open issues，避免累积

### 6.2 工具层面
1. **模型服务冗余**：同时配置 2+ 模型供应商，一键切换
2. **Session 恢复流程**：利用 context-save / context-restore 确保中断可恢复
3. **使用自身工具**：从项目开始就使用 xp-gate（如有），或至少使用类似质量门禁

### 6.3 架构层面
1. **避免文件重复**：从设计阶段就考虑单一事实源（Single Source of Truth）
2. **API 抽象层**：对平台/工具依赖做抽象，避免绑定特定平台 API
3. **先做 MVP 再扩展**：核心功能（门禁）→ 增强功能（Delphi）→ 编排（Sprint Flow）→ 分发（插件）

---

## 七、致谢

本项目大量依赖以下开源项目/工具：
- OpenCode（AI 编码平台）
- gstack skill 生态（autoplan, ship, land-and-deploy 等）
- superpowers skill 生态（brainstorming, TDD, systematic-debugging 等）
- Stryker Mutator（变异测试）
- ESLint, Biome, Ruff, shellcheck 等静态分析工具
- jscpd, lizard, gitleaks, semgrep, checkov 等质量工具
- 国产模型：DeepSeek, Kimi, Qwen, GLM, MiniMax

---

> **复盘人**: Sisyphus (AI Agent)
> **项目地址**: https://github.com/boyingliu01/xp-gate
> **版本**: v0.14.6.1
