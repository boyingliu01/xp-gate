# Design Doc: Skill Certification Optimization for sprint-flow & delphi-review

**Sprint**: 2026-07-09-01
**Status**: IMPLEMENTED (post-hoc review)
**Issues**: #314 (sprint-flow), #315 (delphi-review)

## Background

skill-cert 评测发现 xp-gate 两个核心 skill 存在结构性问题：

| Issue | Skill | L1 Trigger | L3 Step Adherence | Structural Issues |
|-------|-------|-----------|-------------------|-------------------|
| #314 | sprint-flow | 40% (5/8) | 79.8% | 624行(>500), 描述0/100, 无tools/hooks |
| #315 | delphi-review | 72.7% (8/14) | 81.3% | 无tools/hooks, 缺少触发排除场景 |

## Design Decisions

### D1: sprint-flow 拆分策略

**Decision**: 将 624 行 SKILL.md 拆分为 router file (frontmatter + triggers + workflow_steps + anti-patterns, <300 lines) + references/phase-overview.md (详细 phase 描述)。

**Rationale**: 渐进式披露 — 模型首先加载轻量 router，需要时再按需加载详细指令。这直接解决 8851t 加载层超标问题。

**Alternatives considered**:
- 拆分到每个 phase-*.md 各自的文件中 → 拒绝：会破坏现有 reference 结构，增加 6 个文件的维护负担
- 只在 frontmatter 中引用 references 而不移动内容 → 拒绝：不解决 SKILL.md 行数超标问题

### D2: 描述字段重写为第三人称

**Decision**: 将 description 从中文一人称("One-Shot Sprint 自动流水线")改为英文第三人称，明确 WHAT/WHEN/NOT WHEN。

**Rationale**: skill-cert 评分标准要求第三人称客观描述，明确触发边界。

### D3: 触发边界细化

**Decision**: 两个 skill 都增加 triggers_negative_examples 和 triggers_negative_test_cases。

**Rationale**: L1 触发准确率低的核心原因是缺乏明确的"不触发"边界。增加排除场景后，模型能更好地区分触发/非触发请求。

**Key exclusions added**:
- sprint-flow: "实现排序算法"(算法实现), "实现一下"(随意), "帮我写个脚本"(脚本), "代码review"(审查), "refactor"(重构)
- delphi-review: "how does delphi work"(教育), "code review checklist"(询问列表), "review my code quickly"(快速审查), "peer review"(不同流程), "can you review this"(模糊)

### D4: 结构化输出标记

**Decision**: 
- sprint-flow: workflow_steps 中每个 step 绑定 `Output:` 模板(`## Phase X/6: NAME (中文名)`)，每阶段结束时输出 `status/outputs/decisions/next_phase_context`
- delphi-review: 每轮输出 `[DelphiReview Round N]` 标记行 + consensus_ratio 摘要

**Rationale**: L3 步骤遵循度低是因为模型输出缺乏结构化信号。明确标记后，skill-cert 能检测到步骤执行。

### D5: 工具权限和钩子集成

**Decision**: 两个 skill 的 frontmatter 中增加 tools_allowed/tools_denied 和 hooks 字段。

**Rationale**: 技能安全性评估需要明确的工具白名单和钩子引用。

## Impact Analysis

### Changed Files
1. `skills/sprint-flow/SKILL.md` — 重写为 261 行 router file
2. `skills/sprint-flow/references/phase-overview.md` — 新增 481 行详细指令
3. `skills/delphi-review/SKILL.md` — 扩展至 420 行

### Unchanged
- 所有 references/ 下的现有 phase-*.md 文件
- 所有 templates/
- 所有 AGENTS.md 镜像（由 scripts/copy-skills.sh 管理）
- 核心方法论和 anti-patterns

### Risks
- **Low**: phase-overview.md 新增间接引用，需确保原 SKILL.md 中没有硬链接到已移动的锚点 → 已确认所有交叉引用使用 @references/ 前缀
- **Low**: YAML frontmatter 中 tools_allowed/hooks 字段可能不被所有 skill 加载器识别 → 使用标准 YAML 格式，向后兼容
- **Low**: sprint-flow 的 workflow_steps 从简单名称改为包含 Output 模板 → 可能影响部分解析器，但内容本身向后兼容
