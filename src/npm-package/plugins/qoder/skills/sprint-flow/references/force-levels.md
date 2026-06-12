# Sprint Flow 执行级别定义

**执行时机**: Phase 0 THINK 之前，AUTO-ESTIMATE 完成后。

**目的**: 根据需求规模匹配适度评审流程，平衡质量保障与效率。

**核心原则**:
- 所有级别**必须经过 Delphi 评审**，不可跳过
- 轻量级采用**简化 Delphi**（2 专家、1 轮），仍需 2/2 批准
- 标准/复杂采用**完整 Delphi**（2-3 专家、多轮）
- 自动升级机制：当出现风险信号时强制升级级别

---

## 级别定义

| 级别 | 适用场景 | 专家数 | 最多轮数 | 通过条件 | 预计耗时 |
|------|---------|--------|---------|----------|---------|
| **轻量** | 小改动、局部修改、删除代码 | 2 | 1 | 2/2 批准 | 10-20 分钟 |
| **标准** | 常规功能开发、模块重构 | 2 | 2 | 2/2 批准 | 30-60 分钟 |
| **复杂** | 核心模块、跨模块变更、新增架构 | 3 | 3 | 3/3 批准 | 1-2 小时 |

---

## Token 成本预算

| 级别 | delphi-review 调用 | 预计 Token 消耗 | 成本说明 |
|------|-------------------|--------------|---------|
| **轻量** | 1 次（2 专家、1 轮） | ~8,000 | 简化流程，单轮评审 |
| **标准** | 1-2 次（2 专家、1-2 轮） | ~15,000-25,000 | 可能需要 1 轮反馈 |
| **复杂** | 1-3 次（3 专家、1-3 轮） | ~30,000-60,000 | 多轮深度评审 |

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
| 专家意见分歧（1 票反对） | 轻量/标准 | 复杂 | 需要第 3 专家仲裁 |
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

AUTO-ESTIMATE 提供**初始级别建议**，Force Levels 定义**具体执行规则**：

```
AUTO-ESTIMATE 输出 → Force Levels 执行 → 自动升级机制（如触发）
```

| AUTO-ESTIMATE 指标 | 建议级别 | Force Levels 执行 |
|-------------------|---------|------------------|
| 引用计数 ≤ 3 + 跨模块 ≤ 1 | 轻量 | 2 专家、1 轮 Delphi |
| 引用计数 4-10 或 跨模块 2 | 标准 | 2 专家、最多 2 轮 Delphi |
| 引用计数 > 10 或 跨模块 ≥ 3 | 复杂 | 3 专家、最多 3 轮 Delphi |
| 存在循环依赖 | 强制复杂 | 3 专家、最多 3 轮 + 架构评审 |

**关键区别**:
- AUTO-ESTIMATE: **客观指标分析**（代码结构、引用计数）
- Force Levels: **执行规则定义**（评审流程、升级机制）

---

## 与 DELPHI-GATE 的关系

**DELPHI-GATE** 是 Phase 2 的**强制门禁**，检查 `.sprint-state/delphi-reviewed.json` 的 `verdict=APPROVED`。Force Levels 定义**产生该门禁文件的评审强度**：

| 场景 | DELPHI-GATE | Force Levels |
|------|------------|-------------|
| Phase 1 设计评审 | 3 专家、≥90% 共识、生成 specification.yaml | 不适用（设计阶段） |
| Phase 2 BUILD 入口 | **必须检查** `.sprint-state/delphi-reviewed.json` 中 `verdict=APPROVED` | 轻量/标准/复杂：通过对应强度的 delphi-review 生成该门禁文件 |
| 轻量级评审 | 生成 `delphi-reviewed.json`（2 专家、1 轮、2/2 批准） | 2 专家、1 轮、写入门禁文件 |
| 标准级评审 | 生成 `delphi-reviewed.json`（2 专家、最多 2 轮、2/2 批准） | 2 专家、最多 2 轮、写入门禁文件 |
| 复杂级评审 | 生成 `delphi-reviewed.json`（3 专家、最多 3 轮、3/3 批准） | 3 专家、最多 3 轮、写入门禁文件 |
| Phase 3 代码走查 | 再次检查 `delphi-reviewed.json` 或重新评审 | 复用 Force Levels 规则 |

**关键规则**:
- **DELPHI-GATE 永不跳过**：Phase 2 BUILD 入口必须检查 `.sprint-state/delphi-reviewed.json` 中 `verdict=APPROVED`
- **Force Levels 定义评审强度**：轻量/标准/复杂决定用 2 专家 1 轮还是 3 专家 3 轮来**产生**门禁文件
- **轻量级不是跳过评审**：而是简化流程（2 专家、1 轮），但仍需生成门禁文件
- **LIGHTWEIGHT ≠ ONE-EXPERT**: 1 专家违反 Delphi 核心原则，禁止

---

## 轻量级详细规则

**适用场景**:
- 删除已存在代码（如移除废弃模块）
- 小规模修改（≤ 5 个文件、≤ 200 行改动）
- 不涉及公共 API
- 无循环依赖

**执行流程**:
1. 2 位专家独立评审（DeepSeek-v4-pro + Kimi-K2.6）
2. 单轮评审，无需多轮迭代
3. **2/2 批准**才通过（不允许 1/2 批准）
4. 评审通过后写入 `.sprint-state/delphi-reviewed.json`

**输出文件** (`.sprint-state/delphi-reviewed.json`):
```json
{
  "sprint_id": "sprint-2026-06-05-01",
  "level": "轻量",
  "delphi_review": {
    "experts": ["deepseek-v4-pro", "kimi-k2.6"],
    "rounds": 1,
    "votes": {
      "expert_a": "APPROVED",
      "expert_b": "APPROVED"
    },
    "consensus": "2/2 APPROVED",
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
1. 2 位专家独立评审（Round 1）
2. 如有 REQUEST_CHANGES，进入 Round 2（最多 2 轮）
3. **2/2 批准**才通过
4. 评审通过后写入 `.sprint-state/delphi-reviewed.json`

**升级至复杂级条件**:
- Round 2 仍有分歧（1 票反对）→ 升级至复杂级（第 3 专家仲裁）
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
1. 3 位专家独立评审（DeepSeek-v4-pro + Kimi-K2.6 + Qwen3.6-Plus）
2. 最多 3 轮评审（Round 1-3）
3. **3/3 批准**才通过
4. 评审通过后写入 `.sprint-state/delphi-reviewed.json`

**仲裁机制**:
- Round 2 仍有分歧 → 第 3 专家（Qwen3.6-Plus）加入仲裁
- Round 3 必须达成一致，否则 BLOCK 进入 Phase 2

---

## 参见

- [Phase -0.5: AUTO-ESTIMATE](../references/phase-minus-0-5-auto-estimate.md) — 规模评估与流程路由
- [Phase 0: THINK](../references/phase-0-think.md) — 需求探索与设计
- [Phase 1: PLAN](../references/phase-1-plan.md) — 计划与 Delphi 设计评审
- [Phase 2: BUILD](../references/phase-2-build.md) — 编码与 Ralph Loop
- [Phase 3: REVIEW](../references/phase-3-review.md) — 代码走查与验证
- [Delphi Review Skill](../../../../skills/delphi-review/SKILL.md) — 多专家共识评审规范
