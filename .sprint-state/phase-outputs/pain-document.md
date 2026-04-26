# Pain Document - Skill Effectiveness Validation

## 生成日期
2026-04-26

## 需求现实

**真实用户是否需要？** 是。XGate 项目的 3 个 LLM-dependent skill（delphi-review、sprint-flow、test-specification-alignment）即将共享给团队成员，但从未做过系统性验证。目前存在：
- skill 被大模型忽略（不触发或跳过）
- skill 步骤被跳过（agent 不遵循完整 workflow）
- skill 产生幻觉（输出不符合 skill 定义的行为）
- 跨次执行不一致（同一 prompt 不同次运行结果差异大）

**替代方案？** 目前无替代。唯一的"验证"是人工试用后靠感觉判断。

**为什么还没有用替代方案？** 因为市面上没有专门针对 markdown-based AI skill 的验证方案，需要组合多个工具。

## 当前状态

**用户现在怎么解决？** 依靠人工 review + 直觉判断 skill 是否有效。每次发现 skill 问题时手动调整 SKILL.md，没有量化数据支撑改进方向。

**现状有多糟糕？**
- 无法量化 skill 的触发率（trigger accuracy）
- 无法量化 skill 的步骤遵循率（step adherence）
- 无法检测模型更新后的回归（model update regression）
- 团队共享后，其他人遇到 skill 失效不知道是 skill 问题还是使用方式问题
- 缺乏基线数据，无法判断改进是否有效

## 绝望的具体性

**场景**：团队成员安装 delphi-review skill 后，在需要评审设计文档时：
1. LLM 完全没有触发 delphi-review（忽略 skill description 中的触发条件）
2. 触发了但只执行 Round 1 就停下来，跳过了 Round 2 交换意见
3. 触发了但 Expert A/B 的评审质量很差，不符合 skill 定义的标准
4. 昨天能用，今天模型更新后行为变了

每个场景都导致"评审完成"的假象，但实际评审质量不达标。

## 最窄切入点

**最小可行切入点**：为 3 个 LLM-dependent skill 各创建一套 eval 测试用例，使用 Anthropic skill-creator 的 eval 框架 + promptfoo 的交叉验证，生成首次验证报告。

不需要一次性做到 CI/CD 自动化，先有**量化数据**再说。

## 观察证据

- 用户自己使用 sprint-flow 和 delphi-review 时，偶尔发现步骤被跳过
- 项目 skills 目录下没有 evals/ 目录、没有 benchmark 数据、没有验证报告
- skill-creator 工具已经安装（在 ~/.config/opencode/skills/skill-creator/），但从未对 XGate skills 执行过 eval
- 学术研究证实：skill 的收益在真实场景下是脆弱的（arXiv:2604.04323）

## 未来适配

**3-5 年是否仍然存在？** 是。AI agent skill 生态系统正在快速发展，skill 质量验证会成为基础设施需求。随着 skill 数量增长和团队规模扩大，验证需求只会增加。

**是否会被技术变化淘汰？** 不会。底层验证方法论（交叉验证、回归测试、行为漂移检测）是通用的，具体工具可能变化但需求不会消失。

## Pain Statement (一句话痛点)

**XGate 的 3 个 LLM skill 即将共享给团队，但从未做过有效性验证——无法保证 skill 不被忽略、不跳步骤、不产生幻觉，也检测不了模型更新导致的回归。**

## Proposed Solution (建议方案)

### 分层验证策略

| 层级 | 验证内容 | 工具 | 优先级 |
|------|---------|------|--------|
| L1 | 触发准确性（skill 是否该触发时触发） | skill-creator description optimization | P0 |
| L2 | 输出正确性（skill 触发后输出是否正确） | skill-creator eval + promptfoo 交叉验证 | P0 |
| L3 | 步骤遵循性（agent 是否遵循 skill 定义的工作流） | 自定义 checklist 验证 + Attest | P1 |
| L4 | 执行稳定性（同一 skill 多次运行结果一致性） | 多次运行方差分析 + Calibra | P1 |
| L5 | 回归预防（CI/CD 集成） | promptfoo CI + pre-commit hook | P2 |

### 交付物

1. 每个 skill 的 `evals/evals.json` 测试用例文件
2. 每个 skill 的首次验证报告（含 L1-L4 量化指标）
3. 验证框架文档（供后续 skill 复用）
4. 改进建议（基于验证结果的 skill 优化方向）

### 待验证的 LLM-dependent Skills

| Skill | 类型 | 主要风险 |
|-------|------|---------|
| delphi-review | 多轮匿名评审 | 步骤跳过（Round 1后停止）、Expert评审质量、共识计算错误 |
| sprint-flow | 多阶段编排 | 阶段跳过、暂停点被忽略、Phase 4 人工验收被自动化 |
| test-specification-alignment | 测试对齐 | Phase 2 freeze 被忽略、specification 解析幻觉、对齐分数计算偏差 |
