# Sprint State 双层强制执行机制设计

**日期**: 2026-07-21
**状态**: DRAFT — 待 Delphi 评审
**关联 Issue**: #338 (dashboard never auto-renders), #146 (sprint-state enforcement)
**前置修复**: `xp-gate phase-transition` CLI (commit 75c6b49)

## 问题背景

`xp-gate phase-transition` CLI 解决了 SprintStateManager 库无入口的集成断链问题，但 **调用 CLI 本身仍是 SKILL.md 中的文本指令**。LLM orchestrator 在上下文压力下仍可能跳过调用。

需要一个额外的强制执行机制，在不增加流程负担的前提下，提供结构性保障。

## 设计目标

1. **零阻塞**：审计结果为 WARNING，不阻止 commit/push/merge
2. **早期发现**：在 Phase 转换时即时提醒遗漏，而非等到 Sprint 结束
3. **最终审计**：Phase 6 CLOSE 时生成完整覆盖度报告
4. **向后兼容**：非 Sprint 项目不受影响

## 架构

```
Layer 1 (实时检查)                    Layer 2 (最终审计)
┌──────────────────────┐              ┌──────────────────────┐
│ phase-transition     │              │ sprint-audit         │
│                      │              │                      │
│ 当 status=in_progress│              │ Phase 6 completed 时 │
│ 自动检查前一 Phase   │              │ 检查 phase_history   │
│                      │              │ 完整覆盖度           │
│ 缺失 → WARNING       │              │                      │
│ 存在 → 静默通过      │              │ 输出审计报告         │
│                      │              │ 写入 audit-report    │
└──────────────────────┘              └──────────────────────┘
```

## Layer 1: phase-transition 实时检查

### 触发条件

当 `handlePhaseTransition` 被调用且 `status === 'in_progress'` 且 `phase >= 2` 时。

### 检查逻辑

```
读取 sprint-state.json
  → 查找 phase_history 中 phase === (currentPhase - 1) 的条目
  → 如果不存在或 status !== 'completed':
      输出: ⚠️ [sprint-audit] Phase {N-1} ({name}) not recorded as 'completed'
      输出:    Previous phase may have been skipped. Run: xp-gate phase-transition {N-1} completed
  → 如果存在:
      静默通过（无输出）
```

### 行为约束

- **不阻止**：WARNING 输出到 stderr，exit code 仍为 0
- **不重试**：不自动补录前一 Phase，仅提醒
- **幂等**：同一 Phase 多次调用 in_progress 只检查一次（状态未变）

### 示例输出

```
$ npx xp-gate phase-transition 3 in_progress --render
⚠️ [sprint-audit] Phase 2 (DESIGN) not recorded as 'completed'
   Previous phase may have been skipped. Run: xp-gate phase-transition 2 completed
✅ Phase 3 transitioned to 'in_progress'
+============================================================+
|  SPRINT PROGRESS                      sprint-1784640921949|
...
```

## Layer 2: sprint-audit 最终审计

### CLI 接口

```
npx xp-gate sprint-audit [--dir <path>] [--json]
```

### 检查项

| 检查项 | 规则 | 严重级别 |
|--------|------|----------|
| Phase 覆盖度 | phase_history 中 completed 条目数 / 6 | INFO |
| 缺失 Phase | 哪些 Phase 编号不在 phase_history 中 | WARNING |
| 时间记录 | completed Phase 是否有 duration_seconds | INFO |
| 输出物记录 | 每个 completed Phase 是否有 phase-{N}-summary.md | WARNING |
| 状态一致性 | sprint-state.json 的 phase 字段与 phase_history 最后条目是否一致 | ERROR |

### 输出格式（人类可读）

```
$ npx xp-gate sprint-audit

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Sprint Audit Report — sprint-2026-07-21-01
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Branch: sprint/2026-07-21-01
  Phase Coverage: 5/6 (83%)

  Phase History:
  ✅ Phase 1/6  PREP       completed  (120s)
  ✅ Phase 2/6  DESIGN     completed  (300s)
  ✅ Phase 3/6  BUILD      completed  (1800s)
  ✅ Phase 4/6  VERIFY     completed  (600s)
  ✅ Phase 5/6  SHIP       completed  (180s)
  ⚠️ Phase 6/6  CLOSE      in_progress  ← not yet completed

  Warnings:
  ⚠️ Phase 6 summary missing: .sprint-state/phase-outputs/phase-6-summary.md

  Overall: 1 warning, 0 errors
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 输出格式（JSON）

```json
{
  "sprint_id": "sprint-2026-07-21-01",
  "branch": "sprint/2026-07-21-01",
  "coverage": { "completed": 5, "total": 6, "pct": 83 },
  "missing_phases": [],
  "incomplete_phases": [{ "phase": 6, "name": "CLOSE", "status": "in_progress" }],
  "warnings": ["Phase 6 summary missing: phase-6-summary.md"],
  "errors": [],
  "verdict": "PASS_WITH_WARNINGS"
}
```

### Verdict 规则

| 条件 | Verdict |
|------|---------|
| 6/6 completed + 0 errors | `PASS` |
| >= 4/6 completed + 0 errors | `PASS_WITH_WARNINGS` |
| < 4/6 completed 或 any errors | `FAIL` |
| 无 sprint-state.json | `SKIP` |

### 报告持久化

审计报告写入 `.sprint-state/audit-report.json`，供后续分析。

## SKILL.md 集成

### Phase 转换时（Layer 1 — 自动，无需额外指令）

无需修改 SKILL.md。Layer 1 在 `phase-transition` 内部自动执行。

### Phase 6 CLOSE 时（Layer 2 — 新增步骤）

在 SKILL.md 的 CLOSE 阶段步骤中添加：

```markdown
8. After Phase 6 completes, MUST run `npx xp-gate sprint-audit --render` to generate
   the final sprint completeness report. Review warnings and address if needed.
```

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/npm-package/lib/phase-transition.js` | 修改 | 添加 Layer 1 前置检查 |
| `src/npm-package/lib/sprint-audit.js` | 新建 | Layer 2 审计逻辑 |
| `src/npm-package/bin/xp-gate.js` | 修改 | 注册 `sprint-audit` 命令 |
| `src/npm-package/lib/__tests__/phase-transition.test.js` | 修改 | 添加 Layer 1 测试 |
| `src/npm-package/lib/__tests__/sprint-audit.test.js` | 新建 | Layer 2 测试 |
| `skills/sprint-flow/SKILL.md` | 修改 | Rule 8: sprint-audit |
| `skills/sprint-flow/references/orchestration-rules.md` | 修改 | CLOSE 阶段步骤 |
| 各平台 skill 副本 (plugins/, npm-package/) | 同步 | 自动同步 |

## 非目标（YAGNI）

- **不做 pre-commit 硬拦截**：保持事后审计模式，不阻塞 commit
- **不做自动补录**：检测到缺失 Phase 时只 WARNING，不自动修复
- **不做 CI 集成**：审计报告仅本地生成，不上传 CI
- **不做历史趋势**：不跟踪多次 Sprint 的覆盖度趋势
