# Qoder Platform Adaptation Guide for Sprint Flow

**Version:** v0.6.0  
**Platform:** Qoder IDE  
**Status:** Active

---

## 1. Platform Differences

### 1.1 No File-System Event Hooks

| Capability | Claude Code | OpenCode | Qoder |
|-----------|------------|----------|-------|
| PreToolUse Hook | ✅ `delphi-review-guard.sh` | ❌ | ❌ |
| PostToolUse Hook | ✅ `xp-gate-check` | ❌ | ❌ |
| Custom Tools | ❌ | ✅ `tool()` | ❌ (MCP instead) |

**Adaptation**: Gates embedded in SKILL.md as `<MANDATORY>` instructions. Orchestrator MUST execute checks before each file edit.

### 1.2 No `task()` Subagent API

| Capability | OpenCode | Qoder |
|-----------|----------|-------|
| Subagent dispatch | `task(category, load_skills)` | Agent tool (Browser/CodeReview/plan-agent) |
| Multi-model | Agent config with different models | Qoder multi-model capability |
| Context isolation | Automatic per-task | Automatic per-Agent |

**Adaptation**: Phase→Agent mapping table in sprint-flow SKILL.md.

### 1.3 No superpowers/gstack Ecosystem

Qoder does not have access to the superpowers or gstack skill ecosystems. All external skill calls are replaced by:
- **Orchestrator inline execution** (for simple tasks)
- **Qoder native capabilities** (Memory, CodeReview, browser-use)
- **Agent subagents** (for complex analysis/planning)

---

## 2. External Skill Replacement Matrix

### 2.1 brainstorming (superpowers) → Orchestrator Inline

**Original**: `task(category="deep", load_skills=["brainstorming"])`

**Qoder Replacement**: Orchestrator conducts an interactive requirements exploration dialogue:
1. Ask clarifying questions about the feature
2. Analyze existing codebase for relevant modules
3. Generate a structured design document
4. Present to user for approval (HARD-GATE)

### 2.2 autoplan (gstack) → plan-agent Subagent

**Original**: `task(category="deep", load_skills=["autoplan"])`

**Qoder Replacement**: Dispatch `plan-agent` subagent with:
- Design document as input
- Codebase structure analysis
- Generate implementation plan with REQ/AC structure
- Output: specification.yaml draft

### 2.3 freeze/unfreeze (gstack) → Pre-Edit Gate

**Original**: `freeze` locks test directories, `unfreeze` unlocks

**Qoder Replacement**: Pre-Edit Gate in sprint-flow SKILL.md:
- During Phase 2 freeze state, orchestrator MUST check target file path
- If file is in test directory → BLOCK with message
- This is a behavioral constraint, not a physical lock

### 2.4 requesting-code-review (superpowers) → CodeReview Subagent

**Original**: `task(category="unspecified-high", load_skills=["requesting-code-review"])`

**Qoder Replacement**: Dispatch `CodeReview` subagent:
- Input: changed files since last REQ commit
- Blind review (no access to business intent, only code)
- Output: review findings

### 2.5 verification-before-completion (superpowers) → Orchestrator Inline

**Original**: `task(load_skills=["verification-before-completion"])`

**Qoder Replacement**: Orchestrator executes sequentially:
1. `npm test` / `pytest` / `go test` (test runner)
2. `npx eslint` / `ruff check` / `golangci-lint` (linter)
3. `npx tsx src/principles/index.ts` (principles check)
4. Coverage report check (≥80%)

### 2.6 learn/retro (gstack) → Qoder Memory System

**Original**: `task(load_skills=["learn", "retro"])`

**Qoder Replacement**: 
- **learn**: `UpdateMemory` with appropriate category
  - Architecture decisions → `expert_experience`
  - Coding patterns → `development_practice_specification`
  - Project structure → `project_introduction`
- **retro**: `plan-agent` subagent analyzes git log + code quality trends
  - Output stored via `UpdateMemory` as `task_summary_experience`

### 2.7 browse (gstack) → browser-use MCP

**Original**: `browse` navigates to localhost, interacts with UI

**Qoder Replacement**: Use `browser-use` MCP tools:
- `navigate_page` → navigate to localhost:3000
- `click` / `fill` → interact with UI elements
- `take_screenshot` → capture visual verification
- `take_snapshot` → get accessibility tree for validation

### 2.8 ship/finishing-branch → Orchestrator Git/GH CLI

**Original**: External skill calls

**Qoder Replacement**: Orchestrator executes:
- `git add` + `git commit` + `git push`
- `gh pr create` + `gh pr merge`
- Standard git workflow (platform-independent)

---

## 3. genui Widget Integration

### 3.1 Quality Report Widget

**Trigger**: After Phase 3 REVIEW completes

**Execution**:
```
show_widget(widget_path="plugins/qoder/widgets/quality-report.html", data={...quality-report.json contents...})
```

### 3.2 Sprint Dashboard Widget

**Trigger**: User requests `/sprint-status` or Phase transition

**Execution**:
```
show_widget(widget_path="plugins/qoder/widgets/sprint-dashboard.html", data={...sprint-state.json contents...})
```

---

## 4. Memory System Integration

### 4.1 Learnings Categories

| ralph-loop Category | Qoder Memory Category | Scope |
|--------------------|-----------------------|-------|
| permanent (architecture) | `expert_experience` | workspace |
| permanent (convention) | `development_practice_specification` | workspace |
| permanent (structure) | `project_introduction` | workspace |
| contextual | Not persisted | session only |
| sprint retro | `task_summary_experience` | workspace |

### 4.2 Memory Lifecycle

1. **REQ complete** → `UpdateMemory` for permanent learnings
2. **Sprint Phase 5** → `UpdateMemory` for sprint-level retro
3. **Next sprint** → `SearchMemory` to recall relevant learnings
4. **Stale learnings** → User can request memory cleanup

---

## 5. Known Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| Skill-embedded gates less reliable than hooks | Agent may ignore constraints | `<MANDATORY>` tags + Terminal State Checklist |
| No physical file-system lock for freeze | Test files could be modified | Pre-Edit Gate + Terminal State verification |
| Single model for all experts (degraded mode) | Loses cross-provider anonymity | Clearly label degraded reviews |
| No `k6`/`locust` integration | Load testing limited | Future: MCP server for load testing |
