# Known Issues & Future Work

本文件记录 Delphi Review 过程中发现的问题及其修复状态。

---

## ✅ Critical Issues (已全部修复)

### C1: TDD 实践说明需澄清

**问题**: 
- 设计文档中 xp-consensus 的 Round 1 描述没有体现 TDD 的核心循环

**修复方案**:
- 更新 `driver-prompt.md` 添加明确的 TDD 循环（🔴RED → 🟢GREEN → 🔄REFACTOR）
- 更新 `DESIGN.md` 第 235-269 行，在核心流程中明确 TDD 三阶段
- 添加 TDD 说明章节，指向详细参考文档

**状态**: ✅ 已完全修复 (Round 3 APPROVED)

---

### C2: sealed code 隔离机制

**问题**:
- Navigator Phase 1 如何无法访问 Driver 的代码未说明
- 两种不同的隔离场景被混淆

**修复方案**:
- 添加 "Sealed Code 隔离机制" 章节（DESIGN.md 第 282-343 行）
- 明确说明 Prompt 输入隔离实现方式
- 提供备选方案（freeze skill）
- 添加区分表格，区分：
  - xp-consensus Navigator 盲评：Prompt 输入隔离
  - test-specification-alignment Phase 2：freeze skill 锁定

**状态**: ✅ 已完全修复 (Round 3 APPROVED)

---

### C3: 架构迭代性

**问题**:
- 设计文档展示线性流水线，但 XP 核心是短迭代循环

**修复方案**:
- 添加 "单次迭代 vs 完整 XP 流程" 说明（DESIGN.md 第 88-133 行）
- 明确文档描述单次迭代
- 说明迭代回顾使用 `gstack-retro` skill
- 提供完整 XP 流程图

**状态**: ✅ 已完全修复 (Round 3 APPROVED)

---

## Delphi Review 结论

| Round | Expert A | Expert B | Action |
|-------|----------|----------|--------|
| Round 1 | REQUEST_CHANGES (8/10) | REQUEST_CHANGES (8/10) | 修复 C1, C2, C3 |
| Round 2 | REQUEST_CHANGES (8/10) | REQUEST_CHANGES (9/10) | 更新 DESIGN.md |
| Round 3 | ✅ APPROVED (9/10) | ✅ APPROVED (9/10) | 共识达成 |

**最终裁决**: ✅ APPROVED

**共识报告**: 见 `docs/delphi-consensus-report-final.md`

---

## Major Issues (后续改进)

### M1: System Metaphor 覆盖不足

**现状**: 仅记录架构决策
**改进**: 添加 `metaphor-discovery` skill 或在 design-review 中加入隐喻维度

### M2: On-site Customer 简化

**现状**: 仅在方案评审时触发用户决策
**改进**: 添加持续用户反馈机制（如 story acceptance、priority confirmation）

### M3: Planning Game 缺失

**现状**: 只有需求探索和方案评审
**改进**: 添加故事估算机制（Planning Poker）、速度追踪

### M4: Skill 触发机制说明

**现状**: 列出触发条件但未说明实现
**改进**: 补充 OpenCode skill triggers 配置示例

### M5: Git Hook 实现细节

**现状**: 提及 pre-push 调用 skill
**改进**: 补充 hook script 实现示例

### M6: 成本阈值来源

**现状**: 固定阈值 ($0.02, $0.15, $1.00)
**改进**: 补充计算依据或改为可配置

---

## Minor Issues (迭代优化)

| Issue | 描述 | 状态 |
|-------|------|------|
| m1 | Coverage 阈值未定义 | 添加到 Gate 4 说明 |
| m2 | "Post-commit" 命名不一致 | 改为 "Pre-push Code Walkthrough" |
| m3 | "max 3" 无依据 | 补充选择理由 |
| m4 | 零容忍原则过于刚性 | 根据语言动态检查工具 |
| m5 | freeze skill 可用性验证 | 已存在 (gstack-freeze) |
| m6 | Agent 模型可用性 | 已验证可用 |

---

## Roadmap

### V1.0 (Current)

- [x] 修复 C1: TDD 循环明确
- [x] 修复 C2: Sealed Code 隔离机制
- [x] 修复 C3: 架构迭代性说明
- [x] 质量优先原则固化
- [x] Delphi Review APPROVED

### V1.1 (Next Release)

- [ ] 添加 Planning Poker skill
- [ ] 添加 Velocity Tracking
- [ ] 改进 On-site Customer 反馈机制

### V2.0

- [ ] System Metaphor skill
- [ ] Spike Management
- [ ] Continuous Design Improvement

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| V1.0 | 2026-04-07 | Delphi Review 完成，所有 Critical Issues 修复，APPROVED |