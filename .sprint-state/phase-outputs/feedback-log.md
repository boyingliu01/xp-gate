# Sprint Feedback Log — sprint-2026-06-04-03

## Sprint 目标
修复 skill-only 变更不触发版本号更新的问题

## 关键经验

### 1. Delphi Review 的价值体现
初始方案（MICRO→npm PATCH 映射）存在数学上的必然缺陷：两个独立计数器（PATCH + MICRO）不能无损映射到一个位置。Round 1 两位专家都发现了版本降级风险。修复后的方案（统一 bump PATCH）更简单、更可靠。

### 2. 版本策略应简洁
用户反馈明确："每完成一个迭代，第三版本号+1，与修改内容无关"。这比复杂的 MICRO/PATCH 区分方案更实用。简单规则 > 复杂映射。

### 3. mock-policy 测试是已知技术债
13 个 Windows 路径兼容性测试失败已记录为 Issue #133，需后续专项修复。

## 改进建议
- skill-cert CI job 的实际效果需要 skill-cert 工具完善后才能验证（目前 continue-on-error）
- 考虑将 VERSION-GATE 检查也加入 CI 层（双重保障），而非仅依赖 SKILL.md 流程规则
