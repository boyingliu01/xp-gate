# Evolution Log — sprint-flow

> AHE 启发的可观测性变更日志。每次对 sprint-flow 组件的修改必须记录。

## Entry 001 — 2026-05-22 — AHE Observability Infrastructure (P0)

- **Trigger**: new-feature — Issue #62: 为 XP-Gate Skills 建立可观测性基础设施
- **Evidence**: GitHub Issue #62 描述 — 无法做消融实验，反馈无法积累，迭代依赖直觉
- **Root Cause**: SKILL.md 单文件结构导致组件级修改无法归因到具体组件
- **Change Made**:
  1. 创建 `references/components/` 目录，包含 5 个 AHE 对齐组件:
     - `system-prompt.md` (核心原则 L34-43)
     - `tool-descriptions.md` (Phase Skill 调用 L120-298)
     - `middleware.md` (状态机+暂停点 L46-84)
     - `skill-invocations.md` (Phase→Skill 映射 L88-103)
     - `memory.md` (Sprint State JSON L190-334)
  2. 创建 `evolution-log.md` (本文)
  3. 创建 `evolution-history.json` (初始 schema + Iteration 001 记录)
  4. 同步为 ralph-loop 创建同等 components/ 结构
- **Self-Predicted Impact**: ablation 实验成为可能；单次组件修改的因果归因从 0% → 100%
- **Actual Outcome**: ⏳ pending（P1 debugger 实施后测量）
- **Component Changed**: [middleware, tools, memory]
- **Delphi Review**: Round 2 APPROVED (2/3, 记录少数派 ralph-loop 关切)
