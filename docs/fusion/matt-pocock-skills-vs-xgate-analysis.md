# Matt Pocock Skills vs XGate 融合分析

**日期**: 2026-05-20
**来源**: https://www.aihero.dev/5-agent-skills-i-use-every-day + https://github.com/mattpocock/skills

## 一、Matt 的 5 个核心技能

| # | Skill | 核心机制 |
|---|---|---|
| 1 | `/grill-me` + `/grill-with-docs` | 问答式需求澄清，遍历设计树，CONTEXT.md + ADRs 维护 |
| 2 | `/to-prd` | 对话上下文 → PRD（含 User Stories）→ GitHub Issue |
| 3 | `/to-issues` | PRD → 垂直切片（tracer bullet）Issue，含依赖关系、HITL/AFK |
| 4 | `/tdd` | RED→GREEN→REFACTOR，垂直切片 |
| 5 | `/improve-codebase-architecture` | 周期性发现 shallow → deep module 机会 |

## 二、逐项对比与融合策略

### Skill 1: `/grill-me` vs `brainstorming` — **增强**

| 维度 | Matt | XGate | 结论 |
|---|---|---|---|
| 核心目的 | 需求澄清 | 需求探索 → 完整设计 | 重叠互补 |
| 交互方式 | 一问一答遍历设计树 | 多阶段：方案→设计→审批 | XGate 更全面 |
| Shared Language | CONTEXT.md + ADRs维护 | **无** | **XGate 缺失** |

**融合行动**: 在 brainstorming 中引入 CONTEXT.md + ADR 维护能力（grill-with-docs 机制）

### Skill 2: `/to-prd` vs `delphi-review` → `specification.yaml` — **增强**

| 维度 | Matt | XGate | 结论 |
|---|---|---|---|
| User Stories | ✅ 强制 | ❌ **无** | **XGate 缺失** |
| Implementation Decisions | ✅ 记录 | delphi 隐含 | 部分重叠 |
| Issue Tracker | 提交 GitHub Issue | 无集成 | **XGate 缺失** |

**融合行动**: specification 生成中增加 User Stories 段

### Skill 3: `/to-issues` — **新增**

| 维度 | Matt | XGate | 结论 |
|---|---|---|---|
| 垂直切片拆解 | ✅ tracer bullet | ❌ **完全缺失** | **P0 优先级** |
| HITL/AFK 标注 | ✅ | ❌ | 缺失 |
| 依赖关系 | ✅ | ❌ | 缺失 |

**融合行动**: 新增 `/to-issues` skill，集成到 sprint-flow Phase 1

### Skill 4: `/tdd` vs `test-driven-development` — **保持**

XGate 的 TDD 已 >= Matt 的。无需替代，可选吸收 vertical slice 术语。

### Skill 5: `/improve-codebase-architecture` — **新增互补**

| 维度 | Matt | XGate | 结论 |
|---|---|---|---|
| 核心概念 | Deep/Shallow modules, seams, locality | Clean Code 9 rules + SOLID 5 rules | **互补** |
| 时机 | 定期（主动改善） | 每次 commit（被动拦截） | 不同场景 |
| Deletion Test | ✅ | ❌ **无** | **XGate 缺失** |

**融合行动**: 新增独立 skill，Phase 5 后周期性调用

## 三、融合路线图

| 优先级 | 行动 | 理由 |
|---|---|---|
| **P0** | 新增 `/to-issues` skill（垂直切片拆解） | 完全缺失的链路，连接 PLAN → BUILD |
| **P1** | 增强 `brainstorming` 集成 CONTEXT.md + ADR | shared language 是 AI 代码质量核心杠杆 |
| **P1** | 新增 `/improve-codebase-architecture` skill | 定期深度优化，与被动 gates 互补 |
| **P2** | 增强 `specification.yaml` 增加 User Stories | PRD 到 spec 的语义桥接 |
| **P3** | sprint-flow 流程：PLAN 增加 to-issues 环节 | 端到端流程闭环 |

## 四、执行状态（截至 2026-05-20）

### P0: ✅ 完成 — `/to-issues` skill
- 文件: `skills/to-issues/SKILL.md`
- Delphi Round 1: 3/3 REQUEST_CHANGES → Round 2: 3/3 APPROVED
- 关键特性: JSON Output Contract, DAG 拓扑排序, HITL/AFK 状态机, Gate-Compliant DoD, 范围控制硬上限

### P1-1: ✅ 完成 — `brainstorming` 增强 CONTEXT.md + ADR
- 文件: `~/.config/opencode/superpowers/skills/brainstorming/SKILL.md`
- Delphi Round 1: 2/3 REQUEST_CHANGES → Round 2: 3/3 APPROVED
- 关键特性: Shared Language 段, CONTEXT.md 扫描 (Step 5), cross-reference 范围限定, 多 CONTEXT.md 消歧, lazy create ≥2 术语阈值

### P1-2: ✅ 完成 — `/improve-codebase-architecture` skill
- 文件: `skills/improve-codebase-architecture/SKILL.md`
- 关键特性: Deletion Test, shallow→deep 深度化, CONTEXT.md 集成, Sprint Flow Phase 5 集成, Anti-Patterns

### P2: ✅ 完成 — specification.yaml User Stories 融合
- 文件: `~/.config/opencode/skills/delphi-review/SKILL.md` + `skills/test-specification-alignment/SKILL.md`
- 关键特性: specification.yaml 新增 user_stories[] 段 (actor/feature/benefit/linked_requirements)，追溯链 US→REQ→AC→test

### P3: ⏳ 待执行 — sprint-flow 流程整合 to-issues
- 文件: `skills/sprint-flow/SKILL.md`
- 修改: Phase 1 PLAN 阶段增加 /to-issues 环节描述

### Issue #61: ✅ 已完成 — 编码门禁分层治理（Ousterhout + Clean Code）
- 新增规则: `src/principles/rules/clean-code/many-exports.ts` (CC-010)
- 新增 Adapter 方法: `extractExports()` — 匹配 `export function/const/class/let/var/type/interface/enum` + re-exports `export { X } from`
- 阈值: 单模块导出 ≤10 个，severity: warning
- 已更新: config.ts, types.ts, TypeScriptAdapter (extractExports), BaseAdapter (默认空数组), rules/index.ts, index.ts (15 rules), README.md
- 测试: 81/81 通过，TypeScript 类型检查无错
- 规则验证: `src/principles/rules/index.ts` (15 exports) → 触发 warning ✓
- 决策记录:
  - deep-nesting 保持 4（不加严到 2）— 4 适合函数内部级别，函数间调用链深度另行评估
  - large-file 保持 650（不降到 500）— 已有项目验证
  - 注释质量不作为硬性门禁 — 静态验证不可靠，改为 `/improve-codebase-architecture` 软建议

### 下一步
等待用户确认后执行 P3 或调整方向。
