# Delphi 共识报告 - test-specification-alignment-skill-design

## 日期: 2026-04-06
## 文档版本: V2.0
## 共识状态: ✅ APPROVED

---

## 评审摘要

| 轮次 | Expert A | Expert B | 共识结果 |
|------|----------|----------|----------|
| **V1** | REQUEST_CHANGES (8/10) | REQUEST_CHANGES (8/10) | 3 Critical Issues |
| **V2** | APPROVED (8/10) | APPROVED (9/10) | **共识达成** |

---

## V1.0 Critical Issues (已修复)

### C1: Phase 2 约束无法技术实现

**问题描述**:
- Skill 是指导性文档，无法拦截 Agent 的 Edit/Write 工具调用
- "检测后 BLOCK" 是被动响应，修改已经发生

**V2.0 修复**:
- 集成 freeze skill，Phase 2 前主动调用 `/freeze` 锁定测试目录
- freeze skill 在 Edit/Write 时预拦截，返回 BLOCKED_ERROR
- Phase 2 后调用 `/unfreeze` 解锁

**验证结果**: ✅ 有效 — 利用已有工具实现主动约束

---

### C2: Specification 错误场景缺失

**问题描述**:
- 设计假设 Specification 正确，测试失败 = 业务代码问题
- Specification 错误时形成流程死锁

**V2.0 修复**:
- 失败原因分类: BUSINESS_CODE_ERROR / TEST_DATA_ERROR / SPECIFICATION_ERROR / ENVIRONMENT_ERROR
- 新增 `ESCALATE_SPECIFICATION_ISSUE` 状态 + 用户决策分支 (A/B/C)
- 新增 `BLOCKED_SPECIFICATION_ISSUE` (State 93)

**验证结果**: ✅ 有效 — 死锁场景已打破，用户决策点明确

---

### C3: 对齐依赖 LLM 语义理解

**问题描述**:
- 对齐验证依赖 LLM 语义理解，结果不确定
- "提取 requirements" 是 mental construct，不是实际数据结构

**V2.0 修复**:
- 强制结构化 Specification 格式 (YAML)
- 强制映射规则: REQ-* → test, AC-* → assertion, @test/@covers/@intent JSDoc 标签
- 对齐算法: YAML parser + AST parser，规则匹配无 LLM

**验证结果**: ✅ 有效 — 语义对齐变为结构对齐，验证结果可重现

---

## V2.0 设计亮点

| # | 设计决策 | 评价 |
|---|----------|------|
| 1 | freeze skill 集成 | 利用成熟机制，无理论漏洞 |
| 2 | Specification 分流 | 完整闭环 (检测 → 阻塞 → 用户决策 → 分支恢复) |
| 3 | 结构化 YAML + AST 解析 | 确定性验证，结果可重现 |
| 4 | Legacy fallback | 降低采用门槛 |
| 5 | 测试类型差异化 | Unit/Integration/E2E 不同验证规则 |
| 6 | TDD 集成澄清 | xp-consensus 为前置，本 skill 为后置验证 |

---

## Minor Issues (实现时处理)

| # | Issue | 处理建议 |
|---|-------|----------|
| m1 | Skill 调用语法歧义 | 实现时适配 OpenCode skill tool 语法 |
| m2 | 阈值 80% 无依据 | 实现后收集数据调优，或提供用户配置选项 |
| m3 | 语言差异化标注 | 扩展 Python `# TEST: REQ-*`, Go `// TEST: REQ-*` |
| m4 | 状态机复杂 (21 states) | 实现时参考 xp-consensus 状态机模式 |

---

## 最终裁决

### APPROVED

**共识置信度: 8.5/10** (Expert A: 8/10, Expert B: 9/10)

### 理由

1. **三个 Critical Issues 全部修复**，方案具体可执行
2. **freeze skill 机制成熟可靠**，集成方案无理论漏洞
3. **Specification 错误处理闭环完整**
4. **结构化格式 + Legacy fallback** 降低采用门槛
5. **状态机虽复杂但定义清晰**

---

## 下一步

1. ✅ 设计方案 APPROVED → 进入实现阶段
2. 实现 `test-specification-alignment` skill
3. 验证与 xp-consensus、freeze skill 的集成
4. 收集实际数据调优阈值