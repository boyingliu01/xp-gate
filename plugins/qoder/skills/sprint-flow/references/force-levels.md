# Sprint Flow 执行级别定义

**执行时机**: Phase 2/6 DESIGN 之前，PREP AUTO-ESTIMATE 完成后。

**目的**: 根据需求规模调整上下文深度与迭代预算，平衡质量保障与效率。Force level 永远不改变专家数量或批准语义。

**核心原则**:
- 所有级别**必须经过 Delphi 评审**，不可跳过
- 所有级别都采用 architecture、technical、feasibility 三专家 Delphi；Round 1 独立执行并验证三份成功结果
- 模型 ID、provider、vendor、gateway 和国籍不受限制；`requested_model` trimmed 后必须 distinct
- 评审达到 ≥90% 共识，最多 5 轮；失败或无法验证时阻断
- 自动升级机制：当出现风险信号时强制升级级别

---

## 级别定义

| 级别 | 适用场景 | 专家数 | 最多轮数 | 通过条件 | 预计耗时 |
|------|---------|--------|---------|----------|---------|
| **轻量** | 小改动、局部修改、删除代码 | 3 | 1-5 | ≥90% 聚合共识 | 10-20 分钟 |
| **标准** | 常规功能开发、模块重构 | 3 | 1-5 | ≥90% 聚合共识 | 30-60 分钟 |
| **复杂** | 核心模块、跨模块变更、新增架构 | 3 | 1-5 | ≥90% 聚合共识 | 1-2 小时 |

---

## Token 成本预算

| 级别 | delphi-review 调用 | 预计 Token 消耗 | 成本说明 |
|------|-------------------|--------------|---------|
| **轻量** | 1 次（3 专家、最多 5 轮） | ~8,000 | 简化上下文，仍需完整执行 |
| **标准** | 1-2 次（3 专家、最多 5 轮） | ~15,000-25,000 | 可能需要反馈轮次 |
| **复杂** | 1-3 次（3 专家、最多 5 轮） | ~30,000-60,000 | 多轮深度评审 |

> **成本计算依据**: 基于实际 Sprint 历史数据，假设每次 delphi-review 调用平均消耗 8,000-10,000 Token（含 3 位专家的输入输出）。

---

## 测试与验证要求

| 级别 | 单元测试 | 测试覆盖率 | 验证方式 |
|------|---------|-----------|---------|
| **轻量** | 修改处必须有测试 | ≥75% | 自动运行 + 人工抽查 |
| **标准** | 新增功能必须有测试 | ≥80% | 自动运行 + 人工复核 |
| **复杂** | 全链路测试 + 边界用例 | ≥85% | 自动运行 + Delphi 验证 |

**强制规则**:
- 轻量级修改**不可跳过测试**，至少添加回归测试
- 所有级别必须通过 `test-specification-alignment` 验证
- 未添加测试 → 自动升级至标准级别

---

## 自动升级机制

当出现以下任一情况时，**强制升级**至更高级别：

| 触发条件 | 原级别 | 升级至 | 说明 |
|---------|--------|--------|------|
| Delphi 评审出现 REQUEST_CHANGES | 轻量 | 标准 | 需要第二轮评审 |
| 专家意见分歧 | 轻量/标准 | 复杂 | 增加上下文深度与后续轮次预算，不增加或替换专家 |
| 涉及公共 API 变更 | 轻量 | 标准 | 影响外部调用方 |
| 修改文件数 > 5 或 LOC > 200 | 轻量 | 标准 | 改动规模超出轻量范围 |
| 存在循环依赖 | 轻量/标准 | 复杂 | 架构风险高 |
| 测试覆盖率 < 75% | 轻量 | 标准 | 质量不达标 |
| 修改核心模块（core/handlers） | 轻量/标准 | 复杂 | 关键路径 |

**升级流程**:
1. 自动检测触发条件
2. 输出升级警告：`[LEVEL_UPGRADE] 从 {原级别} 升级至 {新级别}，原因：{触发条件}`
3. 保存升级记录到 `.sprint-state/level-upgrade-log.json`
4. 重新执行对应级别的评审流程

---

## 与 AUTO-ESTIMATE 的关系

AUTO-ESTIMATE 提供**初始级别建议**（Phase 1/6 PREP），Force Levels 定义**具体执行规则**：

```
AUTO-ESTIMATE 输出 → Force Levels 执行 → 自动升级机制（如触发）
```

| AUTO-ESTIMATE 指标 | 建议级别 | Force Levels 执行 |
|-------------------|---------|------------------|
| 引用计数 ≤ 3 + 跨模块 ≤ 1 | 轻量 | 3 专家、最多 5 轮 Delphi |
| 引用计数 4-10 或 跨模块 2 | 标准 | 3 专家、最多 5 轮 Delphi |
| 引用计数 > 10 或 跨模块 ≥ 3 | 复杂 | 3 专家、最多 5 轮 Delphi |
| 存在循环依赖 | 强制复杂 | 3 专家、最多 5 轮 + 架构评审 |

**关键区别**:
- AUTO-ESTIMATE: **客观指标分析**（代码结构、引用计数）
- Force Levels: **执行规则定义**（评审流程、升级机制）

---

## 与 DELPHI-GATE 的关系

**DELPHI-GATE** 是 Phase 3/6 BUILD 的**强制门禁**，检查 `.sprint-state/delphi-reviewed.json` 的 `verdict=APPROVED`。Force Levels 定义**产生该门禁文件的评审强度**：

| 场景 | DELPHI-GATE | Force Levels |
|------|------------|-------------|
| Phase 2/6 DESIGN 设计评审 | 3 专家、≥90% 共识、生成 specification.yaml | 不适用（设计阶段） |
| Phase 3/6 BUILD 入口 | **必须检查** `.sprint-state/delphi-reviewed.json` 中 `verdict=APPROVED` | 轻量/标准/复杂：通过对应强度的 delphi-review 生成该门禁文件 |
| 轻量级评审 | 生成 `delphi-reviewed.json`（3 专家、最多 5 轮、≥90% 聚合共识） | 3 专家、最多 5 轮、写入门禁文件 |
| 标准级评审 | 生成 `delphi-reviewed.json`（3 专家、最多 5 轮、≥90% 聚合共识） | 3 专家、最多 5 轮、写入门禁文件 |
| 复杂级评审 | 生成 `delphi-reviewed.json`（3 专家、最多 5 轮、≥90% 聚合共识） | 3 专家、最多 5 轮、写入门禁文件 |
| Phase 4/6 VERIFY 代码走查 | 再次检查 `delphi-reviewed.json` 或重新评审 | 复用 Force Levels 规则 |

**关键规则**:
- **DELPHI-GATE 永不跳过**：Phase 3/6 BUILD 入口必须检查 `.sprint-state/delphi-reviewed.json` 中 `verdict=APPROVED`
- **Force Levels 定义上下文强度**：所有级别都用三专家、distinct model IDs 和最多 5 轮来**产生**门禁文件
- **轻量级不是跳过评审**：只缩短上下文，不减少专家或共识验证
- **LIGHTWEIGHT ≠ ONE-EXPERT**: 1 专家违反 Delphi 核心原则，禁止

---

## 轻量级详细规则

**适用场景**:
- 删除已存在代码（如移除废弃模块）
- 小规模修改（≤ 5 个文件、≤ 200 行改动）
- 不涉及公共 API
- 无循环依赖

**执行流程**:
1. 三位专家独立评审并验证 distinct requested_model
2. 最多 5 轮迭代，直到达到 ≥90% 聚合共识
3. 三份成功结果且 APPROVED 才通过
4. 评审通过后写入 `.sprint-state/delphi-reviewed.json`

**输出文件** (`.sprint-state/delphi-reviewed.json`):
```json
{
  "sprint_id": "sprint-2026-06-05-01",
  "level": "轻量",
  "delphi_review": {
    "experts": ["architecture-model", "technical-model", "feasibility-model"],
    "rounds": 1,
    "votes": {
      "expert_a": "APPROVED",
      "expert_b": "APPROVED",
      "expert_c": "APPROVED"
    },
    "consensus": ">=90% APPROVED",
    "timestamp": "2026-06-05T10:30:00Z"
  },
  "status": "passed"
}
```

**强制升级条件**（轻量级触发）:
- 任一专家 REQUEST_CHANGES → 升级至标准级
- 涉及公共 API → 升级至标准级
- 修改文件 > 5 或 LOC > 200 → 升级至标准级

---

## 标准级详细规则

**适用场景**:
- 常规功能开发
- 模块重构（不涉及架构变更）
- 中等规模改动（5-15 个文件、200-500 行改动）

**执行流程**:
1. 三位专家独立评审（Round 1）
2. 如有 REQUEST_CHANGES，继续后续轮次（最多 5 轮）
3. 三份成功结果聚合达到 ≥90% 才通过
4. 评审通过后写入 `.sprint-state/delphi-reviewed.json`

**升级至复杂级条件**:
- Round 5 仍未达到共识 → BLOCK，不能以仲裁或多数票绕过
- 涉及核心模块（core/handlers）→ 升级至复杂级
- 存在循环依赖 → 升级至复杂级

---

## 复杂级详细规则

**适用场景**:
- 核心模块开发
- 跨模块变更（≥ 3 个目录）
- 架构调整
- 公共 API 重大变更

**执行流程**:
1. architecture、technical、feasibility 三位专家使用用户配置的任意可执行模型独立评审
2. 最多 5 轮评审
3. 三份成功结果聚合达到 ≥90% 且全部 APPROVED 才通过
4. 评审通过后写入 `.sprint-state/delphi-reviewed.json`

**分歧处理**:
- 每轮都保持同一组 architecture、technical、feasibility 三个角色，不新增仲裁者，也不减少执行
- Round 5 仍未达到批准共识时 BLOCK 进入 Phase 3/6 BUILD

---

## 参见

- [Phase 1/6: PREP](../references/phase-1-prep.md) — worktree 隔离 + 规模评估
- [Phase 2/6: DESIGN](../references/phase-2-design.md) — 需求探索 + 共识评审
- [Phase 3/6: BUILD](../references/phase-3-build.md) — TDD + raph-loop 构建
- [Phase 4/6: VERIFY](../references/phase-4-verify.md) — 代码走查 + 反馈
- [Delphi Review Skill](../../delphi-review/SKILL.md) — 多专家共识评审规范
